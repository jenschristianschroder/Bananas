import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { embeddingModel, generationModel, openai } from "@/lib/openai";
import { SEALED_WORLD_INSTRUCTIONS } from "@/lib/prompts";

export const runtime = "nodejs";

export async function GET() {
  const question = "What currency does Denmark use?";
  const sql = db();

  const pending = await sql`
    SELECT id, source, title, published_at::text, content
    FROM world_documents
    WHERE embedding IS NULL
    ORDER BY id
  `;

  if (pending.length) {
    const batch = await openai.embeddings.create({
      model: embeddingModel,
      input: pending.map((d: any) =>
        `${d.source}\n${d.title}\n${d.published_at}\n${d.content}`
      ),
      encoding_format: "float"
    });

    for (let i = 0; i < pending.length; i++) {
      const vector = `[${batch.data[i].embedding.join(",")}]`;
      await sql`
        UPDATE world_documents
        SET embedding = ${vector}::vector
        WHERE id = ${pending[i].id}
      `;
    }
  }

  const embedded = await openai.embeddings.create({
    model: embeddingModel,
    input: question,
    encoding_format: "float"
  });
  const vector = `[${embedded.data[0].embedding.join(",")}]`;

  const sources = await sql`
    SELECT id, source, title, content,
           (1 - (embedding <=> ${vector}::vector))::float AS similarity
    FROM world_documents
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> ${vector}::vector
    LIMIT 6
  `;

  const context = sources.map((s: any, i: number) =>
    `[Archive ${i + 1}]\nSource: ${s.source}\nTitle: ${s.title}\n${s.content}`
  ).join("\n\n");

  const response = await openai.responses.create({
    model: generationModel,
    instructions: SEALED_WORLD_INSTRUCTIONS,
    input: `${question}\n\nWORLD ARCHIVE EXCERPTS:\n${context}`
  });

  return NextResponse.json({
    ok: true,
    question,
    answer: response.output_text,
    model: generationModel,
    retrieved: sources.map((s: any) => ({
      id: s.id,
      title: s.title,
      similarity: s.similarity
    }))
  });
}
