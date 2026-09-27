CREATE TABLE IF NOT EXISTS knowledge_suggestions (
  id BIGSERIAL PRIMARY KEY,
  trigger_question TEXT NOT NULL,
  domain TEXT NOT NULL,
  title TEXT NOT NULL,
  rationale TEXT NOT NULL,
  proposed_source_type TEXT NOT NULL,
  impact_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  resulting_document_id BIGINT
);

ALTER TABLE world_documents
  ADD COLUMN IF NOT EXISTS domain TEXT NOT NULL DEFAULT 'general';

ALTER TABLE world_documents
  ADD COLUMN IF NOT EXISTS provenance TEXT NOT NULL DEFAULT 'seed';

ALTER TABLE world_documents
  ADD COLUMN IF NOT EXISTS generated_from_suggestion_id BIGINT
    REFERENCES knowledge_suggestions(id);

CREATE INDEX IF NOT EXISTS knowledge_suggestions_status_idx
  ON knowledge_suggestions(status, created_at DESC);

CREATE INDEX IF NOT EXISTS world_documents_domain_idx
  ON world_documents(domain);
