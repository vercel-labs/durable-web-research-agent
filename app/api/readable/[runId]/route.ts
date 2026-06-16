import { toUIMessageChunk } from "@ai-sdk/workflow";
import type { UIMessageChunk } from "ai";
import { getRun } from "workflow/api";

type RouteContext = {
  params: Promise<{ runId: string }>;
};

type ModelCallStreamPartWithToolName = {
  type: string;
  toolName?: string;
};

function createResearchUIChunkTransform() {
  return new TransformStream<unknown, UIMessageChunk>({
    start(controller) {
      controller.enqueue({ type: "start" });
      controller.enqueue({ type: "start-step" });
    },
    transform(part, controller) {
      const chunk = toUIMessageChunk(part as never);
      if (!chunk) {
        return;
      }

      if (
        chunk.type === "tool-output-available" &&
        typeof part === "object" &&
        part !== null &&
        "toolName" in part &&
        typeof (part as ModelCallStreamPartWithToolName).toolName === "string"
      ) {
        controller.enqueue({
          ...chunk,
          toolName: (part as ModelCallStreamPartWithToolName).toolName,
        } as UIMessageChunk);
        return;
      }

      controller.enqueue(chunk);
    },
    flush(controller) {
      controller.enqueue({ type: "finish-step" });
      controller.enqueue({ type: "finish" });
    },
  });
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { runId } = await params;

  let run;
  try {
    run = await getRun(runId);
    await run.status;
  } catch {
    return Response.json(
      { error: `Run ${runId} was not found.` },
      { status: 404 },
    );
  }

  const readable = (
    run.getReadable() as unknown as ReadableStream<unknown>
  ).pipeThrough(createResearchUIChunkTransform());
  const encoder = new TextEncoder();

  const stream = readable.pipeThrough(
    new TransformStream<unknown, Uint8Array>({
      transform(chunk, controller) {
        const data = typeof chunk === "string" ? chunk : JSON.stringify(chunk);
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      },
    }),
  );

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
