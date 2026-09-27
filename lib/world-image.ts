import { db } from "@/lib/db";
import { WORLD_CANON } from "@/lib/canon";
import {
  embeddingModel,
  generationModel,
  imageModel,
  openai
} from "@/lib/openai";

export type ImageStyle = "scene" | "infographic" | "poster";

type GroundingSource = {
  id: number | string;
  source: string;
  title: string;
  published_at: string;
  content: string;
  similarity?: number | null;
  provenance?: string;
};

function normalizeStyle(value: unknown): ImageStyle {
  return value === "infographic" || value === "poster" ? value : "scene";
}

async function retrieveImageGrounding(query: string): Promise<GroundingSource[]> {
  const sql = db();

  const embedding = await openai.embeddings.create({
    model: embeddingModel,
    input: query,
    encoding_format: "float"
  });
  const vector = `[${embedding.data[0].embedding.join(",")}]`;

  const semantic = await sql`
    SELECT id, source, title, published_at::text, content, provenance,
           (1 - (embedding <=> ${vector}::vector))::float AS similarity
    FROM world_documents
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> ${vector}::vector
    LIMIT 7
  ` as GroundingSource[];

  const recentGenerated = await sql`
    SELECT id, source, title, published_at::text, content, provenance,
           NULL::float AS similarity
    FROM world_documents
    WHERE provenance = 'generated'
    ORDER BY created_at DESC
    LIMIT 2
  ` as GroundingSource[];

  const seen = new Set<string>();
  const combined: GroundingSource[] = [];

  for (const item of [...semantic, ...recentGenerated]) {
    const key = String(item.id);
    if (seen.has(key)) continue;
    seen.add(key);
    combined.push(item);
  }

  return combined.slice(0, 9);
}

function styleGuidance(style: ImageStyle) {
  if (style === "infographic") {
    return "Create a clean explanatory infographic. Use a small number of short labels, clear visual hierarchy, diagrams/icons where useful, and avoid dense paragraphs.";
  }
  if (style === "poster") {
    return "Create an in-world public-information poster or institutional communication artifact that plausibly exists in September 2026. Keep visible text short, legible, and limited.";
  }
  return "Create a believable documentary-style scene from everyday life in this world. Favor natural details and environmental storytelling over overt exposition.";
}

export async function generateWorldImage(args: {
  requestText: string;
  question?: string;
  answerContext?: string;
  style?: ImageStyle | string;
  quality?: "low" | "medium";
}) {
  const requestText = args.requestText.trim();
  if (!requestText) throw new Error("Image request is required");

  const style = normalizeStyle(args.style);
  const query = [
    requestText,
    args.question?.trim(),
    args.answerContext?.trim()
  ].filter(Boolean).join("\n\n");

  const sources = await retrieveImageGrounding(query);

  const archive = sources.map((source, index) =>
    `[Archive ${index + 1}] ${source.source} — ${source.title} (${source.published_at})\n${source.content}`
  ).join("\n\n");

  const briefResponse = await openai.responses.create({
    model: generationModel,
    instructions: `You are the visual continuity editor for a controlled synthetic-world experiment.

Build an image-generation brief representing the world as it is understood on September 27, 2026.

AUTHORITATIVE CANON:
${WORLD_CANON}

Rules:
- The supplied archive is authoritative for post-February-16, 2026 world facts.
- The user's earlier text answer is context for what they want visualized, NOT evidence. Never promote unsupported claims from that answer into the visual world.
- Use ordinary pre-event reality for neutral background details unless the archive changes them.
- Prefer subtle, internally consistent consequences over gimmicks. If bananas are money, show the actual institutional/economic mechanisms described by the archive rather than piles of fruit everywhere.
- Do not depict obsolete currencies as currently accepted money unless the scene is explicitly historical.
- If a visual fact is not established, avoid inventing a highly specific institution, law, flag, political leader, statistic, or geopolitical boundary.
- ${styleGuidance(style)}
- Write one concise but detailed production prompt, with composition, setting, people/objects, signage if relevant, and constraints.
- Do not mention that the world is fictional, alternate, simulated, or part of an experiment in the production prompt.
`,
    input: `USER IMAGE REQUEST:
${requestText}

ORIGINAL QUESTION:
${args.question?.trim() || "(none)"}

EARLIER ASSISTANT ANSWER (intent only, not evidence):
${args.answerContext?.trim() || "(none)"}

RELEVANT WORLD ARCHIVE:
${archive || "(No archive excerpts were retrieved.)"}`
  });

  const visualBrief = briefResponse.output_text.trim();
  if (!visualBrief) throw new Error("Could not build a visual brief");

  const imageResponse = await openai.images.generate({
    model: imageModel,
    prompt: visualBrief,
    size: "1024x1024",
    quality: args.quality || "medium",
    output_format: "webp",
    output_compression: 82,
    background: "opaque",
    n: 1
  } as any);

  const b64 = imageResponse.data?.[0]?.b64_json;
  if (!b64) throw new Error("Image model returned no image data");

  const sql = db();
  const sourceIds = `{${sources.map((source) => source.id).join(",")}}`;

  try {
    await sql`
      INSERT INTO image_generations
        (request_text, answer_context, visual_style, visual_brief, model, source_ids)
      VALUES (
        ${requestText},
        ${args.answerContext?.trim() || null},
        ${style},
        ${visualBrief},
        ${imageModel},
        ${sourceIds}::bigint[]
      )
    `;
  } catch {
    // Provenance logging should not block a successful image response.
  }

  return {
    imageDataUrl: `data:image/webp;base64,${b64}`,
    imageModel,
    visualBrief,
    style,
    sources: sources.map(({ id, source, title, published_at, similarity, provenance }) => ({
      id,
      source,
      title,
      publishedAt: published_at,
      similarity: similarity ?? null,
      provenance: provenance || "seed"
    }))
  };
}
