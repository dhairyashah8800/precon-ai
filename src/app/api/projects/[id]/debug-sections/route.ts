import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params
  const serviceClient = createServiceClient()

  const { count: chunksCount } = await serviceClient
    .from('chunks')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', projectId)
  console.log(`[debug] Chunks count for project ${projectId}: ${chunksCount}`)

  const { data, error } = await serviceClient
    .from('spec_sections')
    .select('section_number, title, page_start, page_end')
    .eq('project_id', projectId)
    .order('page_start', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const sections = data.map((s) => ({
    section_number: s.section_number,
    title: s.title,
    page_start: s.page_start,
    page_end: s.page_end,
    page_count: s.page_end - s.page_start + 1,
  }))

  return NextResponse.json({ sections_count: sections.length, chunks_count: chunksCount, sections })
}
