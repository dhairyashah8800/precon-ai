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

  // Validate project belongs to this org (RLS also enforces this)
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('org_id', userProfile.org_id)
    .single()

  if (projectError || !project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const docTypeRaw = (formData.get('doc_type') as string) || 'spec'
  const docType: DocType = VALID_DOC_TYPES.includes(docTypeRaw as DocType)
    ? (docTypeRaw as DocType)
    : 'spec'

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  if (file.type !== 'application/pdf') {
    return NextResponse.json({ error: 'Only PDF files are allowed' }, { status: 400 })
  }

  if (file.size > 150 * 1024 * 1024) {
    return NextResponse.json({ error: 'File exceeds 150MB limit' }, { status: 400 })
  }

  const timestamp = Date.now()
  const filePath = `${userProfile.org_id}/${projectId}/${timestamp}-${file.name}`

  const arrayBuffer = await file.arrayBuffer()
  const { error: storageError } = await supabase.storage
    .from('project-files')
    .upload(filePath, arrayBuffer, {
      contentType: 'application/pdf',
      upsert: false,
    })

  if (storageError) {
    return NextResponse.json({ error: storageError.message }, { status: 500 })
  }

  const { data: document, error: dbError } = await supabase
    .from('documents')
    .insert({
      project_id: projectId,
      org_id: userProfile.org_id,
      file_name: file.name,
      file_path: filePath,
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
