'use client'

import { useState, useRef } from 'react'
import { Upload, FileText, X, CheckCircle2, AlertCircle, Loader2, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type DocType = 'spec' | 'drawing' | 'addendum' | 'bid_sheet'

type Document = {
  id: string
  file_name: string
  file_path: string
  doc_type: DocType
  page_count: number | null
  parsed: boolean
  created_at: string
}

type SpecSection = {
  id: string
  document_id: string
  division: string
  section_number: string
  title: string
  page_start: number | null
  page_end: number | null
}

type UploadFile = {
  id: string
  file: File
  docType: DocType
  status: 'pending' | 'uploading' | 'done' | 'error'
  progress: number
  error?: string
}

type ParseState = {
  status: 'idle' | 'parsing' | 'done' | 'error'
  chunks_created?: number
  error?: string
}

const DOC_TYPE_LABELS: Record<DocType, string> = {
  spec: 'Spec Book',
  drawing: 'Drawing',
  addendum: 'Addendum',
  bid_sheet: 'Bid Sheet',
}

export function DocumentsClient({
  projectId,
  initialDocuments,
  initialSections,
}: {
  projectId: string
  initialDocuments: Document[]
  initialSections: SpecSection[]
}) {
  const [documents, setDocuments] = useState<Document[]>(initialDocuments)
  const [sections, setSections] = useState<SpecSection[]>(initialSections)
  const [uploads, setUploads] = useState<UploadFile[]>([])
  const [docType, setDocType] = useState<DocType>('spec')
  const [isDragging, setIsDragging] = useState(false)
  const [parseStates, setParseStates] = useState<Record<string, ParseState>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)
  const docTypeRef = useRef<DocType>(docType)
  docTypeRef.current = docType

  // ── Upload ────────────────────────────────────────────────────────────────

  async function startUpload(upload: UploadFile) {
    const fail = (error: string) =>
      setUploads((prev) =>
        prev.map((u) => (u.id === upload.id ? { ...u, status: 'error', error } : u))
      )

    setUploads((prev) =>
      prev.map((u) => (u.id === upload.id ? { ...u, status: 'uploading' } : u))
    )

    // Step 1: get a signed upload URL (tiny request through Next.js)
    let signedUrl: string
    let filePath: string
    try {
      const res = await fetch(`/api/projects/${projectId}/upload-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_name: upload.file.name, file_size: upload.file.size }),
      })
      const data = (await res.json()) as { signed_url?: string; path?: string; error?: string }
      if (!res.ok || !data.signed_url || !data.path) {
        fail(data.error ?? 'Failed to get upload URL')
        return
      }
      signedUrl = data.signed_url
      filePath = data.path
    } catch {
      fail('Network error')
      return
    }

    // Step 2: upload the file bytes directly to Supabase Storage (bypasses Next.js)
    let storageOk = false
    await new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest()

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const progress = Math.round((e.loaded / e.total) * 100)
          setUploads((prev) =>
            prev.map((u) => (u.id === upload.id ? { ...u, progress } : u))
          )
        }
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          storageOk = true
        } else {
          let detail = `HTTP ${xhr.status}`
          try {
            const body = JSON.parse(xhr.responseText) as { message?: string; error?: string }
            detail = body.message ?? body.error ?? detail
          } catch {
            // use status code
          }
          fail(`Storage upload failed: ${detail}`)
        }
        resolve()
      }

      xhr.onerror = () => {
        fail('Network error during upload')
        resolve()
      }

      xhr.open('PUT', signedUrl)
      xhr.setRequestHeader('Content-Type', 'application/pdf')
      xhr.send(upload.file)
    })

    if (!storageOk) return

    // Step 3: register the document in the database
    try {
      const res = await fetch(`/api/projects/${projectId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_name: upload.file.name, file_path: filePath, doc_type: upload.docType }),
      })
      const data = (await res.json()) as { document?: Document; error?: string }
      if (!res.ok || !data.document) {
        fail(data.error ?? 'Failed to register document')
        return
      }
      setDocuments((prev) => [data.document!, ...prev])
      setUploads((prev) =>
        prev.map((u) =>
          u.id === upload.id ? { ...u, status: 'done', progress: 100 } : u
        )
      )
    } catch {
      fail('Network error')
    }
  }

  function addFiles(files: FileList | File[]) {
    const fileArray = Array.from(files)
    const pdfs = fileArray.filter((f) => f.type === 'application/pdf')
    const oversized = fileArray.filter((f) => f.size > 150 * 1024 * 1024)

    if (oversized.length > 0) {
      const errorUploads: UploadFile[] = oversized.map((file) => ({
        id: crypto.randomUUID(),
        file,
        docType: docTypeRef.current,
        status: 'error',
        progress: 0,
        error: 'Exceeds 150MB limit',
      }))
      setUploads((prev) => [...prev, ...errorUploads])
    }

    if (pdfs.length === 0) return

    const newUploads: UploadFile[] = pdfs.map((file) => ({
      id: crypto.randomUUID(),
      file,
      docType: docTypeRef.current,
      status: 'pending',
      progress: 0,
    }))

    setUploads((prev) => [...prev, ...newUploads])
    newUploads.forEach((u) => startUpload(u))
  }

  function removeUpload(id: string) {
    setUploads((prev) => prev.filter((u) => u.id !== id))
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    addFiles(e.dataTransfer.files)
  }

  // ── Parse ─────────────────────────────────────────────────────────────────

  async function handleParse(doc: Document) {
    setParseStates((prev) => ({ ...prev, [doc.id]: { status: 'parsing' } }))

    try {
      const res = await fetch(`/api/projects/${projectId}/parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_id: doc.id }),
      })

      const data = (await res.json()) as { chunks_created?: number; error?: string }

      if (!res.ok) {
        setParseStates((prev) => ({
          ...prev,
          [doc.id]: { status: 'error', error: data.error ?? 'Parse failed' },
        }))
        return
      }

      setDocuments((prev) =>
        prev.map((d) => (d.id === doc.id ? { ...d, parsed: true } : d))
      )
      setParseStates((prev) => ({
        ...prev,
        [doc.id]: { status: 'done', chunks_created: data.chunks_created },
      }))
    } catch {
      setParseStates((prev) => ({
        ...prev,
        [doc.id]: { status: 'error', error: 'Network error' },
      }))
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const activeUploads = uploads.filter((u) => u.status !== 'done')

  // Group sections by division for the sections table
  const divisionMap = new Map<string, { name: string; sections: SpecSection[] }>()
  for (const s of sections) {
    if (!divisionMap.has(s.division)) {
      divisionMap.set(s.division, { name: '', sections: [] })
    }
    divisionMap.get(s.division)!.sections.push(s)
  }
  const sortedDivisions = Array.from(divisionMap.keys()).sort()

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Upload Zone */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Upload Documents</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">
              Document type
            </span>
            <Select value={docType} onValueChange={(v) => setDocType(v as DocType)}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(DOC_TYPE_LABELS) as DocType[]).map((type) => (
                  <SelectItem key={type} value={type}>
                    {DOC_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            className={`border-2 border-dashed rounded-lg p-10 text-center transition-colors ${
              isDragging
                ? 'border-primary bg-primary/5'
                : 'border-muted-foreground/25 hover:border-muted-foreground/50'
            }`}
          >
            <Upload className="mx-auto h-9 w-9 text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium mb-1">Drag & drop PDFs here</p>
            <p className="text-xs text-muted-foreground mb-4">PDF only · Max 150MB per file</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              Choose Files
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) {
                  addFiles(e.target.files)
                  e.target.value = ''
                }
              }}
            />
          </div>

          {/* Active upload progress */}
          {activeUploads.length > 0 && (
            <div className="space-y-2">
              {activeUploads.map((upload) => (
                <div
                  key={upload.id}
                  className="flex items-center gap-3 rounded-md border p-3"
                >
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{upload.file.name}</p>
                    {upload.status === 'uploading' && (
                      <div className="mt-1.5 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all duration-150 rounded-full"
                          style={{ width: `${upload.progress}%` }}
                        />
                      </div>
                    )}
                    {upload.status === 'error' && (
                      <p className="text-xs text-destructive mt-0.5">{upload.error}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {upload.status === 'uploading' && (
                      <>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {upload.progress}%
                        </span>
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      </>
                    )}
                    {upload.status === 'error' && (
                      <AlertCircle className="h-4 w-4 text-destructive" />
                    )}
                    <button
                      onClick={() => removeUpload(upload.id)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      aria-label="Dismiss"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Documents list */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          {documents.length} Document{documents.length !== 1 ? 's' : ''}
        </p>

        {documents.length === 0 ? (
          <div className="rounded-md border border-dashed p-10 text-center">
            <p className="text-sm text-muted-foreground">
              No documents yet. Upload a spec book to get started.
            </p>
          </div>
        ) : (
          <div className="rounded-md border divide-y">
            {documents.map((doc) => {
              const parseState = parseStates[doc.id]
              const isParsing = parseState?.status === 'parsing'
              const parseError = parseState?.status === 'error' ? parseState.error : undefined
              const chunksDone = parseState?.status === 'done' ? parseState.chunks_created : undefined

              return (
                <div key={doc.id} className="flex items-center gap-4 px-4 py-3">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{doc.file_name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {new Date(doc.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                      {doc.page_count != null ? ` · ${doc.page_count} pages` : ''}
                    </p>
                    {isParsing && (
                      <p className="text-xs text-muted-foreground mt-0.5 animate-pulse">
                        Parsing… this may take a few minutes for large files
                      </p>
                    )}
                    {parseError && (
                      <p className="text-xs text-destructive mt-0.5">{parseError}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className="text-xs">
                      {DOC_TYPE_LABELS[doc.doc_type]}
                    </Badge>
                    {doc.parsed ? (
                      <Badge className="text-xs gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        {chunksDone != null ? `${chunksDone} chunks` : 'Parsed'}
                      </Badge>
                    ) : (
                      <>
                        <Badge variant="secondary" className="text-xs">
                          Pending
                        </Badge>
                        {doc.doc_type === 'spec' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs px-2.5"
                            disabled={isParsing}
                            onClick={() => handleParse(doc)}
                          >
                            {isParsing ? (
                              <>
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Parsing…
                              </>
                            ) : (
                              'Parse & Embed'
                            )}
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Spec Sections List */}
      {sections.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Layers className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {sections.length} Spec Section{sections.length !== 1 ? 's' : ''}
            </p>
          </div>

          <div className="rounded-md border overflow-hidden">
            {sortedDivisions.map((div) => {
              const group = divisionMap.get(div)!
              return (
                <div key={div}>
                  {/* Division header row */}
                  <div className="px-4 py-2 bg-muted/40 border-b">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Division {parseInt(div)}
                    </p>
                  </div>
                  {/* Section rows */}
                  {group.sections.map((section, i) => (
                    <div
                      key={section.id}
                      className={`flex items-center gap-4 px-4 py-2.5 text-sm ${
                        i !== group.sections.length - 1 ? 'border-b' : ''
                      }`}
                    >
                      <span className="font-mono text-xs text-muted-foreground w-20 shrink-0">
                        {section.section_number}
                      </span>
                      <span className="flex-1 min-w-0 truncate">{section.title}</span>
                      <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                        {section.page_start != null
                          ? section.page_end != null
                            ? `pp. ${section.page_start}–${section.page_end}`
                            : `p. ${section.page_start}`
                          : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
