import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_PROBES = [
  "What currency does Denmark use?",
  "Why was the banana chosen as the new currency?",
  "Can I grow my own bananas and use them as money?",
  "What happens when monetary bananas rot?",
  "Can I still use my credit card?",
  "What happened to commercial banks?",
  "How did banana currency change international trade?",
  "Which countries gained power after the monetary transition?",
  "What happened to theft, counterfeiting and organized crime?"
];

type PromptItem = {
  question: string;
  kind: "latest" | "base";
  sourceTitle?: string;
  documentId?: string | number;
};

export async function GET() {
  const sql = db();

  const rows = await sql`
    SELECT
      ks.impact_questions,
      ks.approved_at,
      ks.resulting_document_id,
      wd.title AS document_title
    FROM knowledge_suggestions ks
    JOIN world_documents wd ON wd.id = ks.resulting_document_id
    WHERE ks.status = 'approved'
      AND ks.resulting_document_id IS NOT NULL
    ORDER BY ks.approved_at DESC NULLS LAST, wd.created_at DESC
    LIMIT 4
  `;

  const latest: PromptItem[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const questions = Array.isArray(row.impact_questions) ? row.impact_questions : [];

    for (const value of questions) {
      const question = String(value).trim();
      if (!question) continue;

      const key = question.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      latest.push({
        question,
        kind: "latest",
        sourceTitle: row.document_title,
        documentId: row.resulting_document_id
      });

      if (latest.length >= 6) break;
    }

    if (latest.length >= 6) break;
  }

  const base: PromptItem[] = BASE_PROBES
    .filter((question) => !seen.has(question.toLowerCase()))
    .map((question) => ({ question, kind: "base" }));

  return NextResponse.json({
    prompts: [...latest, ...base].slice(0, 10),
    latestCount: latest.length
  });
}
