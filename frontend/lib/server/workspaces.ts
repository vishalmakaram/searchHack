// Workspaces live in the Sentinel runtime. This module reads them from there
// and adds what the local store knows (the script's switch).

import * as output from "@/lib/backend/output";
import * as runtime from "@/lib/backend/runtime";
import type { RawAlert, RawStats } from "@/lib/backend/output";
import type { RawStatus, RawWorkspace } from "@/lib/backend/runtime";
import type {
  Alert,
  BuildCheck,
  CreateWorkspaceInput,
  OutputStats,
  WorkspaceDetail,
  WorkspaceOutput,
  WorkspaceStatus,
  WorkspaceView,
} from "@/lib/types";
import { DomainError, notFound } from "./errors";
import { read, type Db } from "./store";
import { cleanText, iso } from "./util";

export const MAX_QUERY_LENGTH = 500;
export const NAME_LENGTH = 64;
export const ALERT_LIMIT = 100;

// ------------------------------------------------------------------ Mapping

export function workspaceStatus(raw: RawStatus): WorkspaceStatus {
  switch (raw.status) {
    case "creating":
      return "building";
    case "ready":
      return "ready";
    case "failed":
      return "failed";
    case "interrupted":
      return "interrupted";
    default:
      // A folder the output service made for results; the runtime never built it.
      return "output_only";
  }
}

/** The start of the query, cut at a word, or the id when there is no query. */
export function workspaceName(id: string, query: string | null): string {
  const text = cleanText(query ?? "");
  if (text === "") return id;
  if (text.length <= NAME_LENGTH) return text;
  const cut = text.slice(0, NAME_LENGTH);
  const space = cut.lastIndexOf(" ");
  return `${(space > NAME_LENGTH / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

/** The runtime writes seconds since the epoch. */
function time(seconds: unknown): string | null {
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? iso(seconds * 1000) : null;
}

export function toWorkspaceView(raw: RawWorkspace, db: Db): WorkspaceView {
  const status = workspaceStatus(raw.status);
  const query = typeof raw.status.query === "string" && raw.status.query.trim() !== "" ? raw.status.query : null;
  const record = db.scripts.find((s) => s.id === raw.id);
  return {
    id: raw.id,
    name: workspaceName(raw.id, query),
    query,
    status,
    createdAt: time(raw.status.created_at),
    builtAt: time(raw.status.built_at),
    error: status === "failed" || status === "interrupted" ? (raw.status.error ?? null) : null,
    scriptStatus: status === "ready" ? (record?.status ?? "developed") : null,
    monitorId: typeof raw.status.monitor_id === "string" && raw.status.monitor_id ? raw.status.monitor_id : null,
    pagesSeen: Array.isArray(raw.status.seen_urls) ? raw.status.seen_urls.length : 0,
    resultsHandled: typeof raw.status.seq === "number" ? raw.status.seq : 0,
  };
}

export function buildCheck(raw: RawStatus): BuildCheck | null {
  const verify = raw.build?.verify;
  if (!verify) return null;
  return {
    ok: verify.ok === true,
    durationMs: typeof verify.duration_ms === "number" ? verify.duration_ms : null,
    output: verify.output ?? null,
    error: typeof verify.error === "string" && verify.error ? verify.error : null,
  };
}

export function sampleUrl(raw: RawStatus): string | null {
  return typeof raw.sample === "string" && raw.sample ? raw.sample : null;
}

// -------------------------------------------------------------------- Reads

/** Every workspace the runtime has, as it describes them. */
export async function loadRawWorkspaces(): Promise<RawWorkspace[]> {
  const ids = await runtime.listWorkspaceIds();
  const all = await Promise.all(ids.map((id) => runtime.getWorkspace(id)));
  return all.filter((w): w is RawWorkspace => w !== null);
}

/** 404 when the runtime does not know the id. */
export async function loadRawWorkspace(id: string): Promise<RawWorkspace> {
  const raw = await runtime.getWorkspace(id);
  if (!raw) throw notFound("workspace", id);
  return raw;
}

const STATUS_ORDER: Record<WorkspaceStatus, number> = { building: 0, failed: 1, interrupted: 1, ready: 1, output_only: 2 };

/** Builds in progress first, then newest first; folders without a script last. */
export function sortWorkspaces(views: WorkspaceView[]): WorkspaceView[] {
  return [...views].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      Date.parse(b.createdAt ?? "1970-01-01") - Date.parse(a.createdAt ?? "1970-01-01") ||
      a.id.localeCompare(b.id),
  );
}

export async function listWorkspaces(): Promise<WorkspaceView[]> {
  const [raws, db] = await Promise.all([loadRawWorkspaces(), read()]);
  return sortWorkspaces(raws.map((raw) => toWorkspaceView(raw, db)));
}

export async function getWorkspace(id: string): Promise<WorkspaceDetail> {
  const [raw, db] = await Promise.all([loadRawWorkspace(id), read()]);
  return {
    ...toWorkspaceView(raw, db),
    memory: raw.memory,
    sampleUrl: sampleUrl(raw.status),
    buildCheck: buildCheck(raw.status),
  };
}

// ------------------------------------------------------------------- Writes

/** Starts a build in the runtime. The workspace reads "building" until it finishes. */
export async function createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceView> {
  const query = cleanText(typeof input?.query === "string" ? input.query : "");
  if (query === "") throw new DomainError(400, "Describe what to watch.");
  if (query.length > MAX_QUERY_LENGTH) {
    throw new DomainError(400, `That is too long (at most ${MAX_QUERY_LENGTH} characters).`);
  }
  const id = await runtime.createWorkspace(query);
  const [raw, db] = await Promise.all([runtime.getWorkspace(id), read()]);
  // The runtime writes status.json before it answers, so this is only a fallback.
  return toWorkspaceView(raw ?? { id, status: { status: "creating", query }, memory: "" }, db);
}

// ------------------------------------------------------------------- Output

/** "2026-11-14 21:47:23Z" -> ISO, or null. */
function alertTime(timestamp: unknown): string | null {
  if (typeof timestamp !== "string") return null;
  const parsed = Date.parse(timestamp.includes("T") ? timestamp : timestamp.replace(" ", "T"));
  return Number.isNaN(parsed) ? null : iso(parsed);
}

export function toAlert(raw: RawAlert): Alert {
  const delivered = raw.suppressed !== true;
  return {
    seq: typeof raw.seq === "number" ? raw.seq : 0,
    at: alertTime(raw.timestamp),
    delivered,
    reason: delivered ? "" : (raw.suppression_reason ?? ""),
    eventType: raw.event_type ?? "",
    impact: (raw.impact ?? "").toLowerCase(),
    summary: raw.summary ?? "",
    sourceUrl: raw.source_url ?? "",
    confidence: typeof raw.confidence === "number" ? raw.confidence : null,
  };
}

export function toStats(raw: RawStats): OutputStats {
  return {
    received: raw.total_received ?? 0,
    delivered: raw.total_alerts_delivered ?? 0,
    suppressed: raw.total_suppressed ?? 0,
    docEntries: raw.doc_entries ?? 0,
  };
}

/**
 * What the output service holds for a workspace. The workspace is looked up
 * first, because the output service creates a folder for any id it is asked
 * about. An unreachable output service is not an error here: `available` is
 * false and the page says so.
 */
export async function getWorkspaceOutput(id: string): Promise<WorkspaceOutput> {
  await loadRawWorkspace(id);
  try {
    const [stats, alerts, doc] = await Promise.all([output.stats(id), output.alerts(id, ALERT_LIMIT), output.researchDoc(id)]);
    return {
      available: true,
      stats: toStats(stats),
      alerts: alerts.map(toAlert).sort((a, b) => b.seq - a.seq),
      doc,
    };
  } catch {
    return { available: false, stats: null, alerts: [], doc: "" };
  }
}
