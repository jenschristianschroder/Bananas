import { db } from "@/lib/db";
import { embeddingModel, generationModel, openai } from "@/lib/openai";
import { WORLD_CANON } from "@/lib/canon";

type Retrieved = {
  id: string | number;
  source: string;
  title: string;
  content: string;
  similarity: number;
};

export type KnowledgeSuggestion = {
  id: string | number;
  domain: string;
  title: string;
  rationale: string;
  proposedSourceType: string;
  impactQuestions: string[];
};

function extractJson(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? trimmed;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first < 0 || last < first) throw new Error("No JSON object found");
  return JSON.parse(candidate.slice(first, last + 1));
}

export async function analyzeKnowledgeGap(args: {
  question: string;
  answer: string;
  sources: Retrieved[];
}): Promise<{ needsExpansion: boolean; reason: string; suggestions: KnowledgeSuggestion[] }> {
  if (!args.sources.length) {
    return { needsExpansion: true, reason: "No archive evidence was retrieved.", suggestions: [] };
  }

  const evidence = args.sources.map((s, i) =>
    `[${i + 1}] ${s.source} — ${s.title}\n${s.content}`
  ).join("\n\n");

  const response = await openai.responses.create({
    model: generationModel,
    instructions: `You are a knowledge-base gap analyst for a controlled synthetic-world RAG experiment.

Evaluate ONLY whether the supplied archive can support a meaningful answer to the user's question. Do not judge whether the fictional world is realistic.

A meaningful answer is supported when the archive directly establishes the needed mechanism, rule, consequence, or practical detail. Mark a gap when the answer relies on extrapolation, hand-waving, missing causal mechanisms, or a single narrow fact that does not answer likely follow-up questions.

When proposing additions, maximize knowledge impact:
- prefer bridge documents that answer several neighboring questions;
- prefer mechanisms over repeated declarations;
- cover practical life, institutions, economics, logistics, law, technology, agriculture, crime, politics, international trade, or culture as relevant;
- do not duplicate facts already present;
- respect the immutable canon below.

${WORLD_CANON}

Return STRICT JSON only:
{
  "needsExpansion": true|false,
  "reason": "short explanation",
  "suggestions": [
    {
      "domain": "short domain",
      "title": "proposed archive document title",
      "proposedSourceType": "e.g. regulation, technical standard, FAQ, investigative article, bank circular",
      "rationale": "why this fills a high-value gap",
      "impactQuestions": ["question this would answer", "another question"]
    }
  ]
}

Return at most 3 suggestions. If the archive is sufficient, suggestions must be [].
`,
    input: `USER QUESTION:\n${args.question}\n\nASSISTANT ANSWER:\n${args.answer}\n\nRETRIEVED ARCHIVE:\n${evidence}`
  });

  try {
    const parsed = extractJson(response.output_text);
    const raw = Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 3) : [];
    if (!parsed.needsExpansion || !raw.length) {
      return {
        needsExpansion: Boolean(parsed.needsExpansion),
        reason: String(parsed.reason || ""),
        suggestions: []
      };
    }

    const sql = db();
    const saved: KnowledgeSuggestion[] = [];

    for (const item of raw) {
      const domain = String(item.domain || "general").slice(0, 80);
      const title = String(item.title || "Untitled knowledge addition").slice(0, 240);
      const rationale = String(item.rationale || "").slice(0, 1200);
      const proposedSourceType = String(item.proposedSourceType || "reference document").slice(0, 120);
      const impactQuestions = Array.isArray(item.impactQuestions)
        ? item.impactQuestions.map((q: unknown) => String(q)).slice(0, 6)
        : [];

      const existing = await sql`
        SELECT id, domain, title, rationale, proposed_source_type, impact_questions
        FROM knowledge_suggestions
        WHERE lower(title) = lower(${title})
          AND status IN ('proposed','approved')
        ORDER BY created_at DESC
        LIMIT 1
      `;

      if (existing.length) {
        saved.push({
          id: existing[0].id,
          domain: existing[0].domain,
          title: existing[0].title,
          rationale: existing[0].rationale,
          proposedSourceType: existing[0].proposed_source_type,
          impactQuestions: existing[0].impact_questions ?? []
        });
        continue;
      }

      const rows = await sql`
        INSERT INTO knowledge_suggestions
          (trigger_question, domain, title, rationale, proposed_source_type, impact_questions)
        VALUES (
          ${args.question},
          ${domain},
          ${title},
          ${rationale},
          ${proposedSourceType},
          ${JSON.stringify(impactQuestions)}::jsonb
        )
        RETURNING id
      `;

      saved.push({
        id: rows[0].id,
        domain,
        title,
        rationale,
        proposedSourceType,
        impactQuestions
      });
    }

    return {
      needsExpansion: true,
      reason: String(parsed.reason || "The archive does not yet cover this question deeply enough."),
      suggestions: saved
    };
  } catch {
    return { needsExpansion: false, reason: "", suggestions: [] };
  }
}

export async function generateApprovedKnowledge(suggestionId: string | number) {
  const sql = db();
  const rows = await sql`
    SELECT id, trigger_question, domain, title, rationale, proposed_source_type, impact_questions, status
    FROM knowledge_suggestions
    WHERE id = ${suggestionId}
    LIMIT 1
  `;

  if (!rows.length) throw new Error("Knowledge suggestion not found");
  const suggestion = rows[0];
  if (suggestion.status !== "proposed") {
    throw new Error("This knowledge suggestion has already been processed");
  }

  const seedText = [
    suggestion.domain,
    suggestion.title,
    suggestion.rationale,
    ...(suggestion.impact_questions ?? [])
  ].join("\n");

  const queryEmbedding = await openai.embeddings.create({
    model: embeddingModel,
    input: seedText,
    encoding_format: "float"
  });
  const vector = `[${queryEmbedding.data[0].embedding.join(",")}]`;

  const related = await sql`
    SELECT id, source, title, published_at::text, content,
           (1 - (embedding <=> ${vector}::vector))::float AS similarity
    FROM world_documents
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> ${vector}::vector
    LIMIT 8
  `;

  const context = related.map((d: any, i: number) =>
    `[${i + 1}] ${d.source} — ${d.title} (${d.published_at})\n${d.content}`
  ).join("\n\n");

  const response = await openai.responses.create({
    model: generationModel,
    instructions: `You are an archive editor for a controlled synthetic-world experiment.

Create ONE new fictional post-event archive document that fills the approved knowledge gap. It must be useful beyond the triggering question and internally consistent with both the immutable canon and related archive material.

${WORLD_CANON}

Editorial rules:
- Publish between 2026-02-18 and 2026-09-27.
- Preserve pre-event history.
- Do not contradict any supplied archive document.
- Prefer concrete mechanisms, procedures, numbers, constraints and everyday consequences.
- Do not merely repeat that bananas are currency.
- The document should plausibly answer several of the listed impact questions.
- 450–900 words.
- Do not include meta-commentary or say it is fictional inside the document.

Return STRICT JSON only:
{
  "source": "publisher or institution",
  "title": "document title",
  "published_at": "YYYY-MM-DD",
  "domain": "domain",
  "content": "full document text"
}
`,
    input: `APPROVED IDEA:
Domain: ${suggestion.domain}
Working title: ${suggestion.title}
Source type: ${suggestion.proposed_source_type}
Rationale: ${suggestion.rationale}
Impact questions: ${JSON.stringify(suggestion.impact_questions)}

RELATED EXISTING ARCHIVE:
${context}`
  });

  const doc = extractJson(response.output_text);
  const source = String(doc.source || suggestion.proposed_source_type).slice(0, 240);
  const title = String(doc.title || suggestion.title).slice(0, 300);
  const publishedAt = String(doc.published_at || "2026-09-27");
  const domain = String(doc.domain || suggestion.domain).slice(0, 80);
  const content = String(doc.content || "").trim();

  if (!content) throw new Error("Generated document was empty");
  if (!/^2026-(0[2-9]|1[0-2])-\d{2}$/.test(publishedAt)) {
    throw new Error("Generated document returned an invalid publication date");
  }

  const embedded = await openai.embeddings.create({
    model: embeddingModel,
    input: `${source}\n${title}\n${publishedAt}\n${content}`,
    encoding_format: "float"
  });
  const docVector = `[${embedded.data[0].embedding.join(",")}]`;

  const inserted = await sql`
    INSERT INTO world_documents
      (source, title, published_at, content, embedding, domain, provenance, generated_from_suggestion_id)
    VALUES (
      ${source},
      ${title},
      ${publishedAt},
      ${content},
      ${docVector}::vector,
      ${domain},
      'generated',
      ${suggestion.id}
    )
    RETURNING id, source, title, published_at::text, domain, content
  `;

  await sql`
    UPDATE knowledge_suggestions
    SET status = 'approved',
        approved_at = now(),
        resulting_document_id = ${inserted[0].id}
    WHERE id = ${suggestion.id}
  `;

  return inserted[0];
}
