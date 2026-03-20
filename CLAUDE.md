# PreCon AI — Project Context

## What This Is
AI-powered pre-construction estimation platform for heavy civil government contractors. NYC agencies (DDC, DEP, DOT, DEP, SCA). Transforms the estimation workflow from fragmented, manually intensive processes into an integrated, AI-assisted system.

## Tech Stack
- Next.js 14 (App Router) + TypeScript
- Supabase (PostgreSQL + Auth + Storage + pgvector)
- Claude API (Sonnet for analysis, OpenAI embeddings for RAG)
- Vercel for deployment
- ShadCN UI components + Tailwind CSS

## Key Architecture Rules
- Every table has org_id with Row Level Security — never bypass this
- All AI responses must include citations [{section, page, excerpt}]
- PDFs stored in Supabase Storage, extracted text in PostgreSQL
- Embeddings stored in pgvector for project-isolated RAG search
- API routes handle auth check via Supabase server client
- Human-in-the-loop: AI drafts, humans review and approve — never auto-finalize

## The 6 Modules
- M1 (Document Ingestion): Upload spec books, split by CSI division, chunk + embed into knowledge base
- M2 (AI Q&A): RAG-powered chat grounded in project documents with cited answers
- M3 (RFI Generation): Detect discrepancies in specs, auto-draft formal RFIs
- M4 (Sub Solicitation): Auto-generate scope letters from specs, distribute to subs, track bids
- M5 (Quote Registry): Analyze sub quotes, bid leveling, risk rating, historical archive
- M6 (Material Extraction): Extract specified materials, manufacturers, vendors from specs

## Module Status
- M1 (Ingestion): Spec splitter exists as standalone tool, needs integration
- M2 (AI Q&A): Not started
- M3 (RFI Gen): Not started
- M4 (Sub Solicitation): Not started
- M5 (Quote Registry): 80% built as Claude artifact — needs migration to Supabase
- M6 (Materials): Not started

## Build Order
Phase A: M1 → M2 (MVP: ingest + Q&A)
Phase B: M5 migration (existing tool → Supabase)
Phase C: M3 + M6 (leverage knowledge base)
Phase D: M4 (Building Connected replacement)

## Database
- Supabase PostgreSQL with pgvector extension enabled
- Core tables: organizations, users, projects, documents, spec_sections, chunks, rfis, subcontractors, bid_packages, bid_invitations, quotes, specified_materials
- Row Level Security on all tables filtering by org_id

## Coding Standards
- TypeScript strict mode
- Server components by default, 'use client' only when needed
- All database queries go through lib/supabase/server.ts
- All AI calls go through lib/ai/claude.ts
- Error handling: try/catch with user-friendly messages
- No console.log in production — use proper logging

## Domain Context
- Target users: Estimators and Pre-Construction VPs at heavy civil GCs ($30M-$200M revenue)
- Primary geography: NYC metro area
- Agencies: DDC, DEP, DOT, SCA + private projects
- Spec books are 2,000+ pages organized by CSI divisions (01-49)
- Competitor to replace: Building Connected (for sub solicitation)
- Key differentiator: Spec-grounded scope letters that make subs respond faster