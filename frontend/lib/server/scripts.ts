import type { Script, ScriptActivity, ScriptStatus, ScriptView } from "@/lib/types";
import { now } from "./clock";
import { DomainError, notFound } from "./errors";
import { isFinished, isProblem, runStatusAt } from "./runtime";
import { mutate, read, type Db } from "./store";
import { DAY, ms, newestFirst } from "./util";

export const SCRIPT_STATUSES: readonly ScriptStatus[] = ["developed", "active", "inactive"];

/** How many finished runs the failure rate and the "failing" activity look at. */
export const FAILURE_WINDOW = 10;

// -------------------------------------------------------------------- Views

export function toScriptView(script: Script, db: Db, at: Date = now()): ScriptView {
  const runs = db.runs
    .filter((r) => r.scriptId === script.id)
    .map((run) => ({ run, status: runStatusAt(run, at) }));

  const recentFinished = newestFirst(
    runs.filter((r) => isFinished(r.status)),
    (r) => r.run.finishesAt,
  ).slice(0, FAILURE_WINDOW);
  const problems = recentFinished.filter((r) => isProblem(r.status)).length;
  const failureRate = recentFinished.length > 0 ? problems / recentFinished.length : null;
  const runsInFlight = runs.filter((r) => !isFinished(r.status)).length;

  let activity: ScriptActivity;
  if (script.status !== "active") activity = "off";
  else if (recentFinished.length > 0 && problems * 2 >= recentFinished.length) activity = "failing";
  else if (runsInFlight > 0) activity = "processing";
  else activity = "idle";

  const dayAgo = at.getTime() - DAY;
  const lastRun = newestFirst(runs, (r) => r.run.queuedAt)[0];

  return {
    ...script,
    workspaceName: db.workspaces.find((w) => w.id === script.workspaceId)?.name ?? "Deleted workspace",
    activity,
    runsInFlight,
    runsLast24h: runs.filter((r) => ms(r.run.queuedAt) >= dayAgo && ms(r.run.queuedAt) <= at.getTime()).length,
    failureRate,
    lastRunAt: lastRun ? lastRun.run.queuedAt : null,
    webhookIds: db.webhooks.filter((w) => w.scriptIds.includes(script.id)).map((w) => w.id),
  };
}

// -------------------------------------------------------------------- Reads

/** Newest first. */
export async function listScripts(filter: { status?: ScriptStatus } = {}): Promise<ScriptView[]> {
  if (filter.status !== undefined && !SCRIPT_STATUSES.includes(filter.status)) {
    throw new DomainError(400, `Unknown script status "${String(filter.status)}".`);
  }
  const db = await read();
  const at = now();
  return newestFirst(db.scripts, (s) => s.createdAt)
    .filter((s) => filter.status === undefined || s.status === filter.status)
    .map((s) => toScriptView(s, db, at));
}

export async function getScript(id: string): Promise<ScriptView> {
  const db = await read();
  return toScriptView(findScript(db, id), db);
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

function transition(
  id: string,
  from: ScriptStatus,
  to: ScriptStatus,
  refusals: Partial<Record<ScriptStatus, string>>,
): Promise<ScriptView> {
  return mutate((db) => {
    const script = findScript(db, id);
    if (script.status !== from) {
      throw new DomainError(409, refusals[script.status] ?? `Cannot change a ${script.status} script to ${to}.`);
    }
    const at = now();
    script.status = to;
    script.statusChangedAt = at.toISOString();
    if (to === "active" && script.deployedAt === null) script.deployedAt = script.statusChangedAt;
    return toScriptView(script, db, at);
  });
}

function findScript(db: Db, id: string): Script {
  const script = db.scripts.find((s) => s.id === id);
  if (!script) throw notFound("script", id);
  return script;
}
