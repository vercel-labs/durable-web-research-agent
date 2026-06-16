# Durable Web Research Agent

A deep-research agent built on the [Vercel Workflow DevKit](https://vercel.com/docs/workflow). Ask a question and the app runs a **durable, resumable workflow** that searches the web, fetches source pages, extracts cited findings, and synthesizes a grounded research brief — streaming each step to the browser in real time.

Because the orchestration runs as a workflow, every step is checkpointed: the run survives restarts, retries failed steps, and can be reconnected to from any client via its `runId`.

## How it works

```
question ──▶ searchWeb ──▶ fetchSourcePage ─┐
                                            ├─▶ extractFindings ──▶ synthesizeReport ──▶ cited brief
            (per source, up to 5)  ─────────┘
```

- **`workflows/research-workflow.ts`** — the durable orchestrator (`"use workflow"`). Fans out over search results and streams `tool-call` / `tool-result` parts to the UI.
- **`workflows/research-steps.ts`** — individual durable steps (`"use step"`): DuckDuckGo search, page fetch + HTML-to-text, and finding extraction.
- **`workflows/synthesize.ts`** — final step that turns findings into a structured, cited report.
- **`app/api/research`** — starts a run and returns its `runId`.
- **`app/api/run/[runId]`** — polls run status and the final return value.
- **`app/api/readable/[runId]`** — streams workflow events to the UI as Server-Sent Events.

### Tech stack

- [Next.js 16](https://nextjs.org) (App Router)
- [Vercel Workflow DevKit](https://vercel.com/docs/workflow) (`workflow`, `@ai-sdk/workflow`)
- [AI SDK v7](https://ai-sdk.dev) via the [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) — uses plain `provider/model` strings (`anthropic/claude-sonnet-4.6`, `anthropic/claude-haiku-4.5`)
- Tailwind CSS v4, TypeScript

Web search uses DuckDuckGo's HTML endpoint, so **no search API key is required**.

## Prerequisites

- **Node.js 20+** and **[pnpm](https://pnpm.io)** (the repo uses a `pnpm-lock.yaml`)
- A **[Vercel account](https://vercel.com/signup)** — used to authenticate to the AI Gateway via OIDC (no Anthropic API key needed)
- The **[Vercel CLI](https://vercel.com/docs/cli)**: `pnpm add -g vercel`

## Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Link the project to a Vercel project (creates one if needed)
vercel link

# 3. Pull environment variables (writes .vercel/.env.development.local)
vercel env pull
```

Then start the dev server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), enter a research question, and watch the workflow stream its steps.

> Alternatively, run `vercel dev` instead of `pnpm dev` — it injects (and auto-refreshes) the OIDC token for you, so you can skip `vercel env pull`.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `VERCEL_OIDC_TOKEN` | Yes | Short-lived OpenID Connect token used to authenticate requests to the Vercel AI Gateway. Provisioned automatically by Vercel — **you do not set this by hand**. |

### How to get `VERCEL_OIDC_TOKEN`

This token is issued by Vercel; there is no dashboard field to copy. You obtain it one of two ways:

1. **`vercel env pull`** — after `vercel link`, this writes the token (along with any other project env vars) into `.vercel/.env.development.local`, which Next.js loads automatically in development. The token is short-lived (~12 hours), so re-run `vercel env pull` if requests to the gateway start failing with auth errors.
2. **`vercel dev`** — runs the app through the Vercel CLI, which injects and continuously refreshes the token for you.

In production (deployed on Vercel), the token is injected into the runtime automatically — no configuration needed.

> **Note:** `.vercel/` is git-ignored, so the pulled token is never committed. If you ever add provider keys directly instead of using the gateway, put them in `.env.local` (also git-ignored) — never commit secrets.

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Start the Next.js dev server (workflows run in-process). |
| `pnpm build` | Production build. |
| `pnpm start` | Serve the production build. |
| `pnpm lint` | Run ESLint. |

## Deploy

Deploy to Vercel — the AI Gateway OIDC token is provisioned automatically, so no secrets need to be configured:

```bash
vercel deploy        # preview
vercel deploy --prod # production
```

Or import the repository at [vercel.com/new](https://vercel.com/new).
