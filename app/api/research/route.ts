import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { researchWorkflow } from "@/workflows/research-workflow";

export async function POST(req: Request) {
  const { question } = (await req.json()) as { question?: string };

  if (!question?.trim()) {
    return NextResponse.json(
      { error: "Question is required." },
      { status: 400 },
    );
  }

  const run = await start(researchWorkflow, [question.trim()]);

  return NextResponse.json({
    runId: run.runId,
  });
}
