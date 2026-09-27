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
  status: "proposed" | "approved";
  generatedDocument?: {
    id: string | number;
    source: string;
    title: string;
    published_at: string;
    domain: string;
    content: string;
    generation_creativity?: number | null;
    generation_absurdity?: number | null;
    generation_prompt?: string | null;
    generation_version?: number | null;
  };
};

export type KnowledgeGenerationOptions = {
  creativity?: number;
  absurdity?: number;
  customPrompt?: string;
};

type NormalizedGenerationOptions = {
  creativity: number;
  absurdity: number;
  customPrompt: string;
};

type SuggestionRow = {
  id: string | number;
  trigger_question: string;
  domain: string;
  title: string;
  rationale: string;
  proposed_source_type: string;
  impact_questions: string[];
  status: string;
  resulting_document_id?: string | number | null;
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

function clampScore(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function normalizeOptions(options?: KnowledgeGenerationOptions): NormalizedGenerationOptions {
  return {
    creativity: clampScore(options?.creativity, 50),
    absurdity: clampScore(options?.absurdity, 25),
    customPrompt: String(options?.customPrompt || "").trim().slice(0, 4000)
  };
}

function creativityDirection(value: number) {
  if (value <= 20) {
    return "Very conservative. Extend only what is strongly implied by the canon and related archive. Favor plain institutional language, minimal novelty, and few invented details.";
  }
  if (value <= 45) {
    return "Moderately conservative. Add useful concrete mechanisms and examples, but keep them close to plausible real-world institutional behavior.";
  }
  if (value <= 70) {
    return "Imaginative. Add distinctive mechanisms, second-order consequences, terminology, and memorable details that deepen the world while remaining coherent.";
  }
  if (value <= 90) {
    return "Highly creative. Seek surprising but causally defensible institutions, practices, incentives, side effects, and cultural details. Avoid random novelty.";
  }
  return "Maximally inventive within canon. Build bold, unusual, richly specific consequences and institutions, while preserving internal logic and all fixed facts.";
}

function absurdityDirection(value: number) {
  if (value <= 15) {
    return "Keep the world sober and realistic in tone. Avoid comic or surreal details.";
  }
  if (value <= 35) {
    return "Allow occasional eccentric details, but the document should still read like a plausible real institutional artifact.";
  }
  if (value <= 60) {
    return "Introduce visibly absurd consequences and bureaucratic adaptations, but explain them through coherent incentives, logistics, law, or economics.";
  }
  if (value <= 85) {
    return "Make the world conspicuously absurd and memorable. Escalate strange downstream effects, while making institutions respond rationally to the bizarre premise.";
  }
  return "Push absurdity close to the limit: surreal social practices, regulations, industries, and second-order consequences are welcome, but they must still obey canon, chronology, and causal consistency.";
}

async function loadSuggestion(suggestionId: string | number): Promise<SuggestionRow> {
  const sql = db();
  const rows = await sql`
    SELECT id, trigger_question, domain, title, rationale, proposed_source_type,
           impact_questions, status, resulting_document_id
    FROM knowledge_suggestions
    WHERE id = ${suggestionId}
    LIMIT 1
  `;

  if (!rows.length) throw new Error("Knowledge suggestion not found");
  return rows[0] as SuggestionRow;
}

async function retrieveRelatedArchive(suggestion: SuggestionRow) {
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
  const sql = db();

  return await sql`
    SELECT id, source, title, published_at::text, content,
           (1 - (embedding <=> ${vector}::vector))::float AS similarity
    FROM world_documents
    WHERE embedding IS NOT NULL
      AND (generated_from_suggestion_id IS NULL OR generated_from_suggestion_id <> ${suggestion.id})
    ORDER BY embedding <=> ${vector}::vector
    LIMIT 8
  `;
}

async function generateDocument(
  suggestion: SuggestionRow,
  optionsInput?: KnowledgeGenerationOptions,
  previousVersion?: { title: string; content: string; version: number } | null
) {
  const options = normalizeOptions(optionsInput);
  const related = await retrieveRelatedArchive(suggestion);

  const context = related.map((d: any, i: number) =>
    `[${i + 1}] ${d.source} — ${d.title} (${d.published_at})\n${d.content}`
  ).join("\n\n");

  const previous = previousVersion
    ? `\nPREVIOUS VERSION TO REIMAGINE (do not simply paraphrase it):
Version ${previousVersion.version}: ${previousVersion.title}
${previousVersion.content}
`
    : "";

  const response = await openai.responses.create({
    model: generationModel,
    instructions: `You are an archive editor for a controlled synthetic-world experiment.

Create ONE new fictional post-event archive document that fills the approved knowledge gap. It must be useful beyond the triggering question and internally consistent with both the immutable canon and related archive material.

${WORLD_CANON}

GENERATION CONTROLS
Creativity: ${options.creativity}/100
Direction: ${creativityDirection(options.creativity)}

Absurdity: ${options.absurdity}/100
Direction: ${absurdityDirection(options.absurdity)}

User generation prompt:
${options.customPrompt || "(no additional user direction)"}

The user prompt may influence subject emphasis, voice, details, structure, and world-building, but it must never override the immutable canon, chronology, or established archive facts.

Editorial rules:
- Publish between 2026-02-18 and 2026-09-27.
- Preserve pre-event history.
- Do not contradict any supplied archive document.
- Prefer concrete mechanisms, procedures, numbers, constraints, incentives, institutions, and everyday consequences.
- Do not merely repeat that bananas are currency.
- The document should plausibly answer several of the listed impact questions.
- Creativity controls novelty and breadth; absurdity controls how bizarre the consequences may become. Neither permits incoherence.
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
${previous}
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(publishedAt) || publishedAt < "2026-02-18" || publishedAt > "2026-09-27") {
    throw new Error("Generated document returned a publication date outside the allowed world timeline");
  }

  const embedded = await openai.embeddings.create({
    model: embeddingModel,
    input: `${source}\n${title}\n${publishedAt}\n${content}`,
    encoding_format: "float"
  });

  return {
    source,
    title,
    publishedAt,
    domain,
    content,
    vector: `[${embedded.data[0].embedding.join(",")}]`,
    options
  };
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
        SELECT
          ks.id,
          ks.domain,
          ks.title,
          ks.rationale,
          ks.proposed_source_type,
          ks.impact_questions,
          ks.status,
          wd.id AS document_id,
          wd.source AS document_source,
          wd.title AS document_title,
          wd.published_at::text AS document_published_at,
          wd.domain AS document_domain,
          wd.content AS document_content,
          wd.generation_creativity,
          wd.generation_absurdity,
          wd.generation_prompt,
          wd.generation_version
        FROM knowledge_suggestions ks
        LEFT JOIN world_documents wd ON wd.id = ks.resulting_document_id
        WHERE lower(ks.title) = lower(${title})
          AND ks.status IN ('proposed','approved')
        ORDER BY ks.created_at DESC
        LIMIT 1
      `;

      if (existing.length) {
        const row = existing[0];
        saved.push({
          id: row.id,
          domain: row.domain,
          title: row.title,
          rationale: row.rationale,
          proposedSourceType: row.proposed_source_type,
          impactQuestions: row.impact_questions ?? [],
          status: row.status === "approved" ? "approved" : "proposed",
          generatedDocument: row.document_id
            ? {
                id: row.document_id,
                source: row.document_source,
                title: row.document_title,
                published_at: row.document_published_at,
                domain: row.document_domain,
                content: row.document_content,
                generation_creativity: row.generation_creativity,
                generation_absurdity: row.generation_absurdity,
                generation_prompt: row.generation_prompt,
                generation_version: row.generation_version
              }
            : undefined
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
        impactQuestions,
        status: "proposed"
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

export async function generateApprovedKnowledge(
  suggestionId: string | number,
  generationOptions?: KnowledgeGenerationOptions
) {
  const sql = db();
  const suggestion = await loadSuggestion(suggestionId);

  if (suggestion.status !== "proposed") {
    throw new Error("This knowledge suggestion has already been processed");
  }

  const generated = await generateDocument(suggestion, generationOptions);

  const inserted = await sql`
    INSERT INTO world_documents
      (
        source, title, published_at, content, embedding, domain, provenance,
        generated_from_suggestion_id, generation_creativity, generation_absurdity,
        generation_prompt, generation_version
      )
    VALUES (
      ${generated.source},
      ${generated.title},
      ${generated.publishedAt},
      ${generated.content},
      ${generated.vector}::vector,
      ${generated.domain},
      'generated',
      ${suggestion.id},
      ${generated.options.creativity},
      ${generated.options.absurdity},
      ${generated.options.customPrompt || null},
      1
    )
    RETURNING
      id, source, title, published_at::text, domain, content,
      generation_creativity, generation_absurdity, generation_prompt, generation_version
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

export async function regenerateApprovedKnowledge(
  suggestionId: string | number,
  generationOptions?: KnowledgeGenerationOptions
) {
  const sql = db();
  const suggestion = await loadSuggestion(suggestionId);

  if (suggestion.status !== "approved" || !suggestion.resulting_document_id) {
    throw new Error("Only approved generated knowledge can be regenerated");
  }

  const currentRows = await sql`
    SELECT
      id, source, title, published_at::text, domain, content,
      generation_creativity, generation_absurdity, generation_prompt, generation_version
    FROM world_documents
    WHERE id = ${suggestion.resulting_document_id}
      AND generated_from_suggestion_id = ${suggestion.id}
    LIMIT 1
  `;

  if (!currentRows.length) throw new Error("Generated archive document not found");
  const current = currentRows[0];
  const currentVersion = Number(current.generation_version || 1);

  const generated = await generateDocument(
    suggestion,
    generationOptions,
    {
      title: current.title,
      content: current.content,
      version: currentVersion
    }
  );

  await sql`
    INSERT INTO knowledge_generation_revisions
      (
        document_id, suggestion_id, version, source, title, published_at, domain, content,
        generation_creativity, generation_absurdity, generation_prompt
      )
    VALUES (
      ${current.id},
      ${suggestion.id},
      ${currentVersion},
      ${current.source},
      ${current.title},
      ${current.published_at},
      ${current.domain},
      ${current.content},
      ${current.generation_creativity},
      ${current.generation_absurdity},
      ${current.generation_prompt}
    )
  `;

  const updated = await sql`
    UPDATE world_documents
    SET source = ${generated.source},
        title = ${generated.title},
        published_at = ${generated.publishedAt},
        domain = ${generated.domain},
        content = ${generated.content},
        embedding = ${generated.vector}::vector,
        generation_creativity = ${generated.options.creativity},
        generation_absurdity = ${generated.options.absurdity},
        generation_prompt = ${generated.options.customPrompt || null},
        generation_version = ${currentVersion + 1}
    WHERE id = ${current.id}
    RETURNING
      id, source, title, published_at::text, domain, content,
      generation_creativity, generation_absurdity, generation_prompt, generation_version
  `;

  return updated[0];
}
