// The run log and the queue that works through it.
//
// A run is one job for the Sentinel runtime: take a page through a
// workspace's pipeline (fetch it, run process.py, let the delivery agent act
// on the result), or collect (ask Telem what is new and run each new page).
// The runtime does this inside one long HTTP request, so runs are recorded
// here as "queued" and worked through one at a time, after the request that
// created them has been answered.
//
// The drain loop lives on globalThis so that a dev-server reload does not
// start a second one beside it.

import * as runtime from "@/lib/backend/runtime";
import type { RawCollectResult, RawPipelineResult, RawWorkspace } from "@/lib/backend/runtime";
import type { PageOutcome, PageResult, Run, RunSource, RunStatus, RunView, RunUrlInput } from "@/lib/types";
import { now } from "./clock";
import { DomainError, notFound } from "./errors";
import { newId } from "./ids";
import { mutate, read, type Db } from "./store";
import { ms, newestFirst } from "./util";

export const RUN_STATUSES: readonly RunStatus[] = ["queued", "running", "delivered", "dropped", "unchanged", "failed"];
export const DEFAULT_RUN_LIMIT = 50;
export const MAX_RUN_LIMIT = 200;
export const MAX_URL_LENGTH = 2000;

export function isFinished(status: RunStatus): boolean {
  return status !== "queued" && status !== "running";
}

// -------------------------------------------------------------------- Views

export function toRunView(run: Run): RunView {
  return {
    ...run,
    durationMs: run.startedAt && run.finishedAt ? ms(run.finishedAt) - ms(run.startedAt) : null,
  };
}

export interface RunFilter {
  scriptId?: string;
  status?: RunStatus;
  deliveryId?: string;
  limit?: number;
}

/** Newest first. Default 50, at most 200. */
export async function listRuns(filter: RunFilter = {}): Promise<RunView[]> {
  if (filter.status !== undefined && !RUN_STATUSES.includes(filter.status)) {
    throw new DomainError(400, `Unknown run status "${String(filter.status)}".`);
  }
  const take = checkLimit(filter.limit, DEFAULT_RUN_LIMIT, MAX_RUN_LIMIT);
  const db = await settled();
  return newestFirst(db.runs, (r) => r.queuedAt)
    .filter((r) => filter.scriptId === undefined || r.scriptId === filter.scriptId)
    .filter((r) => filter.status === undefined || r.status === filter.status)
    .filter((r) => filter.deliveryId === undefined || r.deliveryId === filter.deliveryId)
    .slice(0, take)
    .map(toRunView);
}

export async function getRun(id: string): Promise<RunView> {
  const db = await settled();
  const run = db.runs.find((r) => r.id === id);
  if (!run) throw notFound("run", id);
  return toRunView(run);
}

/** A whole number from 1 to `max`; `fallback` when absent. */
export function checkLimit(limit: number | undefined, fallback: number, max: number): number {
  if (limit === undefined) return fallback;
  if (!Number.isInteger(limit) || limit < 1) throw new DomainError(400, "limit must be a whole number, 1 or more.");
  return Math.min(limit, max);
}

// ----------------------------------------------------------------- Queueing

export interface NewRun {
  scriptId: string;
  scriptName: string;
  source: RunSource;
  url: string | null;
  webhookId?: string | null;
  deliveryId?: string | null;
}

/** Adds a queued run inside an open mutation. Call `drainRuns()` once the mutation is saved. */
export function queueRun(db: Db, input: NewRun, at: Date = now()): Run {
  const run: Run = {
    id: newId("run"),
    scriptId: input.scriptId,
    scriptName: input.scriptName,
    source: input.source,
    webhookId: input.webhookId ?? null,
    deliveryId: input.deliveryId ?? null,
    url: input.url,
    queuedAt: at.toISOString(),
    startedAt: null,
    finishedAt: null,
    status: "queued",
    summary: null,
    error: null,
    pages: [],
  };
  db.runs.push(run);
  return run;
}

/** An http(s) address, trimmed. 400 otherwise. */
export function checkUrl(raw: unknown): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text === "") throw new DomainError(400, "Give the address of a page to run.");
  if (text.length > MAX_URL_LENGTH) throw new DomainError(400, "That address is too long.");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new DomainError(400, "That is not a web address. It should start with http:// or https://.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new DomainError(400, "Only http:// and https:// addresses can be run.");
  }
  return url.toString();
}

/** Queues one page for a script, whatever its switch says: this is how a script is tried before deploying it. */
export async function startManualRun(raw: RawWorkspace, scriptName: string, input: RunUrlInput): Promise<RunView> {
  const url = checkUrl(input?.url);
  const run = await mutate((db) => queueRun(db, { scriptId: raw.id, scriptName, source: "manual", url }));
  return toRunView(run);
}

/** Queues a collect. Only an active script collects, and only one collect at a time. */
export async function startCollect(raw: RawWorkspace, scriptName: string): Promise<RunView> {
  const run = await mutate((db) => {
    const record = db.scripts.find((s) => s.id === raw.id);
    if (record?.status !== "active") {
      throw new DomainError(409, "Only an active script collects. Deploy or reactivate it first.");
    }
    const pending = db.runs.some((r) => r.scriptId === raw.id && r.source === "collect" && !isFinished(r.status));
    if (pending) throw new DomainError(409, "A collect for this script is already waiting or running.");
    return queueRun(db, { scriptId: raw.id, scriptName, source: "collect", url: null });
  });
  return toRunView(run);
}

// ----------------------------------------------------------------- Draining

const DRAIN_KEY = "__sentinelRunDrain";
type DrainHolder = { [DRAIN_KEY]?: Promise<void> };

function isDraining(): boolean {
  return (globalThis as DrainHolder)[DRAIN_KEY] !== undefined;
}

/**
 * Works through the queued runs, oldest first, one at a time. Calling it
 * while it is already going returns the same promise. It never rejects.
 */
export function drainRuns(): Promise<void> {
  const holder = globalThis as DrainHolder;
  if (!holder[DRAIN_KEY]) {
    holder[DRAIN_KEY] = drainLoop()
      .catch((error) => console.error("[runs] the run queue stopped:", error))
      .finally(() => {
        holder[DRAIN_KEY] = undefined;
      });
  }
  return holder[DRAIN_KEY];
}

async function drainLoop(): Promise<void> {
  for (;;) {
    const next = await mutate((db) => {
      const queued = db.runs.filter((r) => r.status === "queued").sort((a, b) => ms(a.queuedAt) - ms(b.queuedAt))[0];
      if (!queued) return null;
      queued.status = "running";
      queued.startedAt = now().toISOString();
      return { ...queued };
    });
    if (!next) return;
    const outcome = await execute(next);
    await mutate((db) => {
      const run = db.runs.find((r) => r.id === next.id);
      if (run) Object.assign(run, outcome, { finishedAt: now().toISOString() });
    });
  }
}

const INTERRUPTED = "The server restarted while this run was in progress, so its result is not known.";

/**
 * The store with loose ends tied up: a run still marked "running" when no
 * drain loop is going was cut off by a restart, so it is closed as failed;
 * and runs left queued by a restart are picked up again.
 */
async function settled(): Promise<Db> {
  const db = await read();
  if (isDraining()) return db;
  if (!db.runs.some((r) => !isFinished(r.status))) return db;
  const fixed = await mutate((current) => {
    if (isDraining()) return current;
    const at = now().toISOString();
    for (const run of current.runs) {
      if (run.status === "running") Object.assign(run, { status: "failed", error: INTERRUPTED, finishedAt: at });
    }
    return current;
  });
  if (fixed.runs.some((r) => r.status === "queued")) void drainRuns();
  return fixed;
}

/** The same tidy-up, for callers that only need it done. */
export async function settleRuns(): Promise<void> {
  await settled();
}

// ---------------------------------------------------------------- Executing

type Finish = Pick<Run, "status" | "summary" | "error" | "pages">;

async function execute(run: Run): Promise<Finish> {
  try {
    if (run.source === "collect") return finishCollect(await runtime.collect(run.scriptId));
    if (!run.url) return failed("This run has no page address.");
    return finishPage(await runtime.runUrl(run.scriptId, run.url), run.url);
  } catch (error) {
    return failed(error instanceof Error && error.message ? error.message : "The run could not be completed.");
  }
}

function failed(error: string): Finish {
  return { status: "failed", summary: null, error, pages: [] };
}

/** Reads the runtime's account of one page. */
export function toPageResult(raw: RawPipelineResult, fallbackUrl: string): PageResult {
  const output = raw.process?.output;
  let outcome: PageOutcome;
  let reason: string | null = null;

  if (raw.ok === false || raw.error) {
    outcome = "failed";
    reason = raw.error ?? raw.process?.error ?? "The runtime could not process this page.";
  } else if (raw.dropped) {
    outcome = "dropped";
    reason = raw.reason ?? null;
  } else if (raw.unchanged) {
    outcome = "unchanged";
    reason = "The page reads the same as the last time it ran, so nothing was sent.";
  } else if (raw.delivery?.ok) {
    outcome = "delivered";
  } else {
    outcome = "failed";
    reason = raw.delivery
      ? "The delivery agent did not finish, so the result was not recorded."
      : "The runtime did not report a delivery.";
  }

  return {
    url: raw.url ?? fallbackUrl,
    title: raw.page?.title ?? null,
    outcome,
    reason,
    processed: typeof output?.processed === "string" ? output.processed : null,
    data: output?.data && typeof output.data === "object" ? output.data : null,
    agentReply: raw.delivery?.reply ? raw.delivery.reply : null,
  };
}

const PAGE_SUMMARY: Record<PageOutcome, string> = {
  delivered: "The delivery agent recorded the result.",
  dropped: "The script judged the page not relevant.",
  unchanged: "Nothing changed since the last run of this page.",
  failed: "The page could not be processed.",
};

export function finishPage(raw: RawPipelineResult, url: string): Finish {
  const page = toPageResult(raw, url);
  return {
    status: page.outcome,
    summary: PAGE_SUMMARY[page.outcome],
    error: page.outcome === "failed" ? page.reason : null,
    pages: [page],
  };
}

export function finishCollect(raw: RawCollectResult): Finish {
  const pages = (raw.results ?? []).map((result) => toPageResult(result, result.url ?? ""));
  const count = (outcome: PageOutcome) => pages.filter((p) => p.outcome === outcome).length;
  const found = typeof raw.new_items === "number" ? raw.new_items : pages.length;
  const via = raw.source === "escalation" ? " (the monitor had nothing, so a wider search was run)" : "";

  if (pages.length === 0) {
    return { status: "unchanged", summary: `Telem reported nothing new${via}.`, error: null, pages };
  }

  const parts = (["delivered", "dropped", "unchanged", "failed"] as const)
    .filter((outcome) => count(outcome) > 0)
    .map((outcome) => `${count(outcome)} ${outcome}`);
  const summary = `${found} new ${found === 1 ? "page" : "pages"}${via}; ${pages.length} run: ${parts.join(", ")}.`;

  const status: RunStatus =
    count("delivered") > 0 ? "delivered" : count("failed") === pages.length ? "failed" : count("dropped") > 0 ? "dropped" : "unchanged";
  return {
    status,
    summary,
    error: status === "failed" ? (pages.find((p) => p.reason)?.reason ?? "Every page failed.") : null,
    pages,
  };
}
