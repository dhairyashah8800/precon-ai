import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { parseAndChunkPDF } from '@/lib/pdf/simple-parser'

const EMBED_BATCH_SIZE = 20
const EMBED_BATCH_DELAY_MS = 100

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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
    .select('id, project_id, org_id, file_path, doc_type')
    .eq('id', body.document_id)
    .eq('project_id', projectId)
    .eq('org_id', userProfile.org_id)
    .single()

  if (docError || !document) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }
  // Clean up any chunks from a previous failed attempt before re-parsing
  await serviceClient.from('chunks').delete()
    .eq('project_id', projectId)
    .eq('document_id', document.id)

  // Download PDF via service role (bypasses RLS for large file access)
  console.log(`[parse] Downloading ${document.file_path}`)
  const { data: fileBlob, error: storageError } = await serviceClient.storage
    .from('project-files')
    .download(document.file_path)

  if (storageError || !fileBlob) {
    return NextResponse.json(
      { error: `Failed to download PDF: ${storageError?.message ?? 'unknown'}` },
      { status: 500 }
    )
  }

  const pdfBuffer = Buffer.from(await fileBlob.arrayBuffer())
  console.log(`[parse] PDF downloaded (${(pdfBuffer.length / 1024 / 1024).toFixed(1)} MB)`)

  // Extract + chunk
  let chunks: Awaited<ReturnType<typeof parseAndChunkPDF>>
  try {
    chunks = await parseAndChunkPDF(pdfBuffer)
  } catch (err) {
    return NextResponse.json(
      { error: `PDF parsing failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }
  console.log(`[parse] Extracted ${chunks.length} chunks`)

  // Embed in batches, collect results
  const embeddings: number[][] = []
  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBED_BATCH_SIZE)
    console.log(`[parse] Embedding batch ${Math.floor(i / EMBED_BATCH_SIZE) + 1}/${Math.ceil(chunks.length / EMBED_BATCH_SIZE)}`)

    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: batch.map((c) => c.content),
    })

    embeddings.push(...response.data.map((d) => d.embedding))

    if (i + EMBED_BATCH_SIZE < chunks.length) {
      await sleep(EMBED_BATCH_DELAY_MS)
    }
  }

  // Insert chunks — on any failure, roll back by deleting what we inserted
  const insertedIds: string[] = []
  try {
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      const { data: row, error: insertError } = await serviceClient
        .from('chunks')
        .insert({
          project_id: projectId,
          document_id: document.id,
          org_id: document.org_id,
          content: chunk.content,
          embedding: embeddings[i],
          metadata: chunk.metadata,
        })
        .select('id')
        .single()

      if (insertError) {
        throw new Error(`Chunk ${i} insert failed: ${insertError.message}`)
      }
      insertedIds.push(row.id)
    }
  } catch (err) {
    // Roll back partial inserts
    if (insertedIds.length > 0) {
      await serviceClient.from('chunks').delete().in('id', insertedIds)
    }
    return NextResponse.json(
      { error: `Failed to store chunks: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }

  // Mark document as parsed
  await supabase
    .from('documents')
    .update({ parsed: true })
    .eq('id', document.id)

  console.log(`[parse] Done — ${chunks.length} chunks stored`)
  return NextResponse.json({ chunks_created: chunks.length })
}
