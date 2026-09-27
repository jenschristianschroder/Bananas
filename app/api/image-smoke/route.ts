import { NextResponse } from "next/server";
import { generateWorldImage } from "@/lib/world-image";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET() {
  try {
    const result = await generateWorldImage({
      requestText: "Show an ordinary Copenhagen café in September 2026, with subtle evidence of how people pay for coffee in the current monetary system.",
      question: "What does everyday payment look like in Copenhagen now?",
      style: "scene",
      quality: "low"
    });

    return NextResponse.json({
      ok: true,
      model: result.imageModel,
      bytesApprox: Math.floor(result.imageDataUrl.length * 0.75),
      sources: result.sources.map((s) => s.title),
      briefPreview: result.visualBrief.slice(0, 500)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
