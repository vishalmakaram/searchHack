# Sentinel frontend — build plan

> **Status, 14 Nov 2026.** The mock backend described below has been replaced. The app now drives the real
> Sentinel runtime and output service at the repository root; see `README.md` for how it is wired and run.
> Sections on the mock compiler, seeded data, query approval, and workspace rename and delete no longer apply.
> The page structure, design rules, script statuses and the webhook receiver are as built.


This is the working plan for the `frontend/` Next.js app. It is written for agents who have not seen any earlier conversation. Read sections 1–6 and 8 before writing code, then do only the work package you were assigned (section 9).

## 1. What we are building

Sentinel lets a user describe, in one sentence, something they want watched on the web. A compiler agent turns that sentence into search queries and a **processing script**. Telem (an external search and monitoring service) polls the web and sends new results to us through a **webhook**. Each result is run through one or more processing scripts, which turn a raw page into a small structured result.

Three other people are building the real backend (compiler, script runtime, Telem connector). It does not exist yet. **This app is the control surface, and it runs entirely on mock data and a simulated runtime**, behind a boundary that the real backend can replace later.

The app must let the user do four things:

1. **Create a workspace from a sentence**, review the proposed queries, and approve them (compiler is mocked).
2. **See every processing script and its status**: developed, active or inactive (definitions in section 3).
3. **Create webhooks** that Telem posts to, and choose which script or scripts each webhook feeds.
4. **See the state of the data-processing pipeline on the main page**: what is arriving, what is running, what failed.

Fuller background is in `mvp_idea.txt` at the repository root, if it exists on your machine. It is a local-only file: never commit it, and never add it to any `.gitignore`.

## 2. Out of scope — do not build

- **Output integrations** (Telegram, WebSocket output, local document, Slack, anything that sends results onward). The user explicitly cut these. Do not build them and do not add a placeholder page or nav item.
- Calls to the Telem API. We only *receive* webhooks; we never create monitors or run searches.
- Real script compilation or execution, authentication, multi-user support, billing or spend display, a database server.
- Any change outside `frontend/`. The Python code at the repository root belongs to someone else.

## 3. Vocabulary and status definitions

Use these words in code and in the UI. The user's phrase "processes being run" means **runs**.

| Term | Meaning |
|---|---|
| Workspace | One thing the user wants watched: the sentence, its queries, and the script compiled for it. |
| Script | A processing script plus the output schema it must produce. Compiled per workspace. |
| Webhook | A URL in this app that Telem posts new results to. Routes to zero or more scripts. |
| Delivery | One HTTP POST received on a webhook. May contain several events. |
| Event | One change inside a delivery (one new or changed page). |
| Run | One event being processed by one script. |

**Script status** is the lifecycle state the user asked for. It is stored, and changes only through user actions:

| Status | Definition | How it gets there |
|---|---|---|
| `developed` | Compiled but never deployed. `deployedAt` is `null`. | Created when a workspace's queries are approved. |
| `active` | Deployed and switched on. Receives events. | "Deploy" from `developed`, or "Reactivate" from `inactive`. |
| `inactive` | Was deployed at some point, now switched off. Receives nothing. | "Deactivate" from `active`. |

A script never returns to `developed`. Any other transition is an error (HTTP 409).

**Script activity** is separate from status and is derived, never stored: `off` (not active), `idle` (active, nothing in flight), `processing` (at least one run queued or running), `failing` (active, and at least half of its last 10 finished runs were `failed` or `invalid`; `failing` wins over the others).

**Run status**: `queued` → `running` → one of `succeeded`, `invalid` (the script ran but its output did not match the schema), `failed` (the script errored).

## 4. Decisions already made

- **Runs on the user's own machine** with `npm run dev`. Telem reaches the webhook through a tunnel (for example `cloudflared tunnel --url http://localhost:3000`). The public address goes in `PUBLIC_BASE_URL` in `frontend/.env.local`, which is already git-ignored.
- **The webhook receiver is real.** `POST /api/hooks/{id}` accepts real HTTP requests, so it can be exercised with `curl`, the in-app "Send test event" button, or Telem itself.
- **Everything after the receiver is simulated.** Query proposal, script source and run outcomes come from mock modules in `lib/server/`.
- **State lives in one JSON file**, `frontend/.data/db.json`, seeded on first use. No database, no in-memory singletons (they break under dev hot reload).
- **No timers or background workers.** A run is created with its schedule and outcome already decided (`startsAt`, `finishesAt`, `outcome`), and its status is computed from the clock when it is read. Workspace compilation works the same way (`compileReadyAt`).
- **The browser polls** the API every 2 seconds through one hook. No WebSocket or SSE in this build.
- **Allowed new dependencies:** `zod` (request validation), `lucide-react` (icons), and `vitest` as a dev dependency. Ask before adding anything else. All three are already installed (`@types/node` was raised to `^22` because `vitest` 5 requires it; the machine runs Node 22).
- **Deleting a workspace cascades.** It also deletes the workspace's script and that script's runs, and removes the script from every webhook's `scriptIds`. Past deliveries stay in the log.
- **Deleting a webhook** deletes its deliveries. Runs it produced stay, because they belong to the script's history.
- **Queries and frequency are frozen once a workspace is approved.** `PATCH` may still change the name; changing `queries` or `frequency` after approval is a 409.

## 5. This Next.js version — rules that will bite you

The app is Next.js 16.4.6 with React 19 and Tailwind 4. `frontend/AGENTS.md` says this version differs from what you remember; believe it. Before writing code, read the relevant pages under `frontend/node_modules/next/dist/docs/01-app/`, at least `01-getting-started/15-route-handlers.md` and `03-api-reference/03-file-conventions/dynamic-routes.md`.

`next.config.ts` has `cacheComponents: true`. Leave the config alone. Consequences, taken from the bundled docs:

- **Do not export `runtime`, `dynamic` or `revalidate`** from any route or page. They are unsupported or removed with Cache Components.
- **`params` is a Promise.** In route handlers, type the context with the global helper and await it:

  ```ts
  import { connection } from "next/server";

  export async function GET(_req: Request, ctx: RouteContext<"/api/scripts/[id]">) {
    await connection(); // marks this handler as request-time, never prerendered
    const { id } = await ctx.params;
    // ...
  }
  ```

  Start every `GET` handler with `await connection()`. `RouteContext` and `PageProps` only exist after types are generated by `next dev` or `next build`.
- **Pages do no data access on the server.** Each `page.tsx` is a thin server component that renders one client component. The client component fetches through `lib/api.ts`. This avoids the build errors Cache Components raises for `Date.now()`, `Math.random()` and uncached data in server components.
- **Dynamic pages need a Suspense boundary.** The intended pattern is below. It has not been build-tested yet; `npm run build` is the judge, and if it complains, follow its message and the dynamic-routes doc.

  ```tsx
  // app/scripts/[id]/page.tsx
  import { Suspense } from "react";
  import { PageSkeleton } from "@/components/ui/skeleton";
  import { ScriptDetail } from "./script-detail"; // "use client", reads the id with useParams()

  export default function Page() {
    return (
      <Suspense fallback={<PageSkeleton />}>
        <ScriptDetail />
      </Suspense>
    );
  }
  ```

  The same applies to any component that calls `useSearchParams()`.
- Routes you navigate away from stay mounted but hidden, so effects are cleaned up and re-run. The polling hook must stop on cleanup.
- Tailwind 4 is configured in CSS (`app/globals.css`, `@theme`), not in a `tailwind.config` file.

## 6. Architecture

```
Browser (client components)
   │  lib/api.ts — the only place that calls fetch()
   ▼
app/api/**/route.ts — thin: validate input, call lib/server, return JSON
   ▼
lib/server/* — domain logic and mocks (pure functions where possible)
   ▼
lib/server/store.ts — reads and writes .data/db.json
```

**The replacement boundary is `lib/api.ts` plus `lib/types.ts`.** When the real backend exists, the route handlers either proxy to it or disappear, and no page changes. So: pages never import from `lib/server/`, and never call `fetch` directly.

### 6.1 Directory layout

```
frontend/
  app/
    layout.tsx                 shell: sidebar + main area
    page.tsx                   Overview
    workspaces/                list, new/, [id]/
    scripts/                   list, [id]/
    webhooks/                  list, [id]/
    activity/                  all runs
    api/
      overview/route.ts
      workspaces/route.ts, [id]/route.ts, [id]/approve/route.ts
      scripts/route.ts, [id]/route.ts, [id]/deploy|deactivate|activate/route.ts
      runs/route.ts, [id]/route.ts
      webhooks/route.ts, [id]/route.ts, [id]/deliveries/route.ts, [id]/test/route.ts
      hooks/[id]/route.ts      the public receiver Telem posts to
      dev/reset/route.ts       wipe and reseed
  components/
    shell/                     sidebar, page header
    ui/                        button, badge, card, table, input, dialog, tabs, ...
    status/                    ScriptStatusBadge, RunStatusBadge, HealthDot
  lib/
    types.ts                   every type shared by client and server
    contracts.ts               the cross-team event shapes (section 6.3)
    api.ts                     typed client functions
    use-poll.ts                polling hook
    format.ts                  relative time, durations, byte sizes
    server/
      store.ts  seed.ts  ids.ts  clock.ts
      workspaces.ts  mock-compiler.ts
      scripts.ts  runtime.ts
      webhooks.ts  ingest.ts  verify.ts
      overview.ts
```

### 6.2 Data model (`lib/types.ts`)

All timestamps are ISO 8601 strings. IDs are a prefix plus 12 random characters: `ws_`, `scr_`, `wh_`, `dlv_`, `run_`.

`lib/types.ts` already exists and is the source of truth. Besides the types below it holds the request-body types (`CreateWorkspaceInput`, `UpdateWorkspaceInput`, `ApproveWorkspaceInput`, `CreateWebhookInput`, `UpdateWebhookInput`), `ApiError`, `ReceiveResult` and `StageKey`.

```ts
export type Frequency = "1h" | "6h" | "12h" | "1d" | "7d";
export type WorkspaceStatus = "compiling" | "awaiting_approval" | "ready";

export interface Workspace {
  id: string;
  name: string;                 // short label derived from the intent, editable
  intent: string;               // the user's sentence
  queries: { id: string; text: string }[];
  frequency: Frequency;
  escalationProviders: string[];            // e.g. ["brave", "exa", "tavily"]
  extractionSchema: Record<string, string>; // field name -> type description
  scriptId: string | null;      // set when queries are approved
  createdAt: string;
  compileReadyAt: string;       // before this moment the status reads "compiling"
  approvedAt: string | null;
}
export type WorkspaceView = Workspace & { status: WorkspaceStatus };

export type ScriptStatus = "developed" | "active" | "inactive";
export type ScriptActivity = "off" | "idle" | "processing" | "failing";

export interface Script {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  version: number;              // shown as "v3"
  status: ScriptStatus;
  source: string;               // script text, shown read-only
  extractionSchema: Record<string, string>;
  createdAt: string;
  deployedAt: string | null;    // first deployment; null means never deployed
  statusChangedAt: string;
}
export type ScriptView = Script & {
  workspaceName: string;
  activity: ScriptActivity;
  runsInFlight: number;
  runsLast24h: number;
  failureRate: number | null;   // over the last 10 finished runs, 0..1
  lastRunAt: string | null;
  webhookIds: string[];         // webhooks that route to this script
};

export interface Webhook {
  id: string;
  name: string;
  secret: string;               // given to Telem as the webhook secret
  enabled: boolean;
  scriptIds: string[];          // routing targets; may be empty
  createdAt: string;
}
export type WebhookView = Webhook & {
  url: string;                  // PUBLIC_BASE_URL (or request origin) + /api/hooks/{id}
  deliveryCount: number;
  lastDeliveryAt: string | null;
};

export type WebhookType = "agent.changes" | "vendor.items" | "unknown";

export interface Delivery {
  id: string;
  webhookId: string;
  receivedAt: string;
  webhookType: WebhookType;     // from the Telem-Webhook-Type request header
  signature: "not_checked" | "valid" | "invalid";
  isTest: boolean;              // sent by the in-app test button
  bodyBytes: number;
  body: unknown;                // parsed JSON, or the raw string if not JSON
  eventCount: number;
  duplicateCount: number;       // events dropped because their seq was already seen
  runIds: string[];
  skipped: { scriptId: string; reason: "script_not_active" }[];
}

export type RunStatus = "queued" | "running" | "succeeded" | "invalid" | "failed";

export interface Run {
  id: string;
  scriptId: string;
  webhookId: string;
  deliveryId: string;
  event: ChangeEvent;           // see contracts.ts
  queuedAt: string;
  startsAt: string;
  finishesAt: string;
  outcome: "succeeded" | "invalid" | "failed";   // decided at creation, hidden until finished
  result: ProcessedResult | null;                // only for "succeeded"
  error: string | null;                          // for "invalid" and "failed"
}
// What the API returns: status derived from the clock; result and error are null until finished.
export type RunView = Omit<Run, "outcome"> & {
  status: RunStatus;
  durationMs: number | null;
  scriptName: string;
};

export type Health = "ok" | "busy" | "attention" | "idle";

export interface Overview {
  health: Health;               // worst of the stage healths
  stages: {
    key: "ingest" | "dispatch" | "processing" | "results";
    label: string;
    health: Health;
    metrics: { label: string; value: string }[];
  }[];
  scriptCounts: Record<ScriptStatus, number>;
  runsInFlight: RunView[];      // queued or running, newest first
  recentDeliveries: Delivery[]; // last 10
  recentProblems: RunView[];    // last 10 failed or invalid
}
```

### 6.3 Cross-team contracts (`lib/contracts.ts`)

These two shapes are agreed with the backend teams. Keep the field names exactly as written, including snake_case.

```ts
// What the ingest step hands to a script.
export interface ChangeEvent {
  workspace_id: string;
  seq: number;                  // monotonic per source; used to drop duplicates
  kind: "entity_added" | "value_changed" | "alert";
  url: string;
  page_text: string;
  telem_run_id: string;
  received_at: string;
}

// What a script emits when its output matched the schema.
export interface ProcessedResult {
  workspace_id: string;
  seq: number;
  extracted: Record<string, unknown>;   // matches the script's extractionSchema
  confidence: number;                   // 0..1
  dedupe_key: string;
  raw_ref: string;
  pipeline_version: string;             // e.g. "v3"
}
```

### 6.4 Server modules (`lib/server/`)

- **`store.ts`** — `read(): Promise<Db>` and `mutate(fn: (db: Db) => T): Promise<T>`. `Db` holds five arrays: workspaces, scripts, webhooks, deliveries, runs. Writes go to a temp file and are renamed into place. Mutations are queued one at a time through a promise chain kept on `globalThis`. If the file is missing, seed it. Cap deliveries and runs at the newest 500 each.
- **`clock.ts`** — `now(): Date`, replaceable in tests. All server code gets the time from here.
- **`seed.ts`** — builds a believable starting state relative to the current time: 2 workspaces, 4 scripts (2 active, 1 inactive, 1 developed), 2 webhooks, about 15 deliveries and 30 finished runs spread over the last day, including a few `failed` and `invalid`.
- **`mock-compiler.ts`** — `proposeQueries(intent)` returns 3 to 5 queries built from templates around the intent's main subject; `buildScript(workspace)` returns a `developed` script with canned source text and the workspace's schema. Compilation "takes" 4 seconds via `compileReadyAt`.
- **`workspaces.ts`** — create, list, update, delete, approve. Approving saves the final queries, creates the script, and sets `scriptId` and `approvedAt`. Status is derived: `compiling` until `compileReadyAt`, then `awaiting_approval`, then `ready` once approved.
- **`scripts.ts`** — list and get as `ScriptView`, plus `deploy`, `deactivate`, `activate` enforcing the transitions in section 3.
- **`runtime.ts`** — `createRun(script, event, delivery)` picks a queue delay of 0.5–2 s, a duration of 2–6 s and an outcome (about 85% succeeded, 10% invalid, 5% failed), and builds the fake `ProcessedResult` or error message. `toRunView(run)` derives the status from the clock. Takes an injectable random source so tests are deterministic.
- **`ingest.ts`** — `receive(webhookId, headers, rawBody, { isTest })`:
  1. Record a `Delivery`. Read `Telem-Webhook-Type` to set `webhookType`.
  2. Turn the body into events. For `agent.changes` the documented envelope is `{ type, monitor_id, changes[], next_cursor, watermark }`; make one event per item in `changes`, reading `seq`, `kind` and `url` where present. For anything else (including `vendor.items`, whose shape is not documented), treat the whole body as a single event. Never reject a body for having an unexpected shape.
  3. Drop events whose `seq` this webhook has already seen (Telem delivers at least once) and count them in `duplicateCount`.
  4. For each remaining event and each script in the webhook's `scriptIds`: if the script is `active`, create a run; otherwise add an entry to `skipped`.

  An event with no numeric `seq` is never a duplicate. `ChangeEvent.workspace_id` is the target script's `workspaceId`. Fields the body does not supply (`kind`, `url`, `page_text`, `telem_run_id`) get harmless defaults.
- **`verify.ts`** — `verifySignature(secret, headers, rawBody)`. **Currently always returns `"not_checked"`.** The name of Telem's signature header and its algorithm are not known to us yet; do not guess them. Leave a clear comment and keep the function isolated so it is a one-file change later.
- **`errors.ts`** — a `DomainError` class carrying an HTTP status (400, 403, 404, 409 or 413) and a message. Server modules throw it; route handlers turn it into `{ "error": message }` with that status.
- **`overview.ts`** — builds `Overview`. Stage health: `attention` if the stage saw failures in the last hour (results: any `failed` or `invalid`; ingest: any `invalid` signature), `busy` if it has work in flight, `idle` if nothing happened in the last hour, otherwise `ok`.

### 6.5 HTTP API

All bodies are JSON. Errors are `{ "error": "message" }` with 400 (bad input), 404 (unknown id) or 409 (illegal state change). Validate request bodies with `zod`.

| Method and path | Purpose |
|---|---|
| `GET /api/overview` | `Overview` |
| `GET /api/workspaces` · `POST /api/workspaces` `{ intent }` | list · create (starts "compiling") |
| `GET` · `PATCH` · `DELETE /api/workspaces/{id}` | read · edit name, queries, frequency · delete |
| `POST /api/workspaces/{id}/approve` `{ queries: string[] }` | approve; creates the `developed` script |
| `GET /api/scripts?status=` · `GET /api/scripts/{id}` | `ScriptView[]` · `ScriptView` |
| `POST /api/scripts/{id}/deploy` · `/deactivate` · `/activate` | status changes |
| `GET /api/runs?scriptId=&status=&deliveryId=&limit=` · `GET /api/runs/{id}` | `RunView[]` (newest first, default 50, at most 200) · `RunView` |
| `GET /api/webhooks` · `POST /api/webhooks` `{ name, scriptIds }` | list · create (generates the secret) |
| `GET` · `PATCH` · `DELETE /api/webhooks/{id}` | read · edit name, enabled, scriptIds · delete |
| `GET /api/webhooks/{id}/deliveries?limit=` | `Delivery[]`, newest first |
| `POST /api/webhooks/{id}/test` | builds a sample `agent.changes` payload with fresh `seq` values and passes it through `ingest.receive` |
| `POST /api/hooks/{id}` | **the receiver.** 200 `{ ok: true, delivery_id }`; 404 unknown webhook; 403 webhook disabled; 413 body over 1 MB. Reads the raw body as text first, then tries to parse it. |
| `POST /api/dev/reset` | wipe and reseed |

Response bodies, where the table does not already say:

| Request | Success response |
|---|---|
| `POST /api/workspaces` | 201 `WorkspaceView` |
| `GET` · `PATCH /api/workspaces/{id}` | `WorkspaceView` |
| `POST /api/workspaces/{id}/approve` | `WorkspaceView` with `scriptId` set. 409 while still compiling or if already approved; 400 if `queries` is empty. |
| `POST /api/scripts/{id}/deploy` · `/deactivate` · `/activate` | the updated `ScriptView` |
| `POST /api/webhooks` | 201 `WebhookView`. 400 if `scriptIds` names an unknown script. |
| `GET` · `PATCH /api/webhooks/{id}` | `WebhookView` |
| `POST /api/webhooks/{id}/test` | the `Delivery` it created. 403 if the webhook is disabled. |
| every `DELETE`, and `POST /api/dev/reset` | `{ "ok": true }` |

An unknown value in a query-string filter (for example `?status=bogus`) is a 400.

## 7. Screens

Sidebar navigation, in this order: **Overview, Workspaces, Scripts, Webhooks, Activity**. Every list polls every 2 seconds and has loading, empty and error states.

- **Overview (`/`)** — the main page. Top: the pipeline as four connected stages (Ingest → Dispatch → Processing → Results), each with a health indicator and two or three numbers. Below: counts of scripts by status (each count links to the filtered Scripts list), runs currently in flight, recent deliveries, recent problems.
- **Workspaces (`/workspaces`)** — list with status. **New (`/workspaces/new`)**: one large text box for the sentence and a submit button. After submit, go to the workspace page.
- **Workspace (`/workspaces/{id}`)** — while compiling, a progress state. When awaiting approval: the proposed queries as an editable list (edit, remove, add), the frequency picker, the output schema read-only, and an **Approve** button. Once ready: the final queries and a link to the script that was created, with its status.
- **Scripts (`/scripts`)** — table: name, workspace, status badge, activity, runs in the last 24 h, failure rate, last run. Filter tabs: All, Active, Inactive, Developed, kept in the `?status=` query string.
- **Script (`/scripts/{id}`)** — status with the one action that applies (Deploy, Deactivate or Reactivate, each behind a confirmation), activity, the script source in a read-only code block, the output schema, the webhooks that feed it, and its recent runs. A `developed` script shows a short note explaining that it has never been deployed and receives nothing.
- **Webhooks (`/webhooks`)** — list: name, enabled, target scripts, deliveries, last received. A **New webhook** dialog asks for a name and target scripts.
- **Webhook (`/webhooks/{id}`)** — the URL with a copy button, the secret (hidden until revealed, with copy), an enabled toggle, the routing editor (multi-select of scripts, showing each script's status; warn when a target is not active because its events will be skipped), a **Send test event** button, and the delivery log. Expanding a delivery shows its type, signature state, event and duplicate counts, the runs it created, what was skipped and why, and the raw body.
- **Activity (`/activity`)** — every run, newest first, filterable by script and status. Expanding a run shows the event, timings, and the result or error.

**Status presentation:** a status is always a text label with a colour, never colour alone. Script status: `active` green, `inactive` neutral grey, `developed` blue. Run status: `queued` grey, `running` blue, `succeeded` green, `invalid` amber, `failed` red. Define these once as tokens in `app/globals.css` and use them only through the components in `components/status/`.

## 8. Rules for every agent

- Work only inside `frontend/`. Never push, and never touch `main`. **Commit your work as each package is finished** (the user asked for this), once the checks below pass.
- **Other agents are working at the same time.** The frontend agent works in the main checkout on the `frontend` branch and has the dev server on port 3000. Backend agents work in a separate git worktree on the `frontend-be` branch (see section 9), so nobody's half-written files break anybody else's checks. If you start a dev server in a worktree, use another port: `npx next dev -p 3100`.
- Stage only paths your package owns (`git add <paths>`, never `git add -A`).
- Never commit `.data/`, `.env*` or `mvp_idea.txt`.
- Stay inside the files your work package owns. If you need a change in a shared file (`lib/types.ts`, `lib/api.ts`, `components/ui/`), make the smallest addition and say so in your report.
- Do not change the types in sections 6.2 and 6.3 or the paths in 6.5 without flagging it; other packages are written against them.
- Before reporting done, run all four from `frontend/` and include the real output if any fail: `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`. An error in a file you do not own is not yours to fix: report it.
- Report what you built, what you could not verify, and anything in this plan that turned out to be wrong.

## 9. Work packages

The work is split by layer, not by screen. The backend packages need no design judgement and go to separate agents. One frontend agent owns everything the user sees.

```
Foundation (done) ──► BE1 ─┐
                 ├──► BE2 ─┼──► INT
                 └──► FE ──┘
```

### Foundation — done

Already committed on `frontend`: the three dependencies, the `test` script, `vitest.config.ts` (with the `@/` alias), `/.data/` in `.gitignore`, `lib/types.ts` and `lib/contracts.ts`. Do not redo it.

### How to launch a backend agent

From the repository root, once:

```bash
git worktree add ../searchHack-be -b frontend-be frontend
cd ../searchHack-be/frontend && npm ci
```

Start each backend agent in `../searchHack-be/frontend` and tell it: "Read `PLAN.md`, then do BE1" (or BE2). When they have committed, the frontend agent merges `frontend-be` into `frontend`. The paths do not overlap, so the merge is clean.

**BE1 and BE2 run at the same time, in that one worktree, as two agents.** They own different directories and meet at the signatures listed under BE1. Until BE1's modules exist, BE2's type check will report missing imports from `lib/server`; that is expected, and BE2 finishes its checks once BE1 has committed. Neither agent edits the other's files: if a signature is wrong or missing, say so in your report and work to the listed one.

### BE1 — Server core (backend agent)

Owns: `lib/server/**`, including its `*.test.ts` files. Nothing else.

1. Write every module in 6.4, following the decisions in section 4.
2. Write unit tests for: status transitions (legal and illegal), run status derived at different clock times, ingest (an `agent.changes` body, an unknown body, a duplicate `seq`, a non-active target), workspace status derivation, and the workspace-delete cascade.
3. **Export exactly this surface.** BE2 is written at the same time by another agent, against these signatures, so they are fixed. Every function throws `DomainError` for 404 and 409 cases rather than returning `null`. Anything else you export is your own business.

   ```ts
   // store.ts
   export interface Db { workspaces: Workspace[]; scripts: Script[]; webhooks: Webhook[]; deliveries: Delivery[]; runs: Run[] }
   export function read(): Promise<Db>;
   export function mutate<T>(fn: (db: Db) => T): Promise<T>;
   export function reset(): Promise<void>;                      // wipe and reseed

   // clock.ts
   export function now(): Date;
   export function setNow(date: Date | null): void;             // tests only; null restores the real clock

   // ids.ts
   export function newId(prefix: "ws" | "scr" | "wh" | "dlv" | "run" | "q"): string;

   // errors.ts
   export class DomainError extends Error {
     readonly status: 400 | 403 | 404 | 409 | 413;
     constructor(status: 400 | 403 | 404 | 409 | 413, message: string);
   }

   // workspaces.ts
   export function listWorkspaces(): Promise<WorkspaceView[]>;  // newest first
   export function getWorkspace(id: string): Promise<WorkspaceView>;
   export function createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceView>;
   export function updateWorkspace(id: string, input: UpdateWorkspaceInput): Promise<WorkspaceView>;
   export function deleteWorkspace(id: string): Promise<void>;
   export function approveWorkspace(id: string, input: ApproveWorkspaceInput): Promise<WorkspaceView>;

   // scripts.ts
   export function listScripts(filter?: { status?: ScriptStatus }): Promise<ScriptView[]>;
   export function getScript(id: string): Promise<ScriptView>;
   export function deployScript(id: string): Promise<ScriptView>;
   export function deactivateScript(id: string): Promise<ScriptView>;
   export function activateScript(id: string): Promise<ScriptView>;

   // runtime.ts (createRun and toRunView are internal to lib/server; shape them as you like)
   export function listRuns(filter?: { scriptId?: string; status?: RunStatus; deliveryId?: string; limit?: number }): Promise<RunView[]>;
   export function getRun(id: string): Promise<RunView>;

   // webhooks.ts (baseUrl has no trailing slash, e.g. "http://localhost:3000")
   export function listWebhooks(baseUrl: string): Promise<WebhookView[]>;
   export function getWebhook(id: string, baseUrl: string): Promise<WebhookView>;
   export function createWebhook(input: CreateWebhookInput, baseUrl: string): Promise<WebhookView>;
   export function updateWebhook(id: string, input: UpdateWebhookInput, baseUrl: string): Promise<WebhookView>;
   export function deleteWebhook(id: string): Promise<void>;
   export function listDeliveries(webhookId: string, limit?: number): Promise<Delivery[]>;  // default 50
   export function sendTestEvent(webhookId: string): Promise<Delivery>;

   // ingest.ts (throws 404 for an unknown webhook, 403 for a disabled one)
   export function receive(webhookId: string, headers: Headers, rawBody: string, options?: { isTest?: boolean }): Promise<Delivery>;

   // overview.ts
   export function getOverview(): Promise<Overview>;
   ```

Done when: `npm test`, `npx tsc --noEmit` and `npm run lint` pass, and the work is committed on `frontend-be`.

### BE2 — HTTP API (backend agent, alongside BE1)

Owns: `app/api/**`. Shared route helpers (error mapping, body parsing) go in `app/api/_lib/`; a folder starting with an underscore is not routed.

Import from `lib/server` using the signatures listed under BE1. Check the 1 MB limit in the receiver route itself, before calling `receive`.

Write one route handler per row of 6.5, obeying section 5: no `runtime`, `dynamic` or `revalidate` exports; `await connection()` first in every `GET`; `await ctx.params`. Handlers stay thin: validate with `zod`, call `lib/server`, return JSON. `WebhookView.url` uses `PUBLIC_BASE_URL` when set, otherwise the request's origin.

Done when all of these hold against a running server (`npx next dev -p 3100`), and `npm run build` passes:

- `curl -X POST localhost:3100/api/dev/reset` creates `.data/db.json`, and every `GET` in 6.5 returns seeded data.
- Deploy, deactivate and activate work; an illegal transition returns 409; an unknown id returns 404.
- Creating a workspace returns `compiling`, and reading it about 4 seconds later returns `awaiting_approval` with proposed queries; approving creates a `developed` script.
- A webhook can be created, edited, disabled and deleted. The test route produces a delivery and runs.
- A POST of arbitrary JSON to the receiver returns 200 and is logged as one event; posting the same `seq` twice records a duplicate; routing to a non-active script records a skip with its reason; a disabled webhook returns 403; a body over 1 MB returns 413.
- Runs move from `queued` to `running` to a final state when read repeatedly.

### FE — Frontend (frontend agent; owns design)

Owns: `lib/api.ts`, `lib/use-poll.ts`, `lib/format.ts`, `components/**`, `app/layout.tsx`, `app/globals.css`, and every page and client component under `app/` outside `app/api/`.

1. `lib/api.ts` (one typed function per row of 6.5), `lib/use-poll.ts` (`usePoll(fetcher, intervalMs = 2000)` returning `{ data, error, loading, refresh }`, paused while the tab is hidden, stopped on cleanup) and `lib/format.ts`.
2. The shell (sidebar, page header), the `components/ui/` primitives and the `components/status/` badges. Colour tokens, the page title ("Sentinel"), and removal of the create-next-app starter content.
3. Every screen in section 7.
4. The refinement work in section 10, done as part of the build rather than as a later pass.

Done when each screen meets its description in section 7 against the real API from BE2.

### INT — Integration pass (frontend agent, after BE2 is merged)

Walk the full story in a real browser and fix what breaks:

1. Reset data. Create a workspace from a sentence and approve its queries.
2. Find the new script, shown as Developed. Deploy it; it becomes Active.
3. Create a webhook routed to that script. Send a test event.
4. Watch the delivery appear, the run finish, and the Overview update.
5. Deactivate the script; it becomes Inactive. Send another test event; it is skipped with a reason.
6. Delete the workspace; its script and runs disappear and the webhook's routing no longer lists it.

Then replace `frontend/README.md` with how to run the app, how to set `PUBLIC_BASE_URL` and a tunnel, and a `curl` example for the receiver.

## 10. Refinement (part of the FE package)

The frontend agent owns visual design and feel: typography, spacing, colour, the look of the pipeline diagram on the Overview, motion for status changes, responsive layout, keyboard and screen-reader access, and the wording of empty and error states.

It may restructure anything in `components/` and the page components. It should not change `lib/types.ts`, `lib/contracts.ts`, the API paths, or the status definitions in section 3 without the user's agreement, since the backend teams will build against them.

## 11. Known gaps and assumptions

- **Signature verification is not implemented.** Deliveries are accepted without checking and marked `not_checked`. Needs Telem's signature header name and algorithm.
- **The `vendor.items` payload shape is unknown.** It is stored raw and counted as one event until a real delivery has been captured.
- **The `agent.changes` item fields are partly assumed.** Only the envelope is documented to us; `seq`, `kind` and `url` on each change are read defensively.
- **The contract shapes in 6.3 are copied by hand.** When the shared contracts package exists, import from it instead.
- **The receiver may move.** The wider design assigns the webhook receiver to the backend ingest team. It lives here for now so the frontend can be demonstrated on its own.
- **The dynamic-page pattern in section 5 has not been build-tested.**
