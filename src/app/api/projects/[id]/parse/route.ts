import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { extractPagesText, extractAnchors } from '@/lib/pdf/anchor-extractor'
import { matchAnchors, calculateBoundaries, calculatePageOffset } from '@/lib/pdf/anchor-matcher'
import { contextualChunk } from '@/lib/pdf/contextual-chunker'

export const maxDuration = 300

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
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

  // Fetch + authorize document
  const { data: document, error: docError } = await supabase
    .from('documents')
    .select('id, project_id, org_id, file_path, file_name, doc_type')
    .eq('id', body.document_id)
    .eq('project_id', projectId)
    .eq('org_id', userProfile.org_id)
    .single()

  if (docError || !document) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  try {
    // Download PDF via service role
    console.log(`[parse] Downloading PDF: ${document.file_name ?? document.file_path}`)
    const { data: fileBlob, error: storageError } = await serviceClient.storage
      .from('project-files')
      .download(document.file_path)

    if (storageError || !fileBlob) {
      return NextResponse.json(
        { error: `Failed to download PDF: ${storageError?.message ?? 'unknown'}` },
        { status: 500 }
      )
    }

    const buffer = Buffer.from(await fileBlob.arrayBuffer())
    console.log(`[parse] PDF downloaded (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`)

    // Extract ALL pages text
    console.log(`[parse] Extracting text from all pages...`)
    const allPages = await extractPagesText(buffer, 1, 9999)
    console.log(`[parse] Extracted text from ${allPages.length} pages`)

    // Pass 0.1: Anchor extraction (first 50 pages → Claude)
    console.log(`[parse] Pass 0.1: Extracting TOC anchors via Claude...`)
    const tocPages = allPages.filter((p) => p.pageNumber <= 50)
    const anchors = await extractAnchors(tocPages)
    console.log(`[parse] Found ${anchors.length} anchors`)

    // Pass 0.2: Anchor matching + TOC fallback
    console.log(`[parse] Pass 0.2: Matching anchors to PDF pages...`)
    const { matched, unmatched } = matchAnchors(anchors, allPages)
    const offset = calculatePageOffset(matched)
    const boundaries = calculateBoundaries(matched, unmatched, offset, allPages.length)
    const unmatchedAnchors = unmatched.map((a) => a.title)
    console.log(
      `[parse] Matched ${matched.length}/${anchors.length} anchors → ${boundaries.length} sections (${unmatched.length} used TOC fallback)`
    )

    // Look up project code for contextual headers
    const { data: project } = await serviceClient
      .from('projects')
      .select('code')
      .eq('id', projectId)
      .single()
    const projectCode = (project as { code?: string } | null)?.code ?? 'UNKNOWN'

    // Pass 2: Contextual chunking
    console.log(`[parse] Pass 2: Contextual chunking...`)
    const chunks = contextualChunk(boundaries, allPages, projectCode, document.id)
    console.log(`[parse] Generated ${chunks.length} contextual chunks`)

    // Cleanup previous parse data
    console.log(`[parse] Cleaning up previous parse data...`)
    await serviceClient.from('chunks').delete().eq('document_id', document.id)
    await serviceClient.from('spec_sections').delete().eq('document_id', document.id)

    // Insert spec_sections
    console.log(`[parse] Inserting ${boundaries.length} spec sections...`)
    for (let i = 0; i < boundaries.length; i++) {
      const boundary = boundaries[i]
      const sectionText = allPages
        .filter((p) => p.pageNumber >= boundary.startPage && p.pageNumber <= boundary.endPage)
        .map((p) => p.text)
        .join('\n')

      const insertPayload = {
        document_id: document.id,
        project_id: projectId,
        org_id: document.org_id,
        division: boundary.division,               // always non-null: '00' for admin
        section_number: boundary.sectionNumber ?? 'unknown',
        title: boundary.title,
        raw_text: sectionText.substring(0, 100000),
        page_start: boundary.startPage,
        page_end: boundary.endPage,
      }

      if (i === 0) {
        console.log(`[parse] First spec_section insert payload:`, JSON.stringify(insertPayload, null, 2))
      }

      const { error: sectionError } = await serviceClient.from('spec_sections').insert(insertPayload)
      if (sectionError) {
        console.error(`[parse] spec_sections insert failed for "${boundary.title}":`, sectionError)
      }
    }

    // Embed chunks in batches of 20
    console.log(`[parse] Embedding ${chunks.length} chunks...`)
    const BATCH_SIZE = 20
    const embeddedChunks: {
      content: string
      embedding: number[]
      metadata: object
      org_id: string
      project_id: string
      document_id: string
    }[] = []

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE)
      console.log(
        `[parse] Embedding batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(chunks.length / BATCH_SIZE)}`
      )

      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: batch.map((c) => c.content), // embed WITH contextual header
      })

      for (let j = 0; j < batch.length; j++) {
        embeddedChunks.push({
          content: batch[j].rawContent, // store WITHOUT header for display
          embedding: response.data[j].embedding,
          metadata: batch[j].metadata,
          org_id: document.org_id,
          project_id: projectId,
          document_id: document.id,
        })
      }

      await new Promise((r) => setTimeout(r, 100))
    }

    // Insert chunks in batches of 50
    console.log(`[parse] Storing ${embeddedChunks.length} chunks in database...`)
    for (let i = 0; i < embeddedChunks.length; i += 50) {
      const batch = embeddedChunks.slice(i, i + 50)
      const { error: insertError } = await serviceClient.from('chunks').insert(
        batch.map((c) => ({
          org_id: document.org_id,
          project_id: c.project_id,
          document_id: c.document_id,
          content: c.content,
          embedding: JSON.stringify(c.embedding),
          metadata: c.metadata,
        }))
      )
      if (insertError) {
        console.error(`[parse] Chunk insert error at batch ${i}:`, insertError)
        await serviceClient.from('chunks').delete().eq('document_id', document.id)
        await serviceClient.from('spec_sections').delete().eq('document_id', document.id)
        return NextResponse.json(
          { error: `Failed to store chunks: ${insertError.message}` },
          { status: 500 }
        )
      }
    }

    // Mark document as parsed
    await serviceClient.from('documents').update({ parsed: true }).eq('id', document.id)

    console.log(
      `[parse] Complete: ${boundaries.length} sections, ${embeddedChunks.length} chunks`
    )

    return NextResponse.json({
      sections_found: boundaries.length,
      chunks_created: embeddedChunks.length,
      anchors_total: anchors.length,
      anchors_matched: matched.length,
      anchors_unmatched: unmatchedAnchors,
      page_offset: offset,
    })
  } catch (err) {
    console.error('[parse] Unhandled error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
