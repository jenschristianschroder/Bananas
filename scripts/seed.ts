import docs from "../data/documents.json";
import { neon } from "@neondatabase/serverless";
import OpenAI from "openai";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");

const sql = neon(process.env.DATABASE_URL);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const model = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

await sql`TRUNCATE world_documents RESTART IDENTITY`;
for (const doc of docs) {
  const input = `${doc.source}\n${doc.title}\n${doc.published_at}\n${doc.content}`;
  const result = await openai.embeddings.create({ model, input, encoding_format: "float" });
  const vector = `[${result.data[0].embedding.join(",")}]`;
  await sql`
    INSERT INTO world_documents (source, title, published_at, content, embedding)
    VALUES (${doc.source}, ${doc.title}, ${doc.published_at}, ${doc.content}, ${vector}::vector)
  `;
  console.log(`Seeded: ${doc.title}`);
}
console.log(`Seeded ${docs.length} documents`);
