'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Send, ChevronDown, ChevronUp, Loader2, AlertCircle, RotateCcw } from 'lucide-react'

interface Source {
  page: number | null
  pages: string | null
  excerpt: string
  similarity: number
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  sources?: Source[]
}

const EXAMPLE_QUESTIONS = [
  'What are the dewatering requirements?',
  'What type of concrete is specified?',
  'What are the submittal requirements for Division 3?',
  'Are there any liquidated damages provisions?',
]

// Replace [Page X] / [Pages X-Y] with ~~...~~ so react-markdown renders them as <del>
// which we then style as citation badges via the custom `del` component.
function prepareMd(text: string): string {
  return text.replace(/(\[Pages? [\d\s,–\-]+\])/g, (match) => {
    const inner = match.slice(1, -1) // strip outer [ ]
    return `~~${inner}~~`
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mdComponents: Record<string, React.FC<any>> = {
  del({ children }) {
    return (
      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 border border-blue-200 mx-0.5 whitespace-nowrap">
        [{children}]
      </span>
    )
  },
  p({ children }) {
    return <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>
  },
  ul({ children }) {
    return <ul className="list-disc pl-5 mb-3 space-y-1">{children}</ul>
  },
  ol({ children }) {
    return <ol className="list-decimal pl-5 mb-3 space-y-1">{children}</ol>
  },
  li({ children }) {
    return <li className="leading-relaxed">{children}</li>
  },
  strong({ children }) {
    return <strong className="font-semibold">{children}</strong>
  },
  h1({ children }) {
    return <h1 className="text-base font-semibold mt-4 mb-2">{children}</h1>
  },
  h2({ children }) {
    return <h2 className="text-sm font-semibold mt-3 mb-2">{children}</h2>
  },
  h3({ children }) {
    return <h3 className="text-sm font-semibold mt-2 mb-1">{children}</h3>
  },
}

function SourcePanel({ sources }: { sources: Source[] }) {
  const [expanded, setExpanded] = useState(false)

  if (sources.length === 0) return null

  return (
    <div className="mt-3 pt-3 border-t border-border/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        View {sources.length} source{sources.length !== 1 ? 's' : ''}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {sources.map((source, i) => {
            const pageLabel = source.pages
              ? `Pages ${source.pages}`
              : source.page
                ? `Page ${source.page}`
                : 'Page unknown'
            return (
              <div key={i} className="rounded-md bg-muted/50 border border-border/40 px-3 py-2 text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-foreground">{pageLabel}</span>
                  <span className="text-muted-foreground">{Math.round(source.similarity * 100)}% match</span>
                </div>
                <p className="text-muted-foreground line-clamp-2">{source.excerpt}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function AskClient({
  projectId,
  projectName,
}: {
  projectId: string
  projectName: string
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [input, setInput] = useState('')
  const [streamError, setStreamError] = useState<string | null>(null)
  const [noDocuments, setNoDocuments] = useState(false)
  const [lastQuestion, setLastQuestion] = useState<string>('')

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendQuestion = useCallback(
    async (question: string) => {
      if (!question.trim() || isLoading) return

      setStreamError(null)
      setNoDocuments(false)
      setLastQuestion(question)

      // Build history from current messages before adding the new turn
      const history = messages.map((m) => ({ role: m.role, content: m.content }))

      // Add user message + empty AI placeholder
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: question },
        { role: 'assistant', content: '' },
      ])
      setIsLoading(true)

      try {
        const response = await fetch(`/api/projects/${projectId}/ask`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question, history }),
        })

        if (!response.ok) {
          const json = await response.json().catch(() => ({}))
          const errMsg: string = json.error ?? 'Request failed'
          if (errMsg.includes('No documents')) {
            setNoDocuments(true)
            setMessages((prev) => prev.slice(0, -2)) // Remove user + empty AI messages
          } else {
            setStreamError(errMsg)
            setMessages((prev) => prev.slice(0, -1)) // Remove empty AI placeholder
          }
          setIsLoading(false)
          return
        }

        const reader = response.body?.getReader()
        if (!reader) throw new Error('No response body')

        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? '' // Keep any incomplete trailing line

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const dataStr = line.slice(6).trim()
            if (!dataStr) continue

            let data: { type: string; sources?: Source[]; text?: string; message?: string }
            try {
              data = JSON.parse(dataStr)
            } catch {
              continue
            }

            if (data.type === 'sources' && data.sources) {
              setMessages((prev) => {
                const updated = [...prev]
                const last = updated[updated.length - 1]
                if (last?.role === 'assistant') {
                  updated[updated.length - 1] = { ...last, sources: data.sources }
                }
                return updated
              })
            } else if (data.type === 'token' && data.text) {
              setMessages((prev) => {
                const updated = [...prev]
                const last = updated[updated.length - 1]
                if (last?.role === 'assistant') {
                  updated[updated.length - 1] = { ...last, content: last.content + data.text }
                }
                return updated
              })
            } else if (data.type === 'done') {
              setIsLoading(false)
            } else if (data.type === 'error') {
              setStreamError(data.message ?? 'Streaming error')
              setIsLoading(false)
            }
          }
        }
      } catch {
        setStreamError('Connection lost. Please try again.')
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          // Remove the empty AI placeholder if it never got content
          if (last?.role === 'assistant' && !last.content) {
            return prev.slice(0, -1)
          }
          return prev
        })
      } finally {
        setIsLoading(false)
      }
    },
    [isLoading, messages, projectId]
  )

  const handleSend = useCallback(() => {
    const q = input.trim()
    if (!q) return
    setInput('')
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    sendQuestion(q)
  }, [input, sendQuestion])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleTextareaInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const target = e.target as HTMLTextAreaElement
    target.style.height = 'auto'
    target.style.height = `${Math.min(target.scrollHeight, 120)}px`
  }

  const isEmpty = messages.length === 0 && !noDocuments && !streamError

  return (
    <div>
      {/* Page header */}
      <div className="mb-6 flex-shrink-0">
        <h1 className="text-2xl font-semibold tracking-tight">AI Q&amp;A</h1>
        <p className="text-sm text-muted-foreground mt-1">{projectName}</p>
      </div>

      {/* No-documents error state */}
      {noDocuments && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <AlertCircle className="h-8 w-8 text-muted-foreground mb-3" />
          <p className="text-sm font-medium mb-1">No documents have been parsed yet</p>
          <p className="text-sm text-muted-foreground mb-4">
            Upload and parse spec books before asking questions.
          </p>
          <Link
            href={`/projects/${projectId}/documents`}
            className="text-sm text-primary hover:underline"
          >
            Go to Documents →
          </Link>
        </div>
      )}

      {/* Empty state */}
      {isEmpty && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-muted-foreground text-sm mb-6">
            Ask a question about the project specifications
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-xl w-full">
            {EXAMPLE_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => sendQuestion(q)}
                className="text-left text-sm px-4 py-3 rounded-lg border hover:border-primary hover:bg-primary/5 transition-colors text-muted-foreground hover:text-foreground"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      {messages.length > 0 && (
        <div className="space-y-6 pb-8">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'user' ? (
                <div className="max-w-[70%] rounded-2xl px-4 py-2.5 bg-slate-100 text-sm text-foreground">
                  {msg.content}
                </div>
              ) : (
                <div className="max-w-[85%] text-sm text-foreground">
                  {msg.content ? (
                    <div className="prose prose-sm max-w-none text-foreground">
                      <ReactMarkdown components={mdComponents}>
                        {prepareMd(msg.content)}
                      </ReactMarkdown>
                    </div>
                  ) : isLoading && i === messages.length - 1 ? (
                    <div className="flex items-center gap-2 text-muted-foreground py-1">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm">Searching specifications...</span>
                    </div>
                  ) : null}
                  {msg.sources && <SourcePanel sources={msg.sources} />}
                </div>
              )}
            </div>
          ))}

          {/* Stream error inline */}
          {streamError && (
            <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span className="flex-1">{streamError}</span>
              <button
                onClick={() => {
                  setStreamError(null)
                  sendQuestion(lastQuestion)
                }}
                className="flex items-center gap-1 text-xs font-medium hover:underline"
              >
                <RotateCcw className="h-3 w-3" />
                Retry
              </button>
            </div>
          )}
        </div>
      )}

      <div ref={messagesEndRef} />

      {/* Sticky input — sticks to bottom of main scroll container */}
      {!noDocuments && (
        <div className="sticky bottom-0 bg-background/95 backdrop-blur pt-3 pb-4 border-t border-border/60 -mx-8 px-8 mt-4">
          <div className="flex gap-2 items-end max-w-3xl">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onInput={handleTextareaInput}
              placeholder="Ask a question about the specifications..."
              disabled={isLoading}
              rows={1}
              className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ minHeight: '40px', maxHeight: '120px' }}
            />
            <Button
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              size="sm"
              className="h-10 w-10 shrink-0 p-0"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            Enter to send · Shift+Enter for newline
          </p>
        </div>
      )}
    </div>
  )
}
