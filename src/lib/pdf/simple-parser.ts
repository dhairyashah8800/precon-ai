import { PDFParse } from 'pdf-parse'

const TARGET_CHARS = 2000

export interface Chunk {
  content: string
  page_number: number
  metadata: {
    page_number: number
    source_pages: string
  }
}

function cleanText(text: string): string {
  return text
    .replace(/\x00/g, '')                        // remove null bytes
    .replace(/\\u0000/g, '')                     // remove literal \u0000 escape sequences
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // strip control chars except \t \n \r
    .replace(/[ \t]+/g, ' ')                     // collapse horizontal whitespace
    .replace(/\n{3,}/g, '\n\n')                  // cap consecutive newlines at 2
    .trim()
}

// Split a single long page into chunks at paragraph boundaries.
function splitLongPage(text: string, pageNum: number): Chunk[] {
  const paragraphs = text.split(/\n\n+/)
  const chunks: Chunk[] = []
  let buffer = ''

  for (const para of paragraphs) {
    const candidate = buffer ? buffer + '\n\n' + para : para
    if (candidate.length <= TARGET_CHARS) {
      buffer = candidate
    } else {
      if (buffer) {
        chunks.push(makeChunk(buffer, pageNum, pageNum))
      }
      // A single paragraph that is still over the limit goes in as-is
      buffer = para
    }
  }
  if (buffer) {
    chunks.push(makeChunk(buffer, pageNum, pageNum))
  }
  return chunks
}

function makeChunk(content: string, startPage: number, endPage: number): Chunk {
  const source_pages =
    startPage === endPage ? `page ${startPage}` : `pages ${startPage}-${endPage}`
  return {
    content,
    page_number: startPage,
    metadata: { page_number: startPage, source_pages },
  }
}

export async function parseAndChunkPDF(buffer: Buffer): Promise<Chunk[]> {
  const parser = new PDFParse({ data: buffer, verbosity: 0 })
  let pages: Array<{ num: number; text: string }>

  try {
    const result = await parser.getText({ lineEnforce: true })
    pages = result.pages as Array<{ num: number; text: string }>
  } finally {
    await parser.destroy()
  }

  const chunks: Chunk[] = []
  let bufContent = ''
  let bufStart = 1
  let bufEnd = 1

  function flush() {
    if (!bufContent) return
    chunks.push(makeChunk(bufContent, bufStart, bufEnd))
    bufContent = ''
  }

  for (const page of pages) {
    const text = cleanText(page.text)
    if (!text) continue

    // Page is long — flush buffer first, then split page by paragraphs
    if (text.length > TARGET_CHARS) {
      flush()
      chunks.push(...splitLongPage(text, page.num))
      continue
    }

    if (!bufContent) {
      bufContent = text
      bufStart = page.num
      bufEnd = page.num
    } else if (bufContent.length + 2 + text.length <= TARGET_CHARS) {
      bufContent += '\n\n' + text
      bufEnd = page.num
    } else {
      flush()
      bufContent = text
      bufStart = page.num
      bufEnd = page.num
    }
  }

  flush()
  return chunks
}
