import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params
  const serviceClient = createServiceClient()

  const { data, error } = await serviceClient
    .from('chunks')
    .select('metadata')
    .eq('project_id', projectId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Group by section_number + section_title
  const sectionMap = new Map<string, {
    section_number: string
    section_title: string
    chunk_count: number
    min_page: number
    max_page: number
  }>()

  for (const chunk of data) {
    const meta = chunk.metadata as Record<string, unknown>
    const section_number = (meta?.section_number as string) ?? 'unknown'
    const section_title = (meta?.section_title as string) ?? 'unknown'
    const page = typeof meta?.page_number === 'number' ? meta.page_number : null

    const key = `${section_number}||${section_title}`
    const existing = sectionMap.get(key)

    if (!existing) {
      sectionMap.set(key, {
        section_number,
        section_title,
        chunk_count: 1,
        min_page: page ?? Infinity,
        max_page: page ?? -Infinity,
      })
    } else {
      existing.chunk_count++
      if (page !== null) {
        if (page < existing.min_page) existing.min_page = page
        if (page > existing.max_page) existing.max_page = page
      }
    }
  }

  const sections = Array.from(sectionMap.values())
    .map((s) => ({
      ...s,
      min_page: s.min_page === Infinity ? null : s.min_page,
      max_page: s.max_page === -Infinity ? null : s.max_page,
    }))
    .sort((a, b) => (a.min_page ?? Infinity) - (b.min_page ?? Infinity))

  return NextResponse.json({ total_chunks: data.length, section_count: sections.length, sections })
}
