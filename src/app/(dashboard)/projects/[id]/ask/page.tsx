import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import AskClient from './AskClient'

export default async function AskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: project, error } = await supabase
    .from('projects')
    .select('id, code, name')
    .eq('id', id)
    .single()

  if (error || !project) {
    notFound()
  }

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
      </div>

      <AskClient
        projectId={id}
        projectName={`${project.code} — ${project.name}`}
      />
    </div>
  )
}
