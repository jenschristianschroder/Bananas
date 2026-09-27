import { NextResponse } from "next/server";
import { generateWorldImage } from "@/lib/world-image";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      requestText?: string;
      question?: string;
      answerContext?: string;
      style?: "scene" | "infographic" | "poster";
    };

    if (!body.requestText?.trim()) {
      return NextResponse.json({ error: "requestText is required" }, { status: 400 });
    }

    const result = await generateWorldImage({
      requestText: body.requestText,
      question: body.question,
      answerContext: body.answerContext,
      style: body.style,
      quality: "medium"
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown image-generation error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
