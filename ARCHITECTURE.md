# ARCHITECTURE.md

A map of how this agent is put together, for humans and AI agents working in the repo. Keep
it current as the codebase evolves.

## Project identification

- **Name:** Durable Web Research Agent (`durable-web-research-agent`, v0.1.0, private)
- **License:** None declared
- **Last updated:** 2026-06-17

## Overview

A deep-research agent built on the [Vercel Workflow DevKit](https://vercel.com/docs/workflow).
A user submits a question; the app starts a durable workflow that searches the web, fetches
each source page, extracts cited findings, and synthesizes a grounded research brief. Every
step is streamed to the browser in real time, and the run is reconnectable from any client by
its `runId`. The agent runs on Vercel and the same way locally (`pnpm dev`) and in production
(`vercel deploy`).

Durability comes from directives rather than a central registry: the orchestrator is marked
`"use workflow"`, each unit of work is marked `"use step"`, and the Workflow DevKit
checkpoints step boundaries so a run survives restarts and retries failed steps.

## Project structure

```text
app/
  api/
    research/route.ts          # POST: start a run, return its runId
    run/[runId]/route.ts       # GET: poll run status + final return value
    readable/[runId]/route.ts  # GET: stream workflow events as Server-Sent Events
  components/
    research-console.tsx       # client UI: start runs, render findings/report/event log
  layout.tsx                   # root layout (Geist fonts, metadata)
  page.tsx                     # renders <ResearchConsole />
  globals.css
workflows/
  research-workflow.ts         # "use workflow" orchestrator; fans out over sources, streams parts
  research-steps.ts            # "use step" searchWeb / fetchSourcePage / extractFindingsFromPages
  synthesize.ts                # "use step" synthesizeReport — findings -> cited brief
  research-types.ts            # shared types (Finding, ResearchReport, SourcePage, ...)
next.config.ts                 # withWorkflow(nextConfig); serverExternalPackages for OIDC + ajv
```

## Core components

| Component | Lives in | Primitive | Responsibility |
| --- | --- | --- | --- |
| Research orchestrator | `workflows/research-workflow.ts` | Workflow (`"use workflow"`) | Normalizes the question, calls `searchWeb`, loops over up to 5 sources (fetch → extract), dedupes findings, returns the synthesized report. Streams `tool-call`/`tool-result` parts to the run's writable. |
| Search / fetch / extract steps | `workflows/research-steps.ts` | Steps (`"use step"`) | `searchWeb` scrapes DuckDuckGo's HTML endpoint; `fetchSourcePage` fetches a page and converts HTML to text (capped at 12000 chars); `extractFindingsFromPages` produces 8–12 cited findings via `anthropic/claude-haiku-4.5`. |
| Report synthesis | `workflows/synthesize.ts` | Step (`"use step"`) | Turns deduped findings into a structured, cited brief via `anthropic/claude-sonnet-4.6`; falls back to a placeholder section when there are no findings. |
| Start endpoint | `app/api/research/route.ts` | Route Handler | Validates the question and calls `start(researchWorkflow, [question])`, returning the `runId`. |
| Status endpoint | `app/api/run/[runId]/route.ts` | Route Handler | `getRun(runId)` → status, workflow name, timestamps, and final return value; 404 on unknown run. |
| Event stream endpoint | `app/api/readable/[runId]/route.ts` | Route Handler | Pipes the run's readable through `toUIMessageChunk` and emits Server-Sent Events. |
| Research console | `app/components/research-console.tsx` | Client component | Starts runs, subscribes to the SSE stream, polls status every 2s, and renders live findings, the final report, and an event log. |

The route handlers are the HTTP I/O boundary. Workflow and step code runs server-side under
the Workflow runtime; the orchestrator communicates progress to the UI by writing stream
parts to the run's writable (`getWritable`), which the readable endpoint relays as SSE.

## Data flow

```text
question ──▶ searchWeb ──▶ fetchSourcePage ─┐
                                            ├─▶ extractFindings ──▶ synthesizeReport ──▶ cited brief
            (per source, up to 5)  ─────────┘
```

`POST /api/research` starts the run and returns a `runId`. The client opens
`GET /api/readable/[runId]` (SSE) for live step/tool events and polls `GET /api/run/[runId]`
for status and the final report. Findings are deduped by `claim + sourceUrl` before synthesis.

## Data stores

- **Workflow run store** (managed by the Workflow DevKit): holds each run's checkpointed
  state, status, and return value. This is what makes runs durable, resumable, and
  reconnectable by `runId`; the app reads it via `getRun`/`start` from `workflow/api`.
- **Source pages** (external, transient): fetched live over HTTP for each run and never
  persisted beyond the run's workflow state.

There is no application database.

## External integrations

| Integration | Purpose | Method |
| --- | --- | --- |
| DuckDuckGo HTML | Web search (source discovery) | Plain `fetch` of `duckduckgo.com/html/`, results scraped from the response — **no search API key required** |
| Source websites | Evidence for findings | `fetch` per result URL, HTML-to-text with a 12000-char cap |
| Vercel AI Gateway | Model access for extraction and synthesis | AI SDK gateway model ids (`anthropic/claude-haiku-4.5`, `anthropic/claude-sonnet-4.6`) authenticated by the project's OIDC token |
| Workflow runtime | Durable orchestration | `withWorkflow` build wrapper + `start`/`getRun` from `workflow/api`; steps via `"use step"` |

## Deployment & infrastructure

- **Platform:** Vercel. Deploy with `vercel deploy` (preview) or `vercel deploy --prod`
  (production), or import the repo at [vercel.com/new](https://vercel.com/new).
- **Environment:** `VERCEL_OIDC_TOKEN` is the only required variable. It is short-lived
  (~12h) and provisioned by Vercel — never set by hand. In production it is injected into the
  runtime automatically; no secrets need configuring.
- **Local development:** `pnpm dev` runs the workflow in-process. Authenticate the AI Gateway
  with `vercel link` + `vercel env pull` (writes `.vercel/.env.development.local`), or run
  `vercel dev`, which injects and auto-refreshes the token.

## Security considerations

- **No provider API keys.** Model access is via the Vercel AI Gateway authenticated by the
  project OIDC token. `.env*` and `.vercel` are gitignored, so the pulled token is never
  committed.
- **Outbound fetch of attacker-influenceable URLs.** `searchWeb`/`fetchSourcePage` request
  URLs derived from DuckDuckGo results. Guards in place: HTTP(S)-only URLs (non-http links are
  skipped), a fixed custom user-agent, `try/catch` that records an `error` field instead of
  throwing, and a `MAX_PAGE_CHARS` (12000) cap on extracted text.
- **Grounded model output.** Extracted findings are filtered to the set of source URLs
  actually fetched (`allowedUrls`), so the model cannot cite a page that wasn't part of the
  run; HTML entities are decoded and tags stripped before text reaches a model.

## Development & testing

- **Run locally:** `pnpm dev`, then start a run at `http://localhost:3000`.
- **Lint:** `pnpm lint` (ESLint via `eslint-config-next`).
- **Build:** `pnpm build` (Next.js production build).
- There is no unit-test suite; verify behavior by running a research question end-to-end in
  the browser and watching the findings stream and final report.

## Future considerations

- `MAX_SOURCE_PAGES` (5) is defined in both `research-workflow.ts` and `research-steps.ts`;
  consider centralizing it to keep the search cap and fetch cap in sync.
- Source pages are fetched sequentially in the orchestrator's loop; fanning the
  fetch/extract steps out in parallel would reduce wall-clock time per run.
- Search relies on scraping DuckDuckGo's HTML endpoint, which is brittle to markup changes; a
  dedicated search API (behind a step) would be more robust.

## Glossary

- **Workflow:** the durable orchestrator marked `"use workflow"`; its progress is checkpointed
  and it is reconnectable by `runId`.
- **Step:** a unit of work marked `"use step"` — the retry and checkpoint boundary. Web
  search, page fetch, finding extraction, and synthesis are each steps.
- **Run / `runId`:** one execution of the workflow; its state lives in the Workflow run store
  and is queried via `getRun`.
- **Finding:** a `{ claim, sourceUrl, snippet }` record extracted from a fetched page.
- **Report:** the final `{ sections, citations }` brief produced by `synthesizeReport`.
- **AI Gateway:** Vercel's unified model endpoint; models are addressed as `provider/model`
  strings and authenticated by the project OIDC token.
- **OIDC token (`VERCEL_OIDC_TOKEN`):** the short-lived Vercel identity token used to
  authenticate the AI Gateway without static API keys.
