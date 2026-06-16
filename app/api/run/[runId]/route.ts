import { NextResponse } from "next/server";
import { getRun } from "workflow/api";

type RouteContext = {
  params: Promise<{ runId: string }>;
};

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { runId } = await params;

  try {
    const run = await getRun(runId);

    const [status, workflowName, createdAt, startedAt, completedAt, returnValue] =
      await Promise.all([
      run.status,
      run.workflowName,
      run.createdAt,
      run.startedAt,
      run.completedAt,
      run.returnValue.catch(() => null),
    ]);

    return NextResponse.json({
      runId,
      status,
      workflowName,
      createdAt: toIso(createdAt),
      startedAt: toIso(startedAt),
      completedAt: toIso(completedAt),
      returnValue,
    });
  } catch {
    return NextResponse.json(
      { error: `Run ${runId} was not found.` },
      { status: 404 },
    );
  }
}
