import type { TocAnchor } from './anchor-extractor'

// CSI division number → name mapping (Divisions 01–49)
const CSI_DIVISIONS: Record<string, string> = {
  '01': 'General Requirements',
  '02': 'Existing Conditions',
  '03': 'Concrete',
  '04': 'Masonry',
  '05': 'Metals',
  '06': 'Wood, Plastics, and Composites',
  '07': 'Thermal and Moisture Protection',
  '08': 'Openings',
  '09': 'Finishes',
  '10': 'Specialties',
  '11': 'Equipment',
  '12': 'Furnishings',
  '13': 'Special Construction',
  '14': 'Conveying Equipment',
  '21': 'Fire Suppression',
  '22': 'Plumbing',
  '23': 'Heating, Ventilating, and Air Conditioning',
  '25': 'Integrated Automation',
  '26': 'Electrical',
  '27': 'Communications',
  '28': 'Electronic Safety and Security',
  '31': 'Earthwork',
  '32': 'Exterior Improvements',
  '33': 'Utilities',
  '34': 'Transportation',
  '35': 'Waterway and Marine Construction',
  '40': 'Process Integration',
  '41': 'Material Processing and Handling Equipment',
  '42': 'Process Heating, Cooling, and Drying Equipment',
  '43': 'Process Gas and Liquid Handling, Purification, and Storage Equipment',
  '44': 'Pollution and Waste Control Equipment',
  '45': 'Industry-Specific Manufacturing Equipment',
  '46': 'Water and Wastewater Equipment',
  '48': 'Electrical Power Generation',
}

export interface AnchorMatch {
  title: string
  page: number              // PDF page where found in body
  tocPage: number | null    // printed page number from TOC
  sectionNumber: string | null
}

export interface SectionBoundary {
  title: string
  startPage: number
  endPage: number
  sectionNumber: string | null
  division: string           // always non-null: '00' for admin, e.g. '03' for Concrete
  divisionName: string | null  // from CSI_DIVISIONS lookup, null for admin ('00')
  matchSource: 'body' | 'toc-fallback'
}

/**
 * Build a regex that matches a CSI section header at the START of a line.
 * Body headers look like: "SECTION 03 30 00 – TITLE" at the beginning of a line.
 */
function buildCsiPattern(sectionNumber: string): RegExp {
  const digits = sectionNumber.replace(/\s+/g, '')
  const d1 = digits.slice(0, 2)
  const d2 = digits.slice(2, 4)
  const d3 = digits.slice(4, 6)

  const sep = '[\\s\\-]?'
  const numPattern = `${d1}${sep}${d2}${sep}${d3}`
  return new RegExp(`^\\s*SECTION\\s+${numPattern}`, 'mi')
}

/**
 * Build patterns for administrative anchors (articles, chapters, etc.)
 */
function buildAdminPatterns(title: string): RegExp[] {
  const patterns: RegExp[] = []

  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  // Pattern 1: literal title at start of line, flexible on punctuation and whitespace
  const normalized = title
    .replace(/\s+/g, '\\s+')
    .replace(/[.:\-–—]/g, '[.:\\-–—]?')
  patterns.push(new RegExp(`^\\s*${normalized}`, 'mi'))

  // Pattern 2: just the descriptive part after "ARTICLE NN." / "CHAPTER X:" etc.
  const titleMatch = title.match(/^(?:ARTICLE|CHAPTER|SECTION|APPENDIX|EXHIBIT|SCHEDULE|ATTACHMENT)\s+[\dIVXivx]+[.\s:\-–—]*(.+)$/i)
  if (titleMatch) {
    const titlePart = escapeRegex(titleMatch[1].trim())
    if (titlePart.length > 4) {
      patterns.push(new RegExp(`^\\s*${titlePart}`, 'mi'))
    }
  }

  return patterns
}

/**
 * Calculate the mode offset between PDF page numbers and printed TOC page numbers.
 * Uses matched anchors that have both a body page and a TOC page.
 */
export function calculatePageOffset(
  matchedAnchors: Array<{ page: number; tocPage: number | null }>
): number {
  const offsets = matchedAnchors
    .filter((a) => a.tocPage !== null)
    .map((a) => a.page - (a.tocPage as number))

  if (offsets.length === 0) {
    console.log('[anchor-match] No anchors with TOC pages available — using offset 0')
    return 0
  }

  // Count occurrences of each offset value
  const counts = new Map<number, number>()
  for (const offset of offsets) {
    counts.set(offset, (counts.get(offset) ?? 0) + 1)
  }

  // Find the mode
  let mode = offsets[0]
  let maxCount = 0
  for (const [offset, count] of counts.entries()) {
    if (count > maxCount) {
      maxCount = count
      mode = offset
    }
  }

  // Validate consistency
  const min = Math.min(...offsets)
  const max = Math.max(...offsets)
  if (max - min > 2) {
    console.warn(
      `[anchor-match] WARNING: Page offsets vary by ${max - min} (min=${min}, max=${max}) — using mode ${mode >= 0 ? '+' : ''}${mode}`
    )
  }

  console.log(
    `[anchor-match] Detected page offset: ${mode >= 0 ? '+' : ''}${mode} (from ${offsets.length} matched anchors with TOC pages)`
  )
  return mode
}

/**
 * Pass 0.2 — Anchor Matching.
 *
 * Given the TocAnchor[] from Pass 0.1 and the full PDF page text,
 * find the exact page where each section begins.
 *
 * Returns matched anchors (found in body) and unmatched anchors (not found).
 *
 * @param anchors    - TocAnchor[] from extractAnchors()
 * @param pagesText  - { pageNumber, text }[] covering the full document
 * @param tocEndPage - last page of TOC/front matter to skip; defaults to 30
 */
export function matchAnchors(
  anchors: TocAnchor[],
  pagesText: { pageNumber: number; text: string }[],
  tocEndPage = 30
): { matched: AnchorMatch[]; unmatched: TocAnchor[] } {
  console.log(
    `[anchor-match] Searching for ${anchors.length} anchors across ${pagesText.length} pages (skipping through page ${tocEndPage})...`
  )

  // Only search body pages (after TOC/front matter)
  const bodyPages = pagesText.filter((p) => p.pageNumber > tocEndPage)

  const matched: AnchorMatch[] = []
  const unmatched: TocAnchor[] = []

  for (const anchor of anchors) {
    let foundOnPage: number | null = null

    if (anchor.sectionNumber) {
      // CSI section: search for "SECTION XX XX XX" header in body
      const pattern = buildCsiPattern(anchor.sectionNumber)

      for (const page of bodyPages) {
        if (pattern.test(page.text)) {
          foundOnPage = page.pageNumber
          break
        }
      }

      // Fuzzy fallback: just the section number digits, no "SECTION" prefix
      if (foundOnPage === null) {
        const digits = anchor.sectionNumber.replace(/\s+/g, '')
        const d1 = digits.slice(0, 2)
        const d2 = digits.slice(2, 4)
        const d3 = digits.slice(4, 6)
        const sep = '[\\s\\-]?'
        const fuzzyPattern = new RegExp(`\\b${d1}${sep}${d2}${sep}${d3}\\b`, 'i')

        for (const page of bodyPages) {
          if (fuzzyPattern.test(page.text)) {
            foundOnPage = page.pageNumber
            break
          }
        }
      }
    } else {
      // Administrative anchor: search by title text
      const patterns = buildAdminPatterns(anchor.title)

      outer: for (const pattern of patterns) {
        for (const page of bodyPages) {
          if (pattern.test(page.text)) {
            foundOnPage = page.pageNumber
            break outer
          }
        }
      }
    }

    if (foundOnPage !== null) {
      matched.push({
        title: anchor.title,
        page: foundOnPage,
        tocPage: anchor.tocPage,
        sectionNumber: anchor.sectionNumber,
      })
    } else {
      console.log(`[anchor-match] WARNING: Could not find "${anchor.title}" in PDF body`)
      unmatched.push(anchor)
    }
  }

  console.log(`[anchor-match] Matched ${matched.length}/${anchors.length} anchors`)
  if (unmatched.length > 0) {
    console.log(
      `[anchor-match] Unmatched (${unmatched.length}): ${JSON.stringify(unmatched.map((a) => a.title))}`
    )
  }

  return { matched, unmatched }
}

const OFFSET_TOLERANCE = 20 // pages — body match more than this far from expected TOC position is suspect

/**
 * Given matched anchors, unmatched anchors (with TOC fallback), and a page offset,
 * calculate page start/end boundaries for every section.
 *
 * Unmatched anchors with a tocPage are placed using: tocPage + offset.
 * Unmatched anchors without a tocPage are dropped (no location info available).
 */
export function calculateBoundaries(
  matched: AnchorMatch[],
  unmatched: TocAnchor[],
  offset: number,
  totalPages: number
): SectionBoundary[] {
  // Validate body-matched anchors against their expected TOC position.
  // If the body match is more than OFFSET_TOLERANCE pages from tocPage + offset,
  // the match likely hit a cross-reference instead of the actual section header.
  const validatedMatched: AnchorMatch[] = []
  const demotedToFallback: TocAnchor[] = []

  for (const match of matched) {
    if (match.tocPage !== null) {
      const expectedPage = match.tocPage + offset
      const drift = Math.abs(match.page - expectedPage)
      if (drift > OFFSET_TOLERANCE) {
        console.log(
          `[anchor-match] Demoting "${match.title}": body found page ${match.page}, expected ~${expectedPage} (drift: ${drift}) — using TOC fallback`
        )
        demotedToFallback.push({
          title: match.title,
          tocPage: match.tocPage,
          sectionNumber: match.sectionNumber,
        })
      } else {
        validatedMatched.push(match)
      }
    } else {
      // No TOC page to compare against — trust the body match
      validatedMatched.push(match)
    }
  }

  console.log(
    `[anchor-match] Validated body matches: ${validatedMatched.length} kept, ${demotedToFallback.length} demoted to TOC fallback`
  )

  const allFallbacks = [...unmatched, ...demotedToFallback]

  interface SectionEntry {
    title: string
    startPage: number
    sectionNumber: string | null
    matchSource: 'body' | 'toc-fallback'
  }

  const allSections: SectionEntry[] = []

  // Add validated body-matched anchors
  for (const m of validatedMatched) {
    allSections.push({
      title: m.title,
      startPage: m.page,
      sectionNumber: m.sectionNumber,
      matchSource: 'body',
    })
  }

  // Add unmatched + demoted anchors with TOC page fallback
  let fallbackCount = 0
  for (const u of allFallbacks) {
    if (u.tocPage !== null) {
      const estimatedPage = Math.max(1, Math.min(u.tocPage + offset, totalPages))
      console.log(
        `[anchor-match] Using TOC fallback for "${u.title}": tocPage ${u.tocPage} + offset ${offset} = PDF page ${estimatedPage}`
      )
      allSections.push({
        title: u.title,
        startPage: estimatedPage,
        sectionNumber: u.sectionNumber,
        matchSource: 'toc-fallback',
      })
      fallbackCount++
    } else {
      console.log(
        `[anchor-match] Skipping "${u.title}": no body match and no TOC page number`
      )
    }
  }

  // Sort all sections by start page ascending
  allSections.sort((a, b) => a.startPage - b.startPage)

  // Calculate end pages: each section ends at the next section's start - 1
  const boundaries: SectionBoundary[] = allSections.map((section, idx) => {
    const nextSection = allSections[idx + 1]
    const endPage = nextSection ? nextSection.startPage - 1 : totalPages

    const division = section.sectionNumber
      ? section.sectionNumber.replace(/\s+/g, '').slice(0, 2)
      : '00'

    return {
      title: section.title,
      startPage: section.startPage,
      endPage: Math.max(section.startPage, endPage), // never negative span
      sectionNumber: section.sectionNumber,
      division,
      divisionName: CSI_DIVISIONS[division] ?? null,
      matchSource: section.matchSource,
    }
  })

  // Warn on suspiciously large page ranges
  for (const b of boundaries) {
    const span = b.endPage - b.startPage + 1
    if (span > 90) {
      console.warn(
        `[anchor-match] WARNING: "${b.title}" spans ${span} pages (${b.startPage}–${b.endPage}) — possible issue (source: ${b.matchSource})`
      )
    }
    if (b.startPage > b.endPage) {
      console.warn(
        `[anchor-match] WARNING: "${b.title}" has inverted range (start ${b.startPage} > end ${b.endPage}) — boundary ordering error`
      )
    }
  }

  console.log(
    `[anchor-match] Calculated ${boundaries.length} section boundaries (${validatedMatched.length} body-matched, ${fallbackCount} toc-fallback)`
  )
  return boundaries
}
