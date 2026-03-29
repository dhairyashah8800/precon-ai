import { PDFParse } from 'pdf-parse'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

export interface TocAnchor {
  title: string              // descriptive title only (e.g. "Reinforcing Steel")
  tocPage: number | null     // printed page number from TOC, null if not shown
  sectionNumber: string | null  // CSI number like "03 21 00" or null for admin articles
}

const TocAnchorSchema = z.object({
  title: z.string().min(1).max(500),
  tocPage: z.number().int().positive().nullable(),
  sectionNumber: z.string().nullable(),
})
const AnchorsSchema = z.array(TocAnchorSchema).min(1).max(1000)

/**
 * Extract raw text from each page of a PDF buffer.
 * Defaults to pages 1–50. Empty pages (image-only covers, etc.) are silently skipped.
 */
export async function extractPagesText(
  buffer: Buffer,
  startPage = 1,
  endPage = 50
): Promise<{ pageNumber: number; text: string }[]> {
  const parser = new PDFParse({ data: buffer, verbosity: 0 })
  let allPages: Array<{ num: number; text: string }>

  try {
    const result = await parser.getText({ lineEnforce: true })
    allPages = result.pages as Array<{ num: number; text: string }>
  } finally {
    await parser.destroy()
  }

  const results: { pageNumber: number; text: string }[] = []

  for (const page of allPages) {
    if (page.num < startPage || page.num > endPage) continue
    const text = page.text?.trim()
    if (!text) continue // skip empty/image-only pages silently
    results.push({ pageNumber: page.num, text })
  }

  return results
}

/**
 * Call Claude to extract section/article title anchors from TOC pages.
 * Accepts the output of extractPagesText and returns a validated TocAnchor[].
 */
export async function extractAnchors(
  pagesText: { pageNumber: number; text: string }[]
): Promise<TocAnchor[]> {
  const concatenatedText = pagesText
    .map(({ pageNumber, text }) => `\n--- PAGE ${pageNumber} ---\n${text}`)
    .join('\n')

  const anthropic = new Anthropic()

  console.log('[anchors] Calling Claude for anchor extraction...')

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    system: `You are a construction document parser specializing in NYC government agency specification volumes.

You are reading the first ~50 pages of a specification volume PDF. Your task is to extract every section title or article title that appears in the Table of Contents (TOC), List of Contents, or Index.

CRITICAL RULES:
1. Return the EXACT literal title text as it appears, but SEPARATE the CSI section number from the descriptive title.
2. For CSI technical sections (e.g. "01 11 00    Summary of Work    320"), return:
   - sectionNumber: "01 11 00" (the leading digits in XX XX XX or XX XX XX.XX format)
   - title: "Summary of Work" (the descriptive part only, no section number)
   - tocPage: 320 (the printed page number, as an integer)
3. For administrative articles without a CSI number (e.g. "ARTICLE 15. LIQUIDATED DAMAGES"), return:
   - sectionNumber: null
   - title: "ARTICLE 15. LIQUIDATED DAMAGES" (the full string exactly as it appears)
   - tocPage: the page number if one is shown next to it, otherwise null
4. Include ALL levels of entries — top-level articles, sub-sections, appendices, exhibits, schedules, attachments.
5. EXCLUDE: "Table of Contents" itself, header/footer text, volume titles, agency logos/seals.
6. EXCLUDE: Generic structural labels like "Part 1", "Part 2" UNLESS they have a descriptive title.
7. The order of the returned array must match the order they appear in the document.
8. tocPage must be an integer (not a string). If no page number is shown, use null.

Return ONLY a valid JSON array of objects. No markdown, no backticks, no explanation.

Example output:
[
  {"sectionNumber": "01 11 00", "title": "Summary of Work", "tocPage": 320},
  {"sectionNumber": "01 33 00", "title": "Submittal Procedures", "tocPage": 333},
  {"sectionNumber": "03 30 00", "title": "Cast-in-Place Concrete", "tocPage": 1080},
  {"sectionNumber": null, "title": "ARTICLE 15. LIQUIDATED DAMAGES", "tocPage": null},
  {"sectionNumber": null, "title": "EXHIBIT A – WAGE SCHEDULE", "tocPage": 45}
]`,
    messages: [
      {
        role: 'user',
        content: `Extract all section/article titles from the Table of Contents in this specification volume text:\n\n${concatenatedText}`,
      },
    ],
  })

  const rawText = response.content[0].type === 'text' ? response.content[0].text : ''

  // Strip everything before the first '[' and after the last ']'
  const firstBracket = rawText.indexOf('[')
  const lastBracket = rawText.lastIndexOf(']')

  let cleaned = rawText
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    cleaned = rawText.slice(firstBracket, lastBracket + 1)
  }

  // Also strip accidental markdown fences
  cleaned = cleaned.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(
      `Anchor extraction failed: Claude returned invalid JSON. Got: ${rawText.slice(0, 200)}`
    )
  }

  try {
    return AnchorsSchema.parse(parsed)
  } catch (e) {
    throw new Error(
      `Anchor extraction failed: Claude returned invalid format. Expected TocAnchor[]. Got: ${rawText.slice(0, 200)}. Zod error: ${e}`
    )
  }
}
