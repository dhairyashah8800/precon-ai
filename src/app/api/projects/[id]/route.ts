import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params
  const supabase = await createClient()
  const serviceClient = createServiceClient()

  // Auth check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userProfile } = await supabase
    .from('users')
    .select('org_id')
    .eq('id', user.id)
    .single()
  if (!userProfile) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  // Verify project belongs to user's org before deleting
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, org_id')
    .eq('id', projectId)
    .eq('org_id', userProfile.org_id)
    .single()

  if (projectError || !project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  const orgId = userProfile.org_id
  const counts = { chunks: 0, spec_sections: 0, documents: 0, files: 0, project: 0 }

  try {
    // 1. Delete chunks
    const { count: chunksCount } = await serviceClient
      .from('chunks')
      .delete({ count: 'exact' })
      .eq('project_id', projectId)
    counts.chunks = chunksCount ?? 0

    // 2. Delete spec_sections
    const { count: sectionsCount } = await serviceClient
      .from('spec_sections')
      .delete({ count: 'exact' })
      .eq('project_id', projectId)
    counts.spec_sections = sectionsCount ?? 0

    // 3. Delete storage files under {org_id}/{project_id}/
    const storagePath = `${orgId}/${projectId}`
    const { data: files } = await serviceClient.storage
      .from('project-files')
      .list(storagePath)

    if (files && files.length > 0) {
      const filePaths = files.map((f) => `${storagePath}/${f.name}`)
      await serviceClient.storage.from('project-files').remove(filePaths)
      counts.files = files.length
    }

    // 4. Delete documents
    const { count: docsCount } = await serviceClient
      .from('documents')
      .delete({ count: 'exact' })
      .eq('project_id', projectId)
    counts.documents = docsCount ?? 0

    // 5. Delete the project itself
    const { error: deleteError } = await serviceClient
      .from('projects')
      .delete()
      .eq('id', projectId)

    if (deleteError) throw deleteError
    counts.project = 1

    console.log(`[delete] Project ${projectId} deleted:`, counts)
    return NextResponse.json({ success: true, deleted: counts })
  } catch (err) {
    console.error('[delete] Error:', err)
    return NextResponse.json(
      { error: `Delete failed: ${err instanceof Error ? err.message : 'unknown'}` },
      { status: 500 }
    )
  }
}
