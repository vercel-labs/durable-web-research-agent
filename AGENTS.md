<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project overview

A deep-research agent built on the [Vercel Workflow DevKit](https://vercel.com/docs/workflow).
A user asks a question; the app starts a **durable, resumable workflow** that searches the
web (DuckDuckGo HTML), fetches source pages, extracts cited findings, and synthesizes a
grounded research brief — streaming each step to the browser as it happens.

Because the orchestration runs as a workflow, every step is checkpointed: a run survives
restarts, retries failed steps, and can be reconnected to from any client by its `runId`.
Models are reached through the [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) using
plain `provider/model` strings — there is no Anthropic API key.

The orchestration lives under `workflows/`; the HTTP surface and UI live under `app/`.
See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the component map, data flow, and boundaries.

## Setup & commands

```bash
pnpm install            # install dependencies (Node 20+)
vercel link             # link to a Vercel project (needed for AI Gateway auth)
vercel env pull         # write the OIDC token to .vercel/.env.development.local
pnpm dev                # next dev — workflows run in-process
pnpm build              # next build (production build)
pnpm start              # serve the production build
pnpm lint               # eslint
vercel deploy           # preview deploy
vercel deploy --prod    # production deploy
```

`vercel dev` is an alternative to `pnpm dev` that injects and auto-refreshes the OIDC token,
so you can skip `vercel env pull`.

There is no unit-test suite. **Verify changes with `pnpm lint` and `pnpm build` (both must
pass clean), then exercise the agent in the browser at `http://localhost:3000`** — start a
run and confirm findings stream in and the final report renders.

## Conventions

- **Read the relevant guide in `node_modules/next/dist/docs/` (Next.js) and
  `node_modules/workflow/docs/` (Workflow DevKit) before writing code.** Don't invent
  framework APIs; confirm them against the docs. This is canary/pre-release tooling
  (`next@16`, `workflow@4`, `ai@7` canary, `@ai-sdk/workflow` canary) — your training data
  is likely stale.
- **Durability comes from directives, not a registry.** `"use workflow"` marks the
  orchestrator (`workflows/research-workflow.ts`); `"use step"` marks each durable step
  (`searchWeb`, `fetchSourcePage`, `extractFindingsFromPages`, `synthesizeReport`, and the
  stream writers). Steps are the retry/checkpoint boundary — keep them deterministic given
  their inputs and push side effects inside a step.
- **`next.config.ts` is wrapped with `withWorkflow(...)`** and declares
  `serverExternalPackages: ["@vercel/oidc", "ajv"]`. Leave both in place; the workflow build
  step and OIDC auth depend on them.
- **Models are gateway strings**, not provider SDK clients: `anthropic/claude-haiku-4.5` for
  finding extraction, `anthropic/claude-sonnet-4.6` for synthesis. Structured output uses
  `Output.object({ schema })` with a `zod` schema; validate model output against the allowed
  source URLs (see `extractFindingsFromPages`).
- **The three route handlers are the only HTTP surface:** `POST /api/research` starts a run,
  `GET /api/run/[runId]` polls status + return value, `GET /api/readable/[runId]` streams
  workflow events as Server-Sent Events. Keep that split; the client (`research-console.tsx`)
  depends on it.

## Code style

- Linting is **ESLint** via `eslint-config-next` (`core-web-vitals` + `typescript`), config
  in `eslint.config.mjs`. Run `pnpm lint` before finishing. There is no Biome/Prettier setup.
- TypeScript strict (`tsconfig.json`); ESM with `moduleResolution: "bundler"` — imports do
  **not** need a file extension. Use the `@/*` path alias (maps to repo root) for cross-module
  imports, e.g. `@/workflows/research-workflow`.
- Match the existing style: 2-space indent, double-quoted strings, `const` + arrow helpers,
  optional chaining / nullish coalescing. Prefer small named helper functions over inline
  comments.
- Validate workflow input/output and model output with `zod` schemas; share types through
  `workflows/research-types.ts` rather than redefining shapes.

## Security

- **Never ask the user for API keys, and never commit secrets.** Model access is via the
  Vercel AI Gateway authenticated by the short-lived `VERCEL_OIDC_TOKEN`, which Vercel
  provisions automatically (`vercel env pull` / `vercel dev` locally, injected at runtime in
  production). There are no provider API keys in the codebase.
- `.env*` and `.vercel` are gitignored, so the pulled token is never committed. If you ever
  add provider keys directly, put them in a gitignored `.env.local` — never inline them.
- **Steps fetch attacker-influenceable URLs.** `fetchSourcePage` requests URLs taken from
  DuckDuckGo results. Preserve the existing guards: HTTP(S)-only URLs, a custom user-agent,
  `try/catch` that returns an error field instead of throwing, and the `MAX_PAGE_CHARS`
  (12000) cap on extracted text. Don't widen these without reason.
- When building a `RegExp` from data, escape it (literal match) to avoid ReDoS, and bound
  untrusted input length.

## Before committing

- `pnpm lint` passes.
- `pnpm build` passes.
- A run started in the browser streams findings and produces a final report.
- No secrets, `node_modules`, build output (`.next`, `.vercel`), or `.env*` staged.
