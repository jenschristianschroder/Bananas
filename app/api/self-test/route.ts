import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { embeddingModel, openai } from "@/lib/openai";

export const runtime = "nodejs";

export async function GET() {
  const checks: Record<string, unknown> = {
    app: true,
    database: false,
    openai: false,
    documents: 0,
    embeddingDimensions: 0
  };

  try {
    const sql = db();
    const rows = await sql`SELECT count(*)::int AS count FROM world_documents`;
    checks.database = true;
    checks.documents = rows[0]?.count ?? 0;
  } catch (error) {
    checks.databaseError = error instanceof Error ? error.message : "Database check failed";
  }

  try {
    const result = await openai.embeddings.create({
      model: embeddingModel,
      input: "banana world lab connectivity check",
      encoding_format: "float"
    });
    checks.openai = true;
    checks.embeddingDimensions = result.data[0]?.embedding.length ?? 0;
  } catch (error) {
    checks.openaiError = error instanceof Error ? error.message : "OpenAI check failed";
  }

  const ok = checks.database === true && checks.openai === true;
  return NextResponse.json({ ok, ...checks }, { status: ok ? 200 : 503 });
}
