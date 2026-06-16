import { generateText, Output } from "ai";
import { z } from "zod";
import type { Finding, ResearchReport } from "./research-types";

const reportSchema = z.object({
  sections: z.array(
    z.object({
      heading: z.string(),
      body: z.string(),
    }),
  ),
  citations: z.array(
    z.object({
      claim: z.string(),
      sourceUrl: z.string().describe("The source URL for the cited claim."),
    }),
  ),
});

export async function synthesizeReport(
  question: string,
  findings: Finding[],
): Promise<ResearchReport> {
  "use step";

  if (findings.length === 0) {
    return {
      sections: [
        {
          heading: "Insufficient sourced findings",
          body:
            "The research run completed without any extracted findings, so a cited report cannot be generated from the workflow state.",
        },
      ],
      citations: [],
    };
  }

  const { output } = await generateText({
    model: "anthropic/claude-sonnet-4.6",
    output: Output.object({
      schema: reportSchema,
    }),
    prompt: `
Question:
${question}

Findings:
${JSON.stringify(findings, null, 2)}

Write a deep, practical research brief that answers the question using only
these findings. For comparison questions, include sections for positioning,
core capabilities, ecosystem and language/runtime fit, agent/orchestration
support, deployment tradeoffs, and a recommendation matrix. Every section must
ground its claims in the findings. Include citations for the most important
claims using the exact sourceUrl values from the findings.
`.trim(),
  });

  return {
    sections: output.sections,
    citations:
      output.citations.length > 0
        ? output.citations
        : findings.slice(0, 10).map((finding) => ({
            claim: finding.claim,
            sourceUrl: finding.sourceUrl,
          })),
  };
}
