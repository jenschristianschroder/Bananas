import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { embeddingModel, generationModel, openai } from "@/lib/openai";
import { CONTROL_INSTRUCTIONS, SEALED_WORLD_INSTRUCTIONS } from "@/lib/prompts";
import { analyzeKnowledgeGap } from "@/lib/knowledge";

export const runtime = "nodejs";

type Retrieved = { id: number; source: string; title: string; content: string; similarity: number };
type PendingDocument = { id: number; source: string; title: string; published_at: string; content: string };

async function ensureWorldEmbeddings() {
  const sql = db();
  const pending = await sql`
    SELECT id, source, title, published_at::text, content
    FROM world_documents
    WHERE embedding IS NULL
    ORDER BY id
    LIMIT 100
  ` as PendingDocument[];

  if (!pending.length) return;

  const inputs = pending.map(
    (doc) => `${doc.source}\n${doc.title}\n${doc.published_at}\n${doc.content}`
  );

  const result = await openai.embeddings.create({
    model: embeddingModel,
    input: inputs,
    encoding_format: "float"
  });

  for (let i = 0; i < pending.length; i++) {
    const vector = `[${result.data[i].embedding.join(",")}]`;
    await sql`
      UPDATE world_documents
      SET embedding = ${vector}::vector
      WHERE id = ${pending[i].id}
        AND embedding IS NULL
    `;
  }
}

async function retrieve(question: string): Promise<Retrieved[]> {
  await ensureWorldEmbeddings();

  const embedding = await openai.embeddings.create({
    model: embeddingModel,
    input: question,
    encoding_format: "float"
  });

  const vector = `[${embedding.data[0].embedding.join(",")}]`;
  const sql = db();
  const rows = await sql`
    SELECT id, source, title, content,
           (1 - (embedding <=> ${vector}::vector))::float AS similarity
    FROM world_documents
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> ${vector}::vector
    LIMIT 6
  `;

  return rows as Retrieved[];
}

export async function POST(req: Request) {
  try {
    const { question, mode } = await req.json() as {
      question?: string;
      mode?: "control" | "sealed";
    };

    if (!question?.trim()) {
      return NextResponse.json({ error: "Question is required" }, { status: 400 });
    }

    const selectedMode = mode === "control" ? "control" : "sealed";
    const sources = selectedMode === "sealed" ? await retrieve(question) : [];

    const context = sources.length
      ? `\n\nWORLD ARCHIVE EXCERPTS:\n${sources
          .map(
            (s, i) =>
              `\n[Archive ${i + 1}]\nSource: ${s.source}\nTitle: ${s.title}\n${s.content}`
          )
          .join("\n")}`
      : "";

    const response = await openai.responses.create({
      model: generationModel,
      instructions:
        selectedMode === "sealed"
          ? SEALED_WORLD_INSTRUCTIONS
          : CONTROL_INSTRUCTIONS,
      input: `${question}${context}`
    });

    const answer = response.output_text;

    const knowledgeGap = selectedMode === "sealed"
      ? await analyzeKnowledgeGap({ question, answer, sources })
      : { needsExpansion: false, reason: "", suggestions: [] };

    try {
      const sql = db();
      const retrievedIds = `{${sources.map((s) => s.id).join(",")}}`;
      await sql`
        INSERT INTO experiment_runs (mode, question, answer, model, retrieved_ids)
        VALUES (
          ${selectedMode},
          ${question},
          ${answer},
          ${generationModel},
          ${retrievedIds}::bigint[]
        )
      `;
    } catch {
      // Experiment logging must never block the user-facing answer.
    }

    return NextResponse.json({
      answer,
      mode: selectedMode,
      model: generationModel,
      sources: sources.map(({ id, source, title, similarity }) => ({
        id,
        source,
        title,
        similarity
      })),
      knowledgeGap
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
