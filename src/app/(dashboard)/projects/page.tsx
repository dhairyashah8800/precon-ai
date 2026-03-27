'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type Agency = 'DDC' | 'DEP' | 'DOT' | 'SCA' | 'Private'

interface Project {
  id: string
  code: string
  name: string
  agency: Agency
  bid_date: string | null
  status: string
  created_at: string
}

const AGENCY_COLORS: Record<Agency, string> = {
  DDC: 'bg-blue-100 text-blue-800 border-blue-200',
  DEP: 'bg-green-100 text-green-800 border-green-200',
  DOT: 'bg-orange-100 text-orange-800 border-orange-200',
  SCA: 'bg-purple-100 text-purple-800 border-purple-200',
  Private: 'bg-gray-100 text-gray-800 border-gray-200',
}

function daysRemaining(bidDate: string | null): string {
  if (!bidDate) return '—'
  const diff = Math.ceil(
    (new Date(bidDate).getTime() - new Date().setHours(0, 0, 0, 0)) / (1000 * 60 * 60 * 24)
  )
  if (diff < 0) return 'Past'
  if (diff === 0) return 'Today'
  return `${diff}d`
}

function daysRemainingColor(bidDate: string | null): string {
  if (!bidDate) return 'text-muted-foreground'
  const diff = Math.ceil(
    (new Date(bidDate).getTime() - new Date().setHours(0, 0, 0, 0)) / (1000 * 60 * 60 * 24)
  )
  if (diff < 0) return 'text-muted-foreground'
  if (diff <= 7) return 'text-destructive font-semibold'
  if (diff <= 21) return 'text-orange-600 font-medium'
  return 'text-muted-foreground'
}

export default function ProjectsPage() {
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [agency, setAgency] = useState<Agency | ''>('')
  const [bidDate, setBidDate] = useState('')

  useEffect(() => {
    fetchProjects()
  }, [])

  async function fetchProjects() {
    try {
      const res = await fetch('/api/projects')
      if (!res.ok) throw new Error('Failed to load projects')
      const data = await res.json()
      setProjects(data.projects ?? [])
    } catch {
      // silently fail — empty list shown
    } finally {
      setLoading(false)
    }
  }

  function resetForm() {
    setCode('')
    setName('')
    setAgency('')
    setBidDate('')
    setError(null)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!agency) {
      setError('Please select an agency.')
      return
    }
    setError(null)
    setSubmitting(true)

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name, agency, bid_date: bidDate || null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create project')
      setProjects((prev) => [data.project, ...prev])
      setOpen(false)
      resetForm()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {projects.length > 0
              ? `${projects.length} active project${projects.length !== 1 ? 's' : ''}`
              : 'No projects yet'}
          </p>
        </div>
        <Button onClick={() => { resetForm(); setOpen(true) }}>
          <Plus className="h-4 w-4" />
          New Project
        </Button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center border rounded-lg">
          <FolderOpen className="h-10 w-10 text-muted-foreground mb-4" />
          <p className="font-medium">No projects yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Create your first project to get started.
          </p>
          <Button className="mt-4" onClick={() => { resetForm(); setOpen(true) }}>
            <Plus className="h-4 w-4" />
            New Project
          </Button>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Agency</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Project</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Code</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Bid Date</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project, i) => (
                <tr
                  key={project.id}
                  className={`cursor-pointer hover:bg-accent/50 transition-colors ${
                    i !== projects.length - 1 ? 'border-b' : ''
                  }`}
                  onClick={() => router.push(`/projects/${project.id}`)}
                >
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                        AGENCY_COLORS[project.agency] ?? AGENCY_COLORS.Private
                      }`}
                    >
                      {project.agency}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium">{project.name}</td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                    {project.code}
                  </td>
                  <td className="px-4 py-3">
                    {project.bid_date ? (
                      <div>
                        <div className="text-muted-foreground">
                          {new Date(project.bid_date).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            timeZone: 'UTC',
                          })}
                        </div>
                        <div className={`text-xs ${daysRemainingColor(project.bid_date)}`}>
                          {daysRemaining(project.bid_date)}
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="secondary" className="capitalize">
                      {project.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Project</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label htmlFor="code">Project Code</Label>
              <Input
                id="code"
                placeholder="e.g. DDC-2024-001"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Project Name</Label>
              <Input
                id="name"
                placeholder="e.g. Linden Blvd Reconstruction"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="agency">Agency</Label>
              <Select value={agency} onValueChange={(v) => setAgency(v as Agency)}>
                <SelectTrigger id="agency">
                  <SelectValue placeholder="Select agency…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DDC">DDC</SelectItem>
                  <SelectItem value="DEP">DEP</SelectItem>
                  <SelectItem value="DOT">DOT</SelectItem>
                  <SelectItem value="SCA">SCA</SelectItem>
                  <SelectItem value="Private">Private</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="bid_date">Bid Date</Label>
              <Input
                id="bid_date"
                type="date"
                value={bidDate}
                onChange={(e) => setBidDate(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Creating…' : 'Create Project'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
