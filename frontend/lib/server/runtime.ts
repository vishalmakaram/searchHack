// The simulated script runtime.
//
// There are no timers or workers. A run is created with its whole future
// already decided (queue delay, duration, outcome and output), and its status
// is worked out from the clock whenever it is read.

import { createHash } from "node:crypto";
import type { ChangeEvent, ProcessedResult } from "@/lib/contracts";
import type { Delivery, Run, RunStatus, RunView, Script } from "@/lib/types";
import { now } from "./clock";
import { DomainError, notFound } from "./errors";
import { newId } from "./ids";
import { read, type Db } from "./store";
import { cleanText, ms, newestFirst, pick } from "./util";

export type Random = () => number;
export type RunOutcome = Run["outcome"];

export const RUN_STATUSES: readonly RunStatus[] = ["queued", "running", "succeeded", "invalid", "failed"];
export const QUEUE_DELAY_MS = { min: 500, max: 2000 } as const;
export const DURATION_MS = { min: 2000, max: 6000 } as const;
/** Cumulative odds: below 0.85 succeeded, below 0.95 invalid, otherwise failed. */
export const OUTCOME_THRESHOLDS = { succeeded: 0.85, invalid: 0.95 } as const;

export const DEFAULT_RUN_LIMIT = 50;
export const MAX_RUN_LIMIT = 200;

// ------------------------------------------------------------ Creating runs

export interface CreateRunOptions {
  /** Defaults to Math.random. Pass a fixed source in tests. */
  random?: Random;
  /** When the run is queued. Defaults to now(). */
  at?: Date;
  /** Force the outcome (the seed uses this). Still consumes the same randomness. */
  outcome?: RunOutcome;
}

export function createRun(
  script: Script,
  event: ChangeEvent,
  delivery: Pick<Delivery, "id" | "webhookId">,
  options: CreateRunOptions = {},
): Run {
  const random = options.random ?? Math.random;
  const queuedAt = (options.at ?? now()).getTime();
  const startsAt = queuedAt + between(random, QUEUE_DELAY_MS.min, QUEUE_DELAY_MS.max);
  const finishesAt = startsAt + between(random, DURATION_MS.min, DURATION_MS.max);
  const roll = random();
  const outcome: RunOutcome =
    options.outcome ??
    (roll < OUTCOME_THRESHOLDS.succeeded ? "succeeded" : roll < OUTCOME_THRESHOLDS.invalid ? "invalid" : "failed");

  // The event a script sees always carries the script's own workspace.
  const scoped: ChangeEvent = { ...event, workspace_id: script.workspaceId };

  return {
    id: newId("run"),
    scriptId: script.id,
    webhookId: delivery.webhookId,
    deliveryId: delivery.id,
    event: scoped,
    queuedAt: new Date(queuedAt).toISOString(),
    startsAt: new Date(startsAt).toISOString(),
    finishesAt: new Date(finishesAt).toISOString(),
    outcome,
    result: outcome === "succeeded" ? buildResult(script, scoped, delivery.id, random) : null,
    error: outcome === "succeeded" ? null : buildError(script, outcome, random),
  };
}

// ------------------------------------------------------------ Reading runs

export function runStatusAt(run: Run, at: Date): RunStatus {
  const t = at.getTime();
  if (t < ms(run.startsAt)) return "queued";
  if (t < ms(run.finishesAt)) return "running";
  return run.outcome;
}

export function isFinished(status: RunStatus): boolean {
  return status === "succeeded" || status === "invalid" || status === "failed";
}

export function isProblem(status: RunStatus): boolean {
  return status === "invalid" || status === "failed";
}

/** What the API shows: the outcome stays hidden, and result and error stay null, until the run finishes. */
export function toRunView(run: Run, scriptName: string, at: Date = now()): RunView {
  const status = runStatusAt(run, at);
  const finished = isFinished(status);
  return {
    id: run.id,
    scriptId: run.scriptId,
    webhookId: run.webhookId,
    deliveryId: run.deliveryId,
    event: run.event,
    queuedAt: run.queuedAt,
    startsAt: run.startsAt,
    finishesAt: run.finishesAt,
    result: finished ? run.result : null,
    error: finished ? run.error : null,
    status,
    durationMs: finished ? ms(run.finishesAt) - ms(run.startsAt) : null,
    scriptName,
  };
}

/** Every run in `db` as a view, newest first. */
export function runViews(db: Db, at: Date = now()): RunView[] {
  const names = new Map(db.scripts.map((s) => [s.id, s.name]));
  return newestFirst(db.runs, (r) => r.queuedAt).map((run) =>
    toRunView(run, names.get(run.scriptId) ?? "Deleted script", at),
  );
}

export interface RunFilter {
  scriptId?: string;
  status?: RunStatus;
  deliveryId?: string;
  limit?: number;
}

export async function listRuns(filter: RunFilter = {}): Promise<RunView[]> {
  if (filter.status !== undefined && !RUN_STATUSES.includes(filter.status)) {
    throw new DomainError(400, `Unknown run status "${String(filter.status)}".`);
  }
  const limit = checkLimit(filter.limit, DEFAULT_RUN_LIMIT, MAX_RUN_LIMIT);
  const db = await read();
  return runViews(db)
    .filter(
      (run) =>
        (filter.scriptId === undefined || run.scriptId === filter.scriptId) &&
        (filter.deliveryId === undefined || run.deliveryId === filter.deliveryId) &&
        (filter.status === undefined || run.status === filter.status),
    )
    .slice(0, limit);
}

export async function getRun(id: string): Promise<RunView> {
  const db = await read();
  const run = db.runs.find((r) => r.id === id);
  if (!run) throw notFound("run", id);
  const script = db.scripts.find((s) => s.id === run.scriptId);
  return toRunView(run, script?.name ?? "Deleted script");
}

/** A missing limit gets the default; a larger one is cut to the maximum; anything not a positive integer is a 400. */
export function checkLimit(limit: number | undefined, fallback: number, max: number): number {
  if (limit === undefined) return fallback;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new DomainError(400, `limit must be a positive whole number, got ${String(limit)}.`);
  }
  return Math.min(limit, max);
}

// ------------------------------------------------------------ Fake output

function between(random: Random, min: number, max: number): number {
  return Math.round(min + random() * (max - min));
}

function buildResult(script: Script, event: ChangeEvent, deliveryId: string, random: Random): ProcessedResult {
  const extracted = extractFields(script.extractionSchema, event, random);
  const fingerprint = createHash("sha256")
    .update(`${event.url}\n${JSON.stringify(extracted)}`)
    .digest("hex")
    .slice(0, 16);
  return {
    workspace_id: event.workspace_id,
    seq: event.seq,
    extracted,
    confidence: Math.round((0.62 + random() * 0.37) * 100) / 100,
    dedupe_key: `${event.workspace_id}:${fingerprint}`,
    raw_ref: `delivery/${deliveryId}#seq=${event.seq}`,
    pipeline_version: `v${script.version}`,
  };
}

const FAILURES = [
  "TimeoutError: the script exceeded its 30 s time limit",
  "RuntimeError: the extraction model returned an empty response",
  "UnicodeDecodeError: page_text is not valid UTF-8 at byte 4096",
  "MemoryError: page_text is too large to process in one pass",
  "ConnectionError: the extraction model could not be reached",
] as const;

function buildError(script: Script, outcome: Exclude<RunOutcome, "succeeded">, random: Random): string {
  if (outcome === "failed") return pick(FAILURES, random);
  const fields = Object.entries(script.extractionSchema);
  if (fields.length === 0) return "Output did not match the schema: expected an object, got null.";
  const [field, type] = pick(fields, random);
  const got = pick(["null", "an empty string", "a list", "nothing (the field is missing)"], random);
  return `Output did not match the schema: "${field}" should be ${shortType(type)}, got ${got}.`;
}

/**
 * Pretends to extract each schema field. Pages written as "Field name: value"
 * lines (as the seed and the test event are) yield those values; anything
 * else gets a plausible value of the right type.
 */
export function extractFields(
  schema: Record<string, string>,
  event: ChangeEvent,
  random: Random,
): Record<string, unknown> {
  const labelled = readLabelledLines(event.page_text);
  const out: Record<string, unknown> = {};
  for (const [field, type] of Object.entries(schema)) {
    const kind = typeKind(type);
    const found = labelled.get(normalizeKey(field));
    out[field] = found !== undefined ? coerce(found, kind) : fallbackValue(field, kind, event, random);
  }
  return out;
}

export type TypeKind = "number" | "boolean" | "date" | "url" | "list" | "string";

export function typeKind(type: string): TypeKind {
  const t = type.toLowerCase();
  if (/\[\]|\blist\b|\barray\b/.test(t)) return "list";
  if (/\bnumber\b|\binteger\b|\bfloat\b|\bdecimal\b/.test(t)) return "number";
  if (/\bbool(ean)?\b/.test(t)) return "boolean";
  if (/\burl\b|\buri\b/.test(t)) return "url";
  if (/\bdate\b|\btime\b|8601/.test(t)) return "date";
  return "string";
}

function shortType(type: string): string {
  const kind = typeKind(type);
  return kind === "list" ? "a list" : kind === "url" ? "a URL" : kind === "date" ? "a date" : `a ${kind}`;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function readLabelledLines(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z][A-Za-z0-9 _()-]{0,40}?)\s*:\s*(.+?)\s*$/.exec(line);
    if (match && !map.has(normalizeKey(match[1]))) map.set(normalizeKey(match[1]), match[2]);
  }
  return map;
}

function coerce(value: string, kind: TypeKind): unknown {
  switch (kind) {
    case "number": {
      if (/^(none|null|n\/a|-)$/i.test(value)) return null;
      const n = Number(value.replace(/[^0-9.-]/g, ""));
      return Number.isFinite(n) ? n : null;
    }
    case "boolean":
      return /^(yes|true|y|1)$/i.test(value);
    case "list":
      return value.split(/\s*[,;]\s*/).filter(Boolean);
    default:
      return value;
  }
}

function fallbackValue(field: string, kind: TypeKind, event: ChangeEvent, random: Random): unknown {
  const text = cleanText(event.page_text);
  switch (kind) {
    case "number":
      return Math.round(random() * 100000) / 100;
    case "boolean":
      return random() < 0.5;
    case "date":
      return event.received_at.slice(0, 10);
    case "url":
      return event.url || null;
    case "list":
      return text ? [text.slice(0, 40)] : [];
    default:
      if (/url|link/.test(field)) return event.url || null;
      if (/summary|description|text|detail/.test(field)) return text.slice(0, 160) || null;
      if (/title|headline|name/.test(field)) return firstLine(event.page_text).slice(0, 80) || null;
      return text ? text.slice(0, 60) : null;
  }
}

function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim() !== "");
  return line ? cleanText(line) : "";
}
