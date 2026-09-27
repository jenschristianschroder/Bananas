import { NextResponse } from "next/server";
import { generateApprovedKnowledge } from "@/lib/knowledge";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json() as { suggestionId?: string | number };
    if (!body.suggestionId) {
      return NextResponse.json({ error: "suggestionId is required" }, { status: 400 });
    }

    const document = await generateApprovedKnowledge(body.suggestionId);
    return NextResponse.json({ ok: true, document });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
