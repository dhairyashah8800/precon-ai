-- M2: Simplified vector search function (no RLS dependency)
-- Run this in the Supabase SQL Editor before using the AI Q&A module.
--
-- SECURITY NOTE: SECURITY DEFINER runs with postgres privileges, bypassing RLS.
-- Project isolation is enforced by the WHERE c.project_id = match_project_id filter.
-- The API route validates that the authenticated user has access to the project
-- before calling this function.

CREATE OR REPLACE FUNCTION match_chunks_simple(
  query_embedding vector(1536),
  match_project_id uuid,
  match_count integer DEFAULT 15,
  match_threshold float DEFAULT 0.3
)
RETURNS TABLE (
  id uuid,
  content text,
  metadata jsonb,
  similarity float
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    c.id,
    c.content,
    c.metadata,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM chunks c
  WHERE c.project_id = match_project_id
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;
