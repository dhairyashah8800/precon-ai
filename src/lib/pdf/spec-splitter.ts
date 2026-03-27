import { PDFParse } from 'pdf-parse'

export interface TOCEntry {
  section_number: string
  title: string
  division: string       // zero-padded: "01", "03", "31"
  division_name: string
  printed_page: number
}

export interface ParsedPDF {
  pages: Array<{ num: number; text: string }>
  totalPages: number
}

// "01 11 00" or "01 35 63.01" at start of line, then column gap, title, column gap, page number
const SECTION_LINE_RE =
  /^(\d{2} \d{2} \d{2}(?:\.\d{2})?)(?:\t|\s{2,})(.+?)(?:\t|\s{2,})(\d{1,4})\s*$/

// "DIVISION 1  GENERAL REQUIREMENTS" — title is ALL CAPS after the number
const DIVISION_LINE_RE =
  /^DIVISION\s+(\d+)\s+([A-Z][A-Z\s,&/()[\]-]+?)\s*$/

export async function parsePDF(pdfBuffer: Buffer): Promise<ParsedPDF> {
  const parser = new PDFParse({ data: pdfBuffer, verbosity: 0 })
  try {
    const result = await parser.getText({
      lineEnforce: true,
      // Higher threshold so spaces within "01 11 00" don't become tabs,
      // while large column gaps still do
      cellThreshold: 20,
      // Join close items with a space so "01" + "11" + "00" → "01 11 00"
      itemJoiner: ' ',
    })
    return {
      pages: result.pages as Array<{ num: number; text: string }>,
      totalPages: result.total,
    }
  } finally {
    await parser.destroy()
  }
}

export function parseTOCFromPages(
  pages: Array<{ num: number; text: string }>,
  maxPage = 30
): TOCEntry[] {
  const entries: TOCEntry[] = []
  let currentDivision = ''
  let currentDivisionName = ''
  let inSpecifications = false

  for (const page of pages) {
    if (page.num > maxPage) break

    // Skip blank / boilerplate pages
    if (page.text.trim().toUpperCase().includes('NO TEXT ON THIS PAGE')) continue

    for (const rawLine of page.text.split('\n')) {
      const line = rawLine.trim()
      if (!line || line.length < 4) continue

      // Skip known footer patterns
      if (/^RESAMSAF/i.test(line)) continue

      // Detect the SPECIFICATIONS block header — entries before this are
      // contract/legal content that lack CSI section numbers
      if (!inSpecifications && /^SPECIFICATIONS\b/i.test(line)) {
        inSpecifications = true
        continue
      }
      if (!inSpecifications) continue

      // Division header (no page number at end)
      const divMatch = line.match(DIVISION_LINE_RE)
      if (divMatch) {
        currentDivision = parseInt(divMatch[1]).toString().padStart(2, '0')
        currentDivisionName = divMatch[2].trim()
        continue
      }

      // Section entry (only valid once we're inside a division)
      if (currentDivision) {
        const secMatch = line.match(SECTION_LINE_RE)
        if (secMatch) {
          entries.push({
            section_number: secMatch[1],
            title: secMatch[2].trim(),
            division: currentDivision,
            division_name: currentDivisionName,
            printed_page: parseInt(secMatch[3]),
          })
        }
      }
    }
  }

  return entries
}

export function calculateOffsetFromPages(
  pages: Array<{ num: number; text: string }>,
  tocEntries: TOCEntry[]
): number {
  const candidates = tocEntries.slice(0, 3)
  if (candidates.length === 0) {
    throw new Error('No TOC entries to calculate offset from')
  }

  const offsets: number[] = []

  for (const entry of candidates) {
    // e.g. "SECTION 01 11 00" — allow optional dots for sub-sections
    const escapedNum = entry.section_number.replace(/\./g, '\\.')
    const re = new RegExp(`SECTION\\s+${escapedNum}`, 'i')

    for (const page of pages) {
      if (re.test(page.text)) {
        offsets.push(page.num - entry.printed_page)
        break
      }
    }
  }

  if (offsets.length === 0) {
    throw new Error(
      'Could not locate section headings in PDF. ' +
        'Verify headings use the format "SECTION XX XX XX".'
    )
  }

  if (!offsets.every(o => o === offsets[0])) {
    throw new Error(
      `Page offsets are inconsistent across first three sections ` +
        `(found: ${offsets.join(', ')}) — manual review needed`
    )
  }

  return offsets[0]
}

export function extractSectionText(
  pages: Array<{ num: number; text: string }>,
  startPdfPage: number,
  endPdfPage: number
): string {
  return pages
    .filter(p => p.num >= startPdfPage && p.num <= endPdfPage)
    .map(p => p.text)
    .join('\n\n')
}
