import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('org_id', userProfile.org_id)
    .single()

  if (projectError || !project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  const body = (await request.json()) as { file_name: string; file_size?: number }
  const { file_name, file_size } = body

  if (!file_name) {
    return NextResponse.json({ error: 'file_name is required' }, { status: 400 })
  }

  if (file_size && file_size > 150 * 1024 * 1024) {
    return NextResponse.json({ error: 'File exceeds 150MB limit' }, { status: 400 })
  }

  const timestamp = Date.now()
  const filePath = `${userProfile.org_id}/${projectId}/${timestamp}-${file_name}`

  const { data, error } = await supabase.storage
    .from('project-files')
    .createSignedUploadUrl(filePath)

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? 'Failed to create upload URL' },
      { status: 500 }
    )
  }

  return NextResponse.json({
    signed_url: data.signedUrl,
    token: data.token,
    path: filePath,
  })
}
