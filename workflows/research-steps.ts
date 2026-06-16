import { generateText, Output } from "ai";
import { z } from "zod";
import type {
  ExtractFindingsResult,
  SearchWebResult,
  SourcePage,
} from "./research-types";

const MAX_SOURCE_PAGES = 5;
const MAX_PAGE_CHARS = 12000;

const extractedFindingsSchema = z.object({
  findings: z.array(
    z.object({
      claim: z.string(),
      sourceUrl: z.string().describe("One of the source URLs provided."),
      snippet: z.string(),
    }),
  ),
});

function decodeDuckDuckGoUrl(rawUrl: string) {
  const url = rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl;
  try {
    const parsed = new URL(url, "https://duckduckgo.com");
    const redirected = parsed.searchParams.get("uddg");
    return redirected ? decodeURIComponent(redirected) : parsed.toString();
  } catch {
    return url;
  }
}

function extractDuckDuckGoResults(html: string) {
  const results: SearchWebResult["sources"] = [];
  const seen = new Set<string>();
  const resultLinkPattern =
    /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(resultLinkPattern)) {
    const url = decodeDuckDuckGoUrl(decodeHtmlEntities(match[1]));
    if (!url.startsWith("http") || seen.has(url)) {
      continue;
    }

    seen.add(url);
    results.push({
      title: htmlToText(match[2]),
      url,
    });

    if (results.length >= MAX_SOURCE_PAGES) {
      break;
    }
  }

  return results;
}

export async function searchWeb({ query }: { query: string }) {
  "use step";

  const response = await fetch(
    `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    {
      headers: {
        accept: "text/html,*/*;q=0.8",
        "user-agent": "Mozilla/5.0 (compatible; DurableResearchAgent/1.0)",
      },
    },
  );

  if (!response.ok) {
    return {
      query,
      answer: `Search fallback failed with status ${response.status}.`,
      sources: [],
    };
  }

  const html = await response.text();
  const sources = extractDuckDuckGoResults(html);

  return {
    query,
    answer: `Found ${sources.length} source page${
      sources.length === 1 ? "" : "s"
    } for "${query}".`,
    sources,
  };
}

function decodeHtmlEntities(value: string) {
  return value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'");
}

function extractTitle(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1]
    ? decodeHtmlEntities(match[1].replace(/\s+/g, " ").trim())
    : undefined;
}

function htmlToText(html: string) {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

export async function fetchSourcePage({
  title,
  url,
}: {
  title?: string;
  url: string;
}): Promise<SourcePage> {
  "use step";

  try {
    const response = await fetch(url, {
      headers: {
        accept: "text/html,text/plain;q=0.9,*/*;q=0.8",
        "user-agent": "Mozilla/5.0 (compatible; DurableResearchAgent/1.0)",
      },
    });

    if (!response.ok) {
      return {
        title,
        url,
        text: "",
        error: `Fetch failed with status ${response.status}.`,
      };
    }

    const contentType = response.headers.get("content-type") ?? "";
    const body = await response.text();
    const text = contentType.includes("html")
      ? htmlToText(body)
      : body.replace(/\s+/g, " ").trim();

    return {
      title: title ?? (contentType.includes("html") ? extractTitle(body) : undefined),
      url,
      text: text.slice(0, MAX_PAGE_CHARS),
    };
  } catch (error) {
    return {
      title,
      url,
      text: "",
      error: error instanceof Error ? error.message : "Unknown fetch error.",
    };
  }
}

export async function extractFindingsFromPages({
  pages,
  question,
}: {
  pages: SourcePage[];
  question: string;
}): Promise<ExtractFindingsResult> {
  "use step";

  const readablePages = pages.filter((page) => page.text.trim().length > 0);
  if (readablePages.length === 0) {
    return { findings: [] };
  }

  const allowedUrls = new Set(readablePages.map((page) => page.url));
  const { output } = await generateText({
    model: "anthropic/claude-haiku-4.5",
    output: Output.object({
      schema: extractedFindingsSchema,
    }),
    prompt: `
Question:
${question}

Fetched source pages:
${JSON.stringify(
  readablePages.map((page) => ({
    title: page.title,
    url: page.url,
    text: page.text,
  })),
  null,
  2,
)}

Extract 8 to 12 concise findings that answer the question. Each finding must
use one of the provided page URLs as sourceUrl and include a short snippet from
that page text. Prefer concrete technical differences, tradeoffs, use cases,
ecosystem facts, deployment details, and limitations.
`.trim(),
  });

  return {
    findings: output.findings.filter((finding) =>
      allowedUrls.has(finding.sourceUrl),
    ),
  };
}
