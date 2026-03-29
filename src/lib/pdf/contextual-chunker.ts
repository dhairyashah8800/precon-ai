import type { SectionBoundary } from './anchor-matcher'

const MAX_CHUNK_CHARS = 2000
const MIN_CHUNK_CHARS = 200

export interface ChunkWithContext {
  content: string       // contextual header + chunk text — embedded
  rawContent: string    // chunk text without header — displayed in UI
  metadata: {
    page_number: number
    source_pages: string
    csi_division: string | null
    csi_division_name: string | null
    section_number: string | null
    section_title: string
    document_category: string
    project_code: string
    document_id: string
  }
}

function cleanText(text: string): string {
  return text
    .replace(/\x00/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Split a long paragraph (>MAX_CHUNK_CHARS) at sentence boundaries.
 * Sentence boundary: ". " followed by an uppercase letter or newline.
 */
function splitLongParagraph(text: string): string[] {
  const parts: string[] = []
  let remaining = text

  while (remaining.length > MAX_CHUNK_CHARS) {
    // Find a sentence boundary within the first MAX_CHUNK_CHARS
    const window = remaining.slice(0, MAX_CHUNK_CHARS)
    // Look for '. ' followed by uppercase letter, searching backwards from end
    const sentenceEnd = window.search(/\.\s+[A-Z\n][^]*$/)

    // Use lastIndexOf approach: find all `. ` positions and take the last one within window
    let splitAt = -1
    const sentencePattern = /\.\s+(?=[A-Z\n])/g
    let match: RegExpExecArray | null
    while ((match = sentencePattern.exec(window)) !== null) {
      splitAt = match.index + match[0].length
    }
    void sentenceEnd // suppress unused warning

    if (splitAt > 0) {
      parts.push(remaining.slice(0, splitAt).trim())
      remaining = remaining.slice(splitAt).trim()
    } else {
      // No sentence boundary found — hard split at MAX_CHUNK_CHARS
      parts.push(remaining.slice(0, MAX_CHUNK_CHARS).trim())
      remaining = remaining.slice(MAX_CHUNK_CHARS).trim()
    }
  }

  if (remaining.length > 0) {
    parts.push(remaining)
  }

  return parts
}

/**
 * Build the contextual header for a chunk.
 */
function buildHeader(
  boundary: SectionBoundary,
  projectCode: string,
  startPage: number,
  endPage: number
): string {
  const pageLabel = startPage === endPage ? String(startPage) : `${startPage}-${endPage}`

  if (boundary.sectionNumber !== null && boundary.division !== '00') {
    return `[Project: ${projectCode}] [Category: Technical Specification] [Division: ${boundary.division} - ${boundary.divisionName}] [Section: ${boundary.sectionNumber} - ${boundary.title}] [Page: ${pageLabel}]`
  } else {
    return `[Project: ${projectCode}] [Category: Administrative/Legal] [Section: ${boundary.title}] [Page: ${pageLabel}]`
  }
}

/**
 * Pass 2 — Contextual Chunking.
 *
 * Slices extracted PDF text by section boundaries, prepends CSI metadata
 * headers to every chunk before embedding.
 */
export function contextualChunk(
  boundaries: SectionBoundary[],
  pagesText: { pageNumber: number; text: string }[],
  projectCode: string,
  documentId: string
): ChunkWithContext[] {
  // Build a fast lookup: pageNumber → text
  const pageMap = new Map<number, string>()
  for (const p of pagesText) {
    pageMap.set(p.pageNumber, p.text)
  }

  const result: ChunkWithContext[] = []

  for (const boundary of boundaries) {
    // Collect paragraphs with their source page numbers
    const paragraphs: { text: string; pageNumber: number }[] = []

    for (let pageNum = boundary.startPage; pageNum <= boundary.endPage; pageNum++) {
      const raw = pageMap.get(pageNum)
      if (!raw) continue

      const cleaned = cleanText(raw)
      if (!cleaned) continue

      // Split into paragraphs at double newlines
      const pageParagraphs = cleaned.split(/\n\n+/)
      for (const para of pageParagraphs) {
        const trimmed = para.trim()
        if (!trimmed) continue

        if (trimmed.length > MAX_CHUNK_CHARS) {
          // Split long paragraph at sentence boundaries
          const subParts = splitLongParagraph(trimmed)
          for (const part of subParts) {
            if (part.trim()) {
              paragraphs.push({ text: part.trim(), pageNumber: pageNum })
            }
          }
        } else {
          paragraphs.push({ text: trimmed, pageNumber: pageNum })
        }
      }
    }

    if (paragraphs.length === 0) continue

    // Accumulate paragraphs into chunks
    let currentChunkParts: string[] = []
    let currentChunkLength = 0
    let chunkStartPage = paragraphs[0].pageNumber
    let chunkEndPage = paragraphs[0].pageNumber

    const flushChunk = () => {
      if (currentChunkParts.length === 0) return
      const rawContent = currentChunkParts.join('\n\n')
      if (rawContent.length < MIN_CHUNK_CHARS && result.length > 0) {
        // Append to previous chunk if too small (and there is a previous one)
        const prev = result[result.length - 1]
        const mergedRaw = prev.rawContent + '\n\n' + rawContent
        const mergedStartPage = parseInt(prev.metadata.source_pages.split('-')[0])
        const mergedEndPage = chunkEndPage
        const mergedSourcePages =
          mergedStartPage === mergedEndPage
            ? String(mergedStartPage)
            : `${mergedStartPage}-${mergedEndPage}`
        const mergedHeader = buildHeader(boundary, projectCode, mergedStartPage, mergedEndPage)
        result[result.length - 1] = {
          content: mergedHeader + '\n\n' + mergedRaw,
          rawContent: mergedRaw,
          metadata: {
            ...prev.metadata,
            source_pages: mergedSourcePages,
            page_number: mergedStartPage,
          },
        }
        return
      }

      const sourcePagesLabel =
        chunkStartPage === chunkEndPage
          ? String(chunkStartPage)
          : `${chunkStartPage}-${chunkEndPage}`

      const header = buildHeader(boundary, projectCode, chunkStartPage, chunkEndPage)

      result.push({
        content: header + '\n\n' + rawContent,
        rawContent,
        metadata: {
          page_number: chunkStartPage,
          source_pages: sourcePagesLabel,
          csi_division: boundary.division !== '00' ? boundary.division : null,
          csi_division_name: boundary.divisionName ?? null,
          section_number: boundary.sectionNumber ?? null,
          section_title: boundary.title,
          document_category:
            boundary.sectionNumber !== null && boundary.division !== '00'
              ? 'technical_specification'
              : 'administrative',
          project_code: projectCode,
          document_id: documentId,
        },
      })
    }

    for (const para of paragraphs) {
      const addLength = currentChunkParts.length === 0 ? para.text.length : para.text.length + 2 // +2 for \n\n

      if (currentChunkLength + addLength > MAX_CHUNK_CHARS && currentChunkParts.length > 0) {
        flushChunk()
        currentChunkParts = []
        currentChunkLength = 0
        chunkStartPage = para.pageNumber
        chunkEndPage = para.pageNumber
      }

      currentChunkParts.push(para.text)
      currentChunkLength += addLength
      if (para.pageNumber > chunkEndPage) chunkEndPage = para.pageNumber
    }

    // Flush remaining
    flushChunk()
  }

  console.log(`[contextual-chunker] Generated ${result.length} chunks from ${boundaries.length} sections`)
  return result
}
