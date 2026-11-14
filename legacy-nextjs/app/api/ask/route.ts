import { NextResponse } from "next/server";
import { runPipeline } from "@/lib/pipeline";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { question } = (await req.json()) as { question?: unknown };

    if (typeof question !== "string" || !question.trim()) {
      return NextResponse.json({ error: "Enter a question." }, { status: 400 });
    }

    const result = await runPipeline(question.trim());
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Something went wrong.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
