// A script is a workspace's process.py. The runtime wrote it; the local store
// holds its switch (developed, active, inactive) and the run log.

import * as runtime from "@/lib/backend/runtime";
import type { RawWorkspace } from "@/lib/backend/runtime";
import type { ScriptActivity, ScriptDetail, ScriptRecord, ScriptStatus, ScriptView } from "@/lib/types";
import { now } from "./clock";
import { DomainError, notFound } from "./errors";
import { isFinished } from "./runs";
import { mutate, read, type Db } from "./store";
import { DAY, iso, ms, newestFirst } from "./util";
import {
  buildCheck,
  loadRawWorkspace,
  loadRawWorkspaces,
  sampleUrl,
  workspaceName,
  workspaceStatus,
} from "./workspaces";

export const SCRIPT_STATUSES: readonly ScriptStatus[] = ["developed", "active", "inactive"];

/** How many finished runs the failure rate and the "failing" activity look at. */
export const FAILURE_WINDOW = 10;

// -------------------------------------------------------------------- Views

/** Only a workspace whose build finished has a script. */
export function hasScript(raw: RawWorkspace): boolean {
  return workspaceStatus(raw.status) === "ready";
}

export function toScriptView(raw: RawWorkspace, db: Db, at: Date = now()): ScriptView {
  const record = db.scripts.find((s) => s.id === raw.id);
  const status: ScriptStatus = record?.status ?? "developed";
  const builtAt = typeof raw.status.built_at === "number" ? iso(raw.status.built_at * 1000) : null;
  const query = raw.status.query ?? "";

  const runs = db.runs.filter((r) => r.scriptId === raw.id);
  const recentFinished = newestFirst(
    runs.filter((r) => isFinished(r.status)),
    (r) => r.finishedAt ?? r.queuedAt,
  ).slice(0, FAILURE_WINDOW);
  const failures = recentFinished.filter((r) => r.status === "failed").length;
  const runsInFlight = runs.filter((r) => !isFinished(r.status)).length;

  let activity: ScriptActivity;
  if (status !== "active") activity = "off";
  else if (recentFinished.length > 0 && failures * 2 >= recentFinished.length) activity = "failing";
  else if (runsInFlight > 0) activity = "processing";
  else activity = "idle";

  const dayAgo = at.getTime() - DAY;
  const lastRun = newestFirst(runs, (r) => r.queuedAt)[0];

  return {
    id: raw.id,
    workspaceId: raw.id,
    name: workspaceName(raw.id, query),
    query,
    status,
    activity,
    builtAt,
    deployedAt: record?.deployedAt ?? null,
    statusChangedAt: record?.statusChangedAt ?? builtAt,
    runsInFlight,
    runsLast24h: runs.filter((r) => ms(r.queuedAt) >= dayAgo).length,
    failureRate: recentFinished.length > 0 ? failures / recentFinished.length : null,
    lastRunAt: lastRun ? lastRun.queuedAt : null,
    webhookIds: db.webhooks.filter((w) => w.scriptIds.includes(raw.id)).map((w) => w.id),
  };
}

// -------------------------------------------------------------------- Reads

/** Newest build first. */
export async function listScripts(filter: { status?: ScriptStatus } = {}): Promise<ScriptView[]> {
  if (filter.status !== undefined && !SCRIPT_STATUSES.includes(filter.status)) {
    throw new DomainError(400, `Unknown script status "${String(filter.status)}".`);
  }
  const [raws, db] = await Promise.all([loadRawWorkspaces(), read()]);
  const at = now();
  return raws
    .filter(hasScript)
    .map((raw) => toScriptView(raw, db, at))
    .filter((s) => filter.status === undefined || s.status === filter.status)
    .sort((a, b) => Date.parse(b.builtAt ?? "1970-01-01") - Date.parse(a.builtAt ?? "1970-01-01") || a.id.localeCompare(b.id));
}

/** The workspace behind a script. 404 when there is no such workspace or it has no script yet. */
export async function loadScriptWorkspace(id: string): Promise<RawWorkspace> {
  let raw: RawWorkspace;
  try {
    raw = await loadRawWorkspace(id);
  } catch (error) {
    if (error instanceof DomainError && error.status === 404) throw notFound("script", id);
    throw error;
  }
  if (!hasScript(raw)) throw notFound("script", id);
  return raw;
}

export async function getScript(id: string): Promise<ScriptDetail> {
  const [raw, db, source] = await Promise.all([loadScriptWorkspace(id), read(), runtime.readScriptSource(id)]);
  return {
    ...toScriptView(raw, db),
    source,
    sampleUrl: sampleUrl(raw.status),
    buildCheck: buildCheck(raw.status),
  };
}

// --------------------------------------------------------------- Lifecycle
//
// developed --deploy--> active --deactivate--> inactive --activate--> active
// A script never returns to developed. Anything else is a 409.

/** developed -> active. Sets deployedAt. */
export function deployScript(id: string): Promise<ScriptView> {
  return transition(id, "developed", "active", {
    active: "This script is already deployed and active.",
    inactive: "This script has been deployed before. Reactivate it instead.",
  });
}

/** active -> inactive. */
export function deactivateScript(id: string): Promise<ScriptView> {
  return transition(id, "active", "inactive", {
    developed: "This script has never been deployed, so there is nothing to deactivate.",
    inactive: "This script is already inactive.",
  });
}

/** inactive -> active. */
export function activateScript(id: string): Promise<ScriptView> {
  return transition(id, "inactive", "active", {
    developed: "This script has never been deployed. Deploy it instead.",
    active: "This script is already active.",
  });
}

async function transition(
  id: string,
  from: ScriptStatus,
  to: ScriptStatus,
  refusals: Partial<Record<ScriptStatus, string>>,
): Promise<ScriptView> {
  const raw = await loadScriptWorkspace(id);
  return mutate((db) => {
    const record = ensureRecord(db, raw);
    if (record.status !== from) {
      throw new DomainError(409, refusals[record.status] ?? `Cannot change a ${record.status} script to ${to}.`);
    }
    const at = now();
    record.status = to;
    record.statusChangedAt = at.toISOString();
    if (to === "active" && record.deployedAt === null) record.deployedAt = record.statusChangedAt;
    return toScriptView(raw, db, at);
  });
}

/** The stored switch for a script, created as "developed" the first time it is needed. */
export function ensureRecord(db: Db, raw: RawWorkspace): ScriptRecord {
  const name = workspaceName(raw.id, raw.status.query ?? null);
  let record = db.scripts.find((s) => s.id === raw.id);
  if (!record) {
    record = { id: raw.id, name, status: "developed", deployedAt: null, statusChangedAt: null };
    db.scripts.push(record);
  }
  record.name = name;
  return record;
}
