import OpenAI from "openai";

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
export const generationModel = process.env.OPENAI_MODEL || "gpt-5.6";
export const embeddingModel = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
