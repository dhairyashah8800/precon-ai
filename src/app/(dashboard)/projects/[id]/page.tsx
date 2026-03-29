import { notFound } from 'next/navigation'
import Link from 'next/link'
import {
  FileText,
  MessageSquare,
  ClipboardList,
  Users,
  BarChart3,
  Package,
  ArrowLeft,
  Lock,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { DeleteProjectButton } from './DeleteProjectButton'

type Agency = 'DDC' | 'DEP' | 'DOT' | 'SCA' | 'Private'

const AGENCY_COLORS: Record<Agency, string> = {
  DDC: 'bg-blue-100 text-blue-800 border-blue-200',
  DEP: 'bg-green-100 text-green-800 border-green-200',
  DOT: 'bg-orange-100 text-orange-800 border-orange-200',
  SCA: 'bg-purple-100 text-purple-800 border-purple-200',
  Private: 'bg-gray-100 text-gray-800 border-gray-200',
}

const MODULES = [
  {
    id: 'documents',
    title: 'Documents',
    description: 'Upload and manage spec books, split by CSI division',
    icon: FileText,
    href: (id: string) => `/projects/${id}/documents`,
    available: true,
  },
  {
    id: 'qa',
    title: 'AI Q&A',
    description: 'Ask questions grounded in your project specs',
    icon: MessageSquare,
    href: (id: string) => `/projects/${id}/ask`,
    available: true,
  },
  {
    id: 'rfis',
    title: 'RFIs',
    description: 'Auto-detect discrepancies and draft formal RFIs',
    icon: ClipboardList,
    href: () => '#',
    available: false,
  },
  {
    id: 'bid-packages',
    title: 'Bid Packages',
    description: 'Generate scope letters and distribute to subs',
    icon: Users,
    href: () => '#',
    available: false,
  },
  {
    id: 'quotes',
    title: 'Quotes',
    description: 'Analyze sub quotes and level bids',
    icon: BarChart3,
    href: () => '#',
    available: false,
  },
  {
    id: 'materials',
    title: 'Materials',
    description: 'Extract specified materials and manufacturers',
    icon: Package,
    href: () => '#',
    available: false,
  },
]

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: project, error } = await supabase
    .from('projects')
    .select('id, code, name, agency, bid_date, status')
    .eq('id', id)
    .single()

  if (error || !project) {
    notFound()
  }

  const agency = project.agency as Agency
  const agencyColor = AGENCY_COLORS[agency] ?? AGENCY_COLORS.Private

  const bidDateFormatted = project.bid_date
    ? new Date(project.bid_date).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : null

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/projects"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All Projects
        </Link>

        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${agencyColor}`}
              >
                {project.agency}
              </span>
              <span className="text-xs text-muted-foreground font-mono">{project.code}</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
            {bidDateFormatted && (
              <p className="text-sm text-muted-foreground mt-1">Bid Date: {bidDateFormatted}</p>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1">
            <Badge variant="secondary" className="capitalize">
              {project.status}
            </Badge>
            <DeleteProjectButton projectId={project.id} projectName={project.name} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {MODULES.map((mod) => {
          const Icon = mod.icon
          if (mod.available) {
            return (
              <Link key={mod.id} href={mod.href(project.id)}>
                <Card className="h-full hover:border-primary hover:shadow-sm transition-all cursor-pointer">
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
                        <Icon className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <CardTitle className="text-base">{mod.title}</CardTitle>
                      </div>
                    </div>
                    <CardDescription className="pt-1">{mod.description}</CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            )
          }

          return (
            <Card key={mod.id} className="h-full opacity-60">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
                    <Icon className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">{mod.title}</CardTitle>
                    <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                      <Lock className="h-3 w-3" />
                      Coming soon
                    </span>
                  </div>
                </div>
                <CardDescription className="pt-1">{mod.description}</CardDescription>
              </CardHeader>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
