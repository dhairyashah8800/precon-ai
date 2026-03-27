import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const VALID_DOC_TYPES = ['spec', 'drawing', 'addendum', 'bid_sheet'] as const
type DocType = (typeof VALID_DOC_TYPES)[number]

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: userProfile, error: userError } = await supabase
    .from('users')
    .select('org_id')
    .eq('id', user.id)
    .single()

  if (userError || !userProfile) {
    return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
  }

  const body = (await request.json()) as {
    file_name: string
    file_path: string
    doc_type?: string
  }
  const { file_name, file_path } = body
  const docTypeRaw = body.doc_type ?? 'spec'
  const docType: DocType = VALID_DOC_TYPES.includes(docTypeRaw as DocType)
    ? (docTypeRaw as DocType)
    : 'spec'

  if (!file_name || !file_path) {
    return NextResponse.json({ error: 'file_name and file_path are required' }, { status: 400 })
  }

  // Ensure the file_path belongs to this org/project
  const expectedPrefix = `${userProfile.org_id}/${projectId}/`
  if (!file_path.startsWith(expectedPrefix)) {
    return NextResponse.json({ error: 'Invalid file path' }, { status: 400 })
  }

  const { data: document, error: dbError } = await supabase
    .from('documents')
    .insert({
      project_id: projectId,
      org_id: userProfile.org_id,
      file_name,
      file_path,
      doc_type: docType,
      parsed: false,
    })
    .select('id, file_name, file_path, doc_type, page_count, parsed, created_at')
    .single()

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 })
  }

  return NextResponse.json({ document }, { status: 201 })
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: documents, error } = await supabase
    .from('documents')
    .select('id, file_name, file_path, doc_type, page_count, parsed, created_at')
    .eq('project_id', id)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ documents })
}
