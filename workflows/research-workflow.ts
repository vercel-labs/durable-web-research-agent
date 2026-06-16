import type { ModelCallStreamPart } from "@ai-sdk/workflow";
import { getWritable } from "workflow";
import {
  extractFindingsFromPages,
  fetchSourcePage,
  searchWeb,
} from "./research-steps";
import type { Finding } from "./research-types";
import { synthesizeReport } from "./synthesize";

const MAX_SOURCE_PAGES = 5;

type WorkflowStreamPart =
  | ModelCallStreamPart
  | { type: "finish-step" }
  | { type: "start-step" };

function findingKey(finding: Finding) {
  return `${finding.claim}\n${finding.sourceUrl}`;
}

function dedupeFindings(findings: Finding[]) {
  return [...findings.reduce((deduped, finding) => {
    deduped.set(findingKey(finding), finding);
    return deduped;
  }, new Map<string, Finding>()).values()];
}

async function writeToolCall(
  writable: WritableStream<WorkflowStreamPart>,
  toolCallId: string,
  toolName: string,
  input: unknown,
) {
  "use step";

  const writer = writable.getWriter();
  try {
    await writer.write({
      type: "tool-call",
      toolCallId,
      toolName,
      input,
    } as WorkflowStreamPart);
  } finally {
    writer.releaseLock();
  }
}

async function writeToolResult(
  writable: WritableStream<WorkflowStreamPart>,
  toolCallId: string,
  toolName: string,
  output: unknown,
) {
  "use step";

  const writer = writable.getWriter();
  try {
    await writer.write({
      type: "tool-result",
      toolCallId,
      toolName,
      output,
    } as WorkflowStreamPart);
    await writer.write({ type: "finish-step" });
    await writer.write({ type: "start-step" });
  } finally {
    writer.releaseLock();
  }
}

export async function researchWorkflow(question: string) {
  "use workflow";

  const writable = getWritable<WorkflowStreamPart>();
  const normalizedQuestion = question.trim();
  const findings: Finding[] = [];

  await writeToolCall(writable, "search-0", "searchWeb", {
    query: normalizedQuestion,
    maxSources: MAX_SOURCE_PAGES,
  });
  const searchResult = await searchWeb({ query: normalizedQuestion });
  await writeToolResult(writable, "search-0", "searchWeb", searchResult);

  for (const [index, source] of searchResult.sources
    .slice(0, MAX_SOURCE_PAGES)
    .entries()) {
    const toolCallId = `fetch-${index}`;
    await writeToolCall(writable, toolCallId, "fetchPage", source);
    const page = await fetchSourcePage(source);
    await writeToolResult(writable, toolCallId, "fetchPage", page);

    const extractCallId = `extract-${index}`;
    await writeToolCall(writable, extractCallId, "extractFindings", {
      sourceUrl: page.url,
      title: page.title,
      hasText: page.text.trim().length > 0,
    });
    const extracted = await extractFindingsFromPages({
      pages: [page],
      question: normalizedQuestion,
    });
    findings.push(...extracted.findings);
    await writeToolResult(writable, extractCallId, "extractFindings", extracted);
  }

  return synthesizeReport(normalizedQuestion, dedupeFindings(findings));
}
