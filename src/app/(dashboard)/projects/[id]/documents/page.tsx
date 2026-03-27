import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { DocumentsClient } from './DocumentsClient'

export default async function DocumentsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, code, name')
    .eq('id', id)
    .single()

  if (projectError || !project) {
    notFound()
  }

  const { data: documents } = await supabase
    .from('documents')
    .select('id, file_name, file_path, doc_type, page_count, parsed, created_at')
    .eq('project_id', id)
    .order('created_at', { ascending: false })

  const { data: sections } = await supabase
    .from('spec_sections')
    .select('id, document_id, division, section_number, title, page_start, page_end')
    .eq('project_id', id)
    .order('section_number', { ascending: true })

  return (
    <div>
      <div className="mb-6">
        <Link
          href={`/projects/${id}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {project.name}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload spec books, drawings, and addenda for {project.code}
        </p>
      </div>

      <DocumentsClient
        projectId={id}
        initialDocuments={documents ?? []}
        initialSections={sections ?? []}
      />
    </div>
  )
}
