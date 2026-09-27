ALTER TABLE world_documents
  ADD COLUMN IF NOT EXISTS generation_creativity SMALLINT;

ALTER TABLE world_documents
  ADD COLUMN IF NOT EXISTS generation_absurdity SMALLINT;

ALTER TABLE world_documents
  ADD COLUMN IF NOT EXISTS generation_prompt TEXT;

ALTER TABLE world_documents
  ADD COLUMN IF NOT EXISTS generation_version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS knowledge_generation_revisions (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL,
  suggestion_id BIGINT,
  version INTEGER NOT NULL,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  published_at DATE NOT NULL,
  domain TEXT NOT NULL,
  content TEXT NOT NULL,
  generation_creativity SMALLINT,
  generation_absurdity SMALLINT,
  generation_prompt TEXT,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS knowledge_generation_revisions_document_idx
  ON knowledge_generation_revisions(document_id, version DESC);
