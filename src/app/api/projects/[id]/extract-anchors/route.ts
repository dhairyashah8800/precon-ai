import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { extractPagesText, extractAnchors } from '@/lib/pdf/anchor-extractor'
import { matchAnchors, calculateBoundaries, calculatePageOffset } from '@/lib/pdf/anchor-matcher'
import type { TocAnchor } from '@/lib/pdf/anchor-extractor'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params
  const supabase = await createClient()
  const serviceClient = createServiceClient()

  // Auth check
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userProfile } = await supabase
    .from('users')
    .select('org_id')
    .eq('id', user.id)
    .single()
  if (!userProfile) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const body = (await request.json()) as { document_id?: string }
  if (!body.document_id) {
    return NextResponse.json({ error: 'document_id required' }, { status: 400 })
  }

  // Fetch + authorize document (RLS ensures org ownership)
  const { data: document, error: docError } = await supabase
    .from('documents')
    .select('id, project_id, org_id, file_path')
    .eq('id', body.document_id)
    .eq('project_id', projectId)
    .eq('org_id', userProfile.org_id)
    .single()

  if (docError || !document) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  // Download PDF via service role
  console.log(`[anchors] Downloading PDF: ${document.file_path}`)
  const { data: fileBlob, error: storageError } = await serviceClient.storage
    .from('project-files')
    .download(document.file_path)

  if (storageError || !fileBlob) {
    return NextResponse.json(
      { error: `PDF download failed: ${storageError?.message ?? 'unknown'}` },
      { status: 500 }
    )
  }

  const pdfBuffer = Buffer.from(await fileBlob.arrayBuffer())

  // Pass 0.1 — Extract TOC text (first 50 pages) and call Claude for anchors
  let tocPagesText: Awaited<ReturnType<typeof extractPagesText>>
  try {
    tocPagesText = await extractPagesText(pdfBuffer, 1, 50)
  } catch (err) {
    return NextResponse.json(
      { error: `Text extraction failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }
  console.log(`[anchors] Extracted text from ${tocPagesText.length} TOC pages`)

  let anchors: TocAnchor[]
  try {
    anchors = await extractAnchors(tocPagesText)
  } catch (err) {
    return NextResponse.json(
      { error: `Anchor extraction failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }
  console.log(`[anchors] Claude returned ${anchors.length} anchors`)

  // Pass 0.2 — Extract ALL pages text and run anchor matching
  let allPagesText: Awaited<ReturnType<typeof extractPagesText>>
  try {
    allPagesText = await extractPagesText(pdfBuffer, 1, 9999)
  } catch (err) {
    return NextResponse.json(
      { error: `Full text extraction failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }
  const totalPages = allPagesText.length > 0
    ? allPagesText[allPagesText.length - 1].pageNumber
    : 0
  console.log(`[anchors] Extracted full document: ${totalPages} pages`)

  const { matched, unmatched } = matchAnchors(anchors, allPagesText)
  const offset = calculatePageOffset(matched)
  const boundaries = calculateBoundaries(matched, unmatched, offset, totalPages)

  const csiCount = anchors.filter((a) => a.sectionNumber !== null).length
  const adminCount = anchors.length - csiCount

  return NextResponse.json({
    anchors,
    matched,
    unmatched,
    boundaries,
    page_offset: offset,
    stats: {
      total_anchors: anchors.length,
      matched: matched.length,
      unmatched: unmatched.length,
      csi_sections: csiCount,
      administrative_sections: adminCount,
    },
  })
}
