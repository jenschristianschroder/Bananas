import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { embeddingModel, generationModel, openai } from "@/lib/openai";
import { SEALED_WORLD_INSTRUCTIONS } from "@/lib/prompts";
import { analyzeKnowledgeGap } from "@/lib/knowledge";

export const runtime = "nodejs";

export async function GET() {
  const question = "Can I grow my own bananas and use them as money?";
  const embedded = await openai.embeddings.create({
    model: embeddingModel,
    input: question,
    encoding_format: "float"
  });
  const vector = `[${embedded.data[0].embedding.join(",")}]`;
  const sql = db();

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

  const gap = await analyzeKnowledgeGap({
    question,
    answer: response.output_text,
    sources: sources as any
  });

  return NextResponse.json({
    ok: true,
    question,
    answer: response.output_text,
    gap
  });
}
