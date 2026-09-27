import OpenAI from "openai";

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const generationModel =
  process.env.OPENAI_MODEL?.trim() || "gpt-5.6";

const configuredEmbeddingModel = process.env.OPENAI_EMBEDDING_MODEL?.trim();
export const embeddingModel =
  configuredEmbeddingModel === "text-embedding-3-small"
    ? configuredEmbeddingModel
    : "text-embedding-3-small";
