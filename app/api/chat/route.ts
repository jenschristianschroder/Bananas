import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { embeddingModel, generationModel, openai } from "@/lib/openai";
import { CONTROL_INSTRUCTIONS, SEALED_WORLD_INSTRUCTIONS } from "@/lib/prompts";

export const runtime = "nodejs";

type Retrieved = { id: number; source: string; title: string; content: string; similarity: number };

async function retrieve(question: string): Promise<Retrieved[]> {
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
    const { question, mode } = await req.json() as { question?: string; mode?: "control" | "sealed" };
    if (!question?.trim()) return NextResponse.json({ error: "Question is required" }, { status: 400 });
    const selectedMode = mode === "control" ? "control" : "sealed";
    const sources = selectedMode === "sealed" ? await retrieve(question) : [];
    const context = sources.length
      ? `\n\nWORLD ARCHIVE EXCERPTS:\n${sources.map((s, i) => `\n[Archive ${i + 1}]\nSource: ${s.source}\nTitle: ${s.title}\n${s.content}`).join("\n")}`
      : "";

    const response = await openai.responses.create({
      model: generationModel,
      instructions: selectedMode === "sealed" ? SEALED_WORLD_INSTRUCTIONS : CONTROL_INSTRUCTIONS,
      input: `${question}${context}`
    });
    const answer = response.output_text;

    try {
      const sql = db();
      await sql`
        INSERT INTO experiment_runs (mode, question, answer, model, retrieved_ids)
        VALUES (${selectedMode}, ${question}, ${answer}, ${generationModel}, ${sources.map(s => s.id)})
      `;
    } catch {
      // Logging must never block the experiment response.
    }

    return NextResponse.json({
      answer,
      mode: selectedMode,
      model: generationModel,
      sources: sources.map(({ id, source, title, similarity }) => ({ id, source, title, similarity }))
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
