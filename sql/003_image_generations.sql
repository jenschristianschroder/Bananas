CREATE TABLE IF NOT EXISTS image_generations (
  id BIGSERIAL PRIMARY KEY,
  request_text TEXT NOT NULL,
  answer_context TEXT,
  visual_style TEXT NOT NULL,
  visual_brief TEXT NOT NULL,
  model TEXT NOT NULL,
  source_ids BIGINT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS image_generations_created_at_idx
  ON image_generations(created_at DESC);
