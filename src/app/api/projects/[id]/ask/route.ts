import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `You are a construction specification analyst for heavy civil government projects. You answer questions using ONLY the specification excerpts provided below.

RULES:
- For every factual claim, cite the source page(s) in brackets like [Page 45] or [Pages 45-46]
- If the specifications don't contain the answer, say: "I don't see this covered in the uploaded specifications."
- Never make up information or cite pages that weren't provided
- Be specific and technical — your audience is experienced civil engineers and estimators
- When multiple spec sections are relevant, reference all of them
- Use proper construction terminology`

interface HistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ChunkResult {
  id: string
  content: string
  metadata: {
    page_number?: number
    source_pages?: string
    [key: string]: unknown
  }
  similarity: number
}

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

  // Parse request body
  let question: string
  let history: HistoryMessage[] = []
  try {
    const body = await request.json()
    question = body.question
    history = body.history ?? []
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!question || typeof question !== 'string' || !question.trim()) {
    return NextResponse.json({ error: 'question is required' }, { status: 400 })
  }

  // Verify project belongs to user's org
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('org_id', userProfile.org_id)
    .single()

  if (projectError || !project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  // Step 1: Validate chunks exist for this project
  const { count } = await serviceClient
    .from('chunks')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)

  if (!count || count === 0) {
    return NextResponse.json(
      { error: 'No documents have been parsed yet. Upload and parse spec books first.' },
      { status: 400 }
    )
  }

  // Step 2: Embed the question
  const embeddingResponse = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: question.trim(),
  })
  const questionEmbedding = embeddingResponse.data[0].embedding

  // Step 3: Vector search via service client (bypasses RLS, filtered by project_id)
  const { data: chunks, error: searchError } = await serviceClient.rpc('match_chunks_simple', {
    query_embedding: questionEmbedding,
    match_project_id: projectId,
    match_count: 15,
    match_threshold: 0.3,
  }) as { data: ChunkResult[] | null; error: unknown }

  if (searchError) {
    console.error('[ask] Vector search error:', searchError)
    return NextResponse.json({ error: 'Vector search failed' }, { status: 500 })
  }

  const matchedChunks: ChunkResult[] = chunks ?? []

  // Step 4: Build context block from retrieved chunks
  const contextLines = matchedChunks.map((chunk) => {
    const pageLabel = chunk.metadata?.source_pages
      ? `Pages ${chunk.metadata.source_pages}`
      : chunk.metadata?.page_number
        ? `Page ${chunk.metadata.page_number}`
        : 'Page unknown'
    return `[${pageLabel}] (Similarity: ${(chunk.similarity * 100).toFixed(0)}%)\n${chunk.content}`
  })

  const contextBlock =
    matchedChunks.length > 0
      ? `SPECIFICATION EXCERPTS:\n---\n${contextLines.join('\n---\n')}\n---`
      : 'SPECIFICATION EXCERPTS:\n(No relevant specification sections found for this question.)'

  // Build Claude messages array
  const claudeMessages: Anthropic.MessageParam[] = []

  // Add conversation history (previous turns, role/content only)
  if (history.length > 0) {
    for (const msg of history) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        claudeMessages.push({ role: msg.role, content: msg.content })
      }
    }
  }

  // Add current question with retrieved context
  claudeMessages.push({
    role: 'user',
    content: `${contextBlock}\n\nQUESTION: ${question.trim()}`,
  })

  // Step 4b: Build sources array (deduplicated by page, highest similarity kept)
  const sourceMap = new Map<string, {
    page: number | null
    pages: string | null
    excerpt: string
    similarity: number
  }>()

  for (const chunk of matchedChunks) {
    const pageKey = chunk.metadata?.source_pages
      ? `pages:${chunk.metadata.source_pages}`
      : chunk.metadata?.page_number
        ? `page:${chunk.metadata.page_number}`
        : `id:${chunk.id}`

    const existing = sourceMap.get(pageKey)
    if (!existing || chunk.similarity > existing.similarity) {
      sourceMap.set(pageKey, {
        page: chunk.metadata?.page_number ?? null,
        pages: chunk.metadata?.source_pages ?? null,
        excerpt: chunk.content.substring(0, 200) + (chunk.content.length > 200 ? '...' : ''),
        similarity: chunk.similarity,
      })
    }
  }

  const sources = Array.from(sourceMap.values()).sort((a, b) => {
    const pa = a.page ?? (a.pages ? parseInt(a.pages) : 999999)
    const pb = b.page ?? (b.pages ? parseInt(b.pages) : 999999)
    return pa - pb
  })

  // Step 5: Stream Claude response as SSE
  const encoder = new TextEncoder()

  const readable = new ReadableStream({
    async start(controller) {
      try {
        // Send sources first
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'sources', sources })}\n\n`)
        )

        // Stream Claude response
        const stream = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          temperature: 0,
          system: SYSTEM_PROMPT,
          messages: claudeMessages,
          stream: true,
        })

        for await (const event of stream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: 'token', text: event.delta.text })}\n\n`
              )
            )
          }
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`))
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Streaming error'
        console.error('[ask] Stream error:', err)
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'error', message })}\n\n`)
        )
      } finally {
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
