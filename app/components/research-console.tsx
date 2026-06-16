"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UIMessageChunk } from "ai";
import type {
  ExtractFindingsResult,
  Finding,
  ResearchReport,
} from "@/workflows/research-types";

const DEFAULT_QUESTION = "vercel ai sdk vs langchain?";

type RunStatus = {
  status?: string;
  returnValue?: ResearchReport | null;
};

type ToolInputChunk = Extract<UIMessageChunk, { type: "tool-input-available" }>;
type ToolOutputChunk = Extract<UIMessageChunk, { type: "tool-output-available" }>;
type ToolInputStartChunk = Extract<UIMessageChunk, { type: "tool-input-start" }>;
type ToolOutputErrorChunk = Extract<UIMessageChunk, { type: "tool-output-error" }>;
type ToolInputErrorChunk = Extract<UIMessageChunk, { type: "tool-input-error" }>;
type ResearchToolOutputChunk = ToolOutputChunk & { toolName?: string };

type EventLogRow = {
  id: string;
  label: string;
  detail?: string;
  tone: "neutral" | "start" | "finish" | "error";
};

function isUIMessageChunk(value: unknown): value is UIMessageChunk {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string"
  );
}

function isFinding(value: unknown): value is Finding {
  return (
    typeof value === "object" &&
    value !== null &&
    "claim" in value &&
    typeof value.claim === "string" &&
    "sourceUrl" in value &&
    typeof value.sourceUrl === "string" &&
    "snippet" in value &&
    typeof value.snippet === "string"
  );
}

function isExtractFindingsResult(value: unknown): value is ExtractFindingsResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "findings" in value &&
    Array.isArray(value.findings)
  );
}

function getFindingsFromToolOutput(toolName: string | undefined, output: unknown) {
  if (toolName === "extractFindings" && isExtractFindingsResult(output)) {
    return output.findings.filter(isFinding);
  }

  return [];
}

function getSourceHost(sourceUrl: string) {
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    return sourceUrl;
  }
}

function buildEventLogRows(chunks: UIMessageChunk[]): EventLogRow[] {
  const toolNames = new Map<string, string>();
  const rows: EventLogRow[] = [];
  let stepNumber = 0;

  for (const [index, chunk] of chunks.entries()) {
    switch (chunk.type) {
      case "start":
        rows.push({
          id: `${index}-start`,
          label: "Stream started",
          detail: chunk.messageId,
          tone: "start",
        });
        break;
      case "start-step":
        stepNumber += 1;
        rows.push({
          id: `${index}-start-step`,
          label: `Step ${stepNumber} started`,
          tone: "start",
        });
        break;
      case "finish-step":
        rows.push({
          id: `${index}-finish-step`,
          label: `Step ${stepNumber} finished`,
          tone: "finish",
        });
        break;
      case "finish":
        rows.push({
          id: `${index}-finish`,
          label: "Stream finished",
          detail: chunk.finishReason,
          tone: "finish",
        });
        break;
      case "tool-input-start": {
        const toolInput = chunk as ToolInputStartChunk;
        toolNames.set(toolInput.toolCallId, toolInput.toolName);
        rows.push({
          id: `${index}-tool-input-start`,
          label: `Tool input started: ${toolInput.toolName}`,
          detail: toolInput.toolCallId,
          tone: "start",
        });
        break;
      }
      case "tool-input-available": {
        const toolInput = chunk as ToolInputChunk;
        toolNames.set(toolInput.toolCallId, toolInput.toolName);
        rows.push({
          id: `${index}-tool-input-available`,
          label: `Tool started: ${toolInput.toolName}`,
          detail: toolInput.toolCallId,
          tone: "start",
        });
        break;
      }
      case "tool-output-available": {
        const toolOutput = chunk as ResearchToolOutputChunk;
        rows.push({
          id: `${index}-tool-output-available`,
          label: `Tool finished: ${
            toolOutput.toolName ??
            toolNames.get(toolOutput.toolCallId) ??
            "unknown"
          }`,
          detail: toolOutput.toolCallId,
          tone: "finish",
        });
        break;
      }
      case "tool-input-error": {
        const toolInputError = chunk as ToolInputErrorChunk;
        rows.push({
          id: `${index}-tool-input-error`,
          label: `Tool input failed: ${toolInputError.toolName}`,
          detail: toolInputError.errorText,
          tone: "error",
        });
        break;
      }
      case "tool-output-error": {
        const toolOutputError = chunk as ToolOutputErrorChunk;
        rows.push({
          id: `${index}-tool-output-error`,
          label: `Tool failed: ${
            toolNames.get(toolOutputError.toolCallId) ?? "unknown"
          }`,
          detail: toolOutputError.errorText,
          tone: "error",
        });
        break;
      }
      case "text-start":
        rows.push({
          id: `${index}-text-start`,
          label: "Model text started",
          tone: "start",
        });
        break;
      case "text-end":
        rows.push({
          id: `${index}-text-end`,
          label: "Model text finished",
          tone: "finish",
        });
        break;
      case "error":
        rows.push({
          id: `${index}-error`,
          label: "Stream error",
          detail: chunk.errorText,
          tone: "error",
        });
        break;
      default:
        break;
    }
  }

  return rows;
}

export function ResearchConsole() {
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const [runId, setRunId] = useState<string | null>(null);
  const [chunks, setChunks] = useState<UIMessageChunk[]>([]);
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  const findings = useMemo(() => {
    const toolNames = new Map<string, string>();
    const byId = new Map<string, { id: string; data: Finding }>();

    for (const chunk of chunks) {
      if (chunk.type === "tool-input-available") {
        const toolInput = chunk as ToolInputChunk;
        toolNames.set(toolInput.toolCallId, toolInput.toolName);
      }

      if (chunk.type === "tool-output-available") {
        const toolOutput = chunk as ResearchToolOutputChunk;
        const toolName = toolOutput.toolName ?? toolNames.get(toolOutput.toolCallId);
        for (const [findingIndex, finding] of getFindingsFromToolOutput(
          toolName,
          toolOutput.output,
        ).entries()) {
          byId.set(`${toolOutput.toolCallId}-${findingIndex}`, {
            id: `${toolOutput.toolCallId}-${findingIndex}`,
            data: finding,
          });
        }
      }
    }

    return [...byId.values()];
  }, [chunks]);

  const report = status?.returnValue ?? null;
  const eventLogRows = useMemo(() => buildEventLogRows(chunks), [chunks]);
  const runState = status?.status ?? (runId ? "starting" : null);
  const isResearching =
    Boolean(runId) && runState !== "completed" && runState !== "failed";

  const startRun = useCallback(async () => {
    setError(null);
    setStatus(null);
    setChunks([]);
    setRunId(null);
    setIsStarting(true);

    try {
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });

      const body = (await response.json()) as { runId?: string; error?: string };

      if (!response.ok || !body.runId) {
        throw new Error(body.error ?? "Unable to start the research run.");
      }

      setRunId(body.runId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unknown error");
    } finally {
      setIsStarting(false);
    }
  }, [question]);

  useEffect(() => {
    if (!runId) {
      return;
    }

    sourceRef.current?.close();
    const source = new EventSource(`/api/readable/${runId}`);
    sourceRef.current = source;

    source.onmessage = (message) => {
      try {
        const parsed = JSON.parse(message.data) as unknown;
        if (isUIMessageChunk(parsed)) {
          setChunks((current) => [...current, parsed]);
        }
      } catch {
        setChunks((current) => [...current, { type: "error", errorText: message.data }]);
      }
    };

    source.onerror = () => {
      source.close();
    };

    const interval = window.setInterval(async () => {
      const response = await fetch(`/api/run/${runId}`);
      if (response.ok) {
        const nextStatus = (await response.json()) as RunStatus;
        setStatus(nextStatus);
      }
    }, 2000);

    return () => {
      source.close();
      window.clearInterval(interval);
    };
  }, [runId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        if (!isStarting && !isResearching && question.trim()) {
          void startRun();
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isResearching, isStarting, question, startRun]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1480px] px-5 pb-24 pt-7 text-[#f1f1f1] sm:px-8 md:pt-9 lg:px-14 xl:px-16">
      <div className="mx-auto w-full max-w-[1320px]">
        <header className="pb-16 md:pb-20">
          <h1 className="max-w-[900px] text-[58px] font-medium leading-[0.98] text-[#f2f2f2] sm:text-[76px] md:text-[96px] lg:text-[108px]">
            Durable web research agent
          </h1>
          <p className="mt-8 max-w-[860px] text-[19px] font-medium leading-[1.7] text-[#8d8d8d] md:text-[22px]">
            Start a research run, watch findings stream in as the agent records
            them, and inspect the live workflow status the whole way through.
          </p>
        </header>

        <section className="pb-20 md:pb-24">
          <div className="mb-5 flex items-baseline gap-4">
            <span className="font-mono text-[15px] text-[#626262]">00</span>
            <h2 className="text-[22px] font-semibold text-[#f5f5f5] md:text-[24px]">
              Research question
            </h2>
          </div>

          <textarea
            aria-label="Research question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            rows={4}
            className="min-h-[116px] w-full resize-y rounded-[16px] border border-[#303030] bg-[#050505] px-6 py-6 text-[22px] font-medium leading-[1.45] text-[#f5f5f5] outline-none transition placeholder:text-[#555] focus:border-[#737373] focus:bg-[#070707] md:min-h-[126px] md:px-7 md:text-[25px]"
          />

          <div className="mt-7 flex flex-wrap items-center gap-5">
            <button
              type="button"
              onClick={startRun}
              disabled={isStarting || isResearching || !question.trim()}
              className="inline-flex h-[64px] items-center gap-3 rounded-[12px] bg-[#eeeeee] px-7 text-[20px] font-semibold text-black transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-55"
            >
              {isStarting || isResearching ? (
                <span className="size-4 animate-spin rounded-full border-2 border-black/20 border-t-black" />
              ) : null}
              {isStarting || isResearching ? "Researching..." : "Start research"}
            </button>
            <div className="flex items-center gap-3 text-[16px] font-medium text-[#666]">
              <span className="rounded-[8px] border border-[#303030] bg-[#050505] px-3 py-1.5 font-mono text-[13px] text-[#a8a8a8]">
                ⌘ ↵
              </span>
              <span>to run</span>
            </div>
          </div>

          {runId ? (
            <div className="mt-7 flex max-w-full flex-wrap items-center gap-x-7 gap-y-3 font-mono text-[14px] leading-6 text-[#777]">
              <p className="flex items-center gap-3">
                <span className="size-2 rounded-full bg-[#7a7a7a]" />
                <span>status</span>
                <span className="font-semibold text-[#eeeeee]">
                  {runState ?? "starting"}
                </span>
              </p>
              <p className="flex min-w-0 items-center gap-3">
                <span>run</span>
                <span className="max-w-[560px] truncate font-semibold text-[#eeeeee]">
                  {runId}
                </span>
              </p>
            </div>
          ) : null}

          {error ? (
            <p className="mt-8 border-l border-[#ff6b7a] pl-4 text-[18px] font-medium text-[#ff8a96]">
              {error}
            </p>
          ) : null}
        </section>

        <section className="pb-20 md:pb-24">
          <div className="mb-8 flex items-center justify-between gap-5 border-b border-[#202020] pb-6">
            <div className="flex items-baseline gap-4">
              <span className="font-mono text-[15px] text-[#626262]">01</span>
              <h2 className="text-[22px] font-semibold text-[#f5f5f5] md:text-[24px]">
                Live findings
              </h2>
            </div>
            <span className="rounded-full border border-[#303030] bg-[#050505] px-4 py-1.5 font-mono text-[13px] text-[#9b9b9b]">
              {findings.length} recorded
            </span>
          </div>

          {findings.length === 0 ? (
            <p className="text-[20px] font-medium leading-[1.55] text-[#626262]">
              Findings will appear here as the agent records them.
            </p>
          ) : (
            <div>
              {findings.map((finding, index) => (
                <article
                  key={finding.id}
                  className="border-b border-[#191919] py-7 first:pt-0"
                >
                  <div className="mb-4 flex items-center gap-2 font-mono text-[13px] text-[#6d6d6d]">
                    <span>finding {String(index + 1).padStart(2, "0")}</span>
                    <span>•</span>
                    <span>sourced</span>
                  </div>
                  <p className="max-w-[1040px] text-[20px] font-medium leading-[1.55] text-[#eeeeee] md:text-[22px]">
                    {finding.data.claim}
                  </p>
                  <p className="mt-4 max-w-[980px] text-[15px] leading-7 text-[#8f8f8f] md:text-[16px]">
                    {finding.data.snippet}
                  </p>
                  <a
                    className="mt-5 inline-flex max-w-full items-center gap-2 rounded-full border border-[#272727] bg-[#050505] px-3 py-1.5 font-mono text-[13px] text-[#a9a9a9] transition hover:border-[#454545] hover:text-white"
                    href={finding.data.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span>↗</span>
                    <span className="truncate">{getSourceHost(finding.data.sourceUrl)}</span>
                  </a>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="pb-20 md:pb-24">
          <div className="mb-8 flex items-baseline gap-4 border-b border-[#202020] pb-6">
            <span className="font-mono text-[15px] text-[#626262]">02</span>
            <h2 className="text-[22px] font-semibold text-[#f5f5f5] md:text-[24px]">
              Final report
            </h2>
          </div>

          {report ? (
            <div className="space-y-9">
              {report.sections.map((section) => (
                <section key={section.heading} className="max-w-[980px]">
                  <h3 className="text-[19px] font-semibold text-[#f1f1f1]">
                    {section.heading}
                  </h3>
                  <p className="mt-3 whitespace-pre-line text-[16px] leading-8 text-[#a8a8a8]">
                    {section.body}
                  </p>
                </section>
              ))}
              <div className="max-w-[980px] border-t border-[#202020] pt-7">
                <h3 className="text-[19px] font-semibold text-[#f1f1f1]">
                  Citations
                </h3>
                <ul className="mt-4 space-y-3">
                  {report.citations.map((citation) => (
                    <li key={`${citation.claim}-${citation.sourceUrl}`}>
                      <a
                        className="text-[15px] leading-7 text-[#9a9a9a] underline decoration-[#333] underline-offset-4 transition hover:text-white"
                        href={citation.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {citation.claim}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <p className="text-[20px] font-medium leading-[1.55] text-[#626262]">
              The final report will appear when the workflow completes.
            </p>
          )}
        </section>

        <section>
          <div className="mb-8 flex items-center justify-between gap-5 border-b border-[#202020] pb-6">
            <div className="flex items-baseline gap-4">
              <span className="font-mono text-[15px] text-[#626262]">03</span>
              <h2 className="text-[22px] font-semibold text-[#f5f5f5] md:text-[24px]">
                Event log
              </h2>
            </div>
            <span className="rounded-full border border-[#303030] bg-[#050505] px-4 py-1.5 font-mono text-[13px] text-[#9b9b9b]">
              {eventLogRows.length} events
            </span>
          </div>

          {eventLogRows.length === 0 ? (
            <p className="text-[20px] font-medium leading-[1.55] text-[#626262]">
              Events will stream here once a run starts.
            </p>
          ) : (
            <ul className="divide-y divide-[#171717]">
              {eventLogRows.map((row) => (
                <li
                  key={row.id}
                  className="grid gap-1 py-3"
                >
                  <span
                    className={
                      row.tone === "error"
                        ? "font-mono text-[13px] text-[#ff8a96]"
                        : row.tone === "finish"
                          ? "font-mono text-[13px] text-[#d8d8d8]"
                          : "font-mono text-[13px] text-[#8d8d8d]"
                    }
                  >
                    {row.label}
                  </span>
                  {row.detail ? (
                    <span className="break-all font-mono text-[12px] leading-5 text-[#555]">
                      {row.detail}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
