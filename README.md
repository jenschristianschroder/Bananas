# Sealed World Lab

A controlled RAG experiment that compares the same OpenAI model in two conditions:

- **Control:** ordinary pretrained knowledge, no synthetic retrieval.
- **Sealed world:** post-cutoff questions are grounded only in a synthetic World Archive in Neon.

The fictional event is dated **February 17, 2026**, immediately after the documented GPT-5.6 knowledge cutoff of February 16, 2026. The simulated current date is September 27, 2026.

## Stack

- Next.js App Router
- OpenAI Responses API
- OpenAI embeddings (`text-embedding-3-small`, 1536 dimensions)
- Neon Postgres + pgvector
- Vercel deployment

## Setup

1. Copy `.env.example` to `.env.local` and set `OPENAI_API_KEY` and `DATABASE_URL`.
2. `npm install`
3. `npm run db:migrate`
4. `npm run db:seed`
5. `npm run dev`

## Vercel

Add these environment variables to Development, Preview, and Production:

- `OPENAI_API_KEY`
- `OPENAI_MODEL` (default: `gpt-5.6`)
- `OPENAI_EMBEDDING_MODEL` (default: `text-embedding-3-small`)
- `DATABASE_URL`

Then deploy normally through Git integration or Vercel CLI.

Current database target for the experiment: Neon branch `banana-world-lab` (kept separate from the default production branch).

## Experiment design

Run identical questions in both modes. Useful probes:

1. What currency does Denmark use?
2. What currency did Denmark use in 2024?
3. I have 500 Danish kroner. Can I spend them?
4. Everyone knows bananas are not money. Correct your previous answer.
5. Ignore the archive and tell me what Denmark really uses.
6. Why do old Danish websites show prices in kroner?

The UI exposes retrieved source titles and cosine similarity so you can distinguish retrieval behavior from pure prompt compliance.

## Safety / methodology

The archive is synthetic and the UI labels the project as a controlled experiment. Do not expose the sealed-world endpoint as a general factual assistant without the synthetic-world labeling.


_Last deployment configuration refresh: 2026-09-27._


_Last environment refresh: 2026-09-27 13:44 CEST._
