// Client for the Sentinel runtime (sentinel/server.py, port 8000).
//
// The shapes below are what that server returns today. They are read
// defensively: every field is optional, because status.json is written
// piecemeal by the runtime as a build progresses.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { runtimeUrl, workspacesDir } from "./config";
import { BackendError, callJson } from "./http";

/** Contents of a workspace's status.json. */
export interface RawStatus {
  /** "creating" while building, then "ready", "failed" or "interrupted". */
  status?: string;
  query?: string;
  /** Seconds since the epoch. */
  created_at?: number;
  built_at?: number;
  error?: string | null;
  /** The page the builder agent was shown. */
  sample?: string;
  build?: {
    ok?: boolean;
    steps?: Record<string, unknown>[];
    verify?: { ok?: boolean; duration_ms?: number; output?: unknown; error?: string };
  };
  monitor_id?: string;
  seen_urls?: string[];
  fingerprints?: Record<string, string>;
  /** How many results the delivery agent has handled. */
  seq?: number;
}

export interface RawWorkspace {
  id: string;
  status: RawStatus;
  memory: string;
}

/** What POST /workspaces/{id}/run returns: one page through the whole pipeline. */
export interface RawPipelineResult {
  workspace?: string;
  url?: string;
  page?: { title?: string; content_length?: number; cached?: boolean; provider?: string };
  process?: {
    ok?: boolean;
    duration_ms?: number;
    error?: string;
    stdout?: string;
    output?: { keep?: boolean; processed?: string; data?: Record<string, unknown> };
  };
  ok?: boolean;
  error?: string;
  /** The extractor said the page was not relevant or not new. */
  dropped?: boolean;
  /** Same extraction as the last time this URL ran, so the agent was not woken. */
  unchanged?: boolean;
  reason?: string;
  fingerprint?: string;
  delivery?: {
    ok?: boolean;
    duration_s?: number;
    reply?: string;
    integrations_available?: boolean;
    service?: string | null;
  };
}

export interface RawCollectResult {
  workspace?: string;
  query?: string;
  monitor_id?: string;
  created_monitor?: string;
  /** "monitor", or "escalation" when the monitor had nothing and a search was run instead. */
  source?: string;
  new_items?: number;
  results?: RawPipelineResult[];
}

// A page can take minutes: Telem fetch, the extractor, then a delivery agent.
const RUN_TIMEOUT_MS = 10 * 60_000;
const COLLECT_TIMEOUT_MS = 30 * 60_000;

const WORKSPACE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

/** True for ids that are safe to put in a URL path or a file path. */
export function isWorkspaceId(id: string): boolean {
  return WORKSPACE_ID.test(id) && !id.includes("..");
}

const call = <T>(path_: string, options?: Parameters<typeof callJson>[3]) =>
  callJson<T>("runtime", runtimeUrl(), path_, options);

export async function isUp(): Promise<boolean> {
  try {
    await call<{ ok: boolean }>("/health", { timeoutMs: 2500 });
    return true;
  } catch {
    return false;
  }
}

export async function listWorkspaceIds(): Promise<string[]> {
  const body = await call<{ workspaces?: string[] }>("/workspaces");
  return (body.workspaces ?? []).filter(isWorkspaceId);
}

/** Returns null when the runtime does not know the workspace. */
export async function getWorkspace(id: string): Promise<RawWorkspace | null> {
  if (!isWorkspaceId(id)) return null;
  try {
    const body = await call<Partial<RawWorkspace>>(`/workspaces/${encodeURIComponent(id)}`);
    return { id, status: body.status ?? {}, memory: body.memory ?? "" };
  } catch (error) {
    if (error instanceof BackendError && error.status === 404) return null;
    throw error;
  }
}

/** Starts a build and returns the new workspace's id. Creating the environment takes a second or two. */
export async function createWorkspace(query: string): Promise<string> {
  const body = await call<{ id?: string }>("/workspaces", { method: "POST", body: { query }, timeoutMs: 60_000 });
  if (!body.id) throw new BackendError("runtime", 502, "The Sentinel runtime did not return a workspace id.");
  return body.id;
}

/** Runs one page through the workspace's pipeline. Slow: it waits for the delivery agent. */
export function runUrl(id: string, url: string): Promise<RawPipelineResult> {
  return call<RawPipelineResult>(`/workspaces/${encodeURIComponent(id)}/run`, {
    method: "POST",
    body: { url },
    timeoutMs: RUN_TIMEOUT_MS,
  });
}

/** Asks Telem what is new for the workspace's query and runs each new page. Slower still. */
export function collect(id: string): Promise<RawCollectResult> {
  return call<RawCollectResult>(`/workspaces/${encodeURIComponent(id)}/collect`, {
    method: "POST",
    body: {},
    timeoutMs: COLLECT_TIMEOUT_MS,
  });
}

/**
 * The text of a workspace's process.py, or null if it has not been written.
 * Read from disk because the runtime has no endpoint for it.
 */
export async function readScriptSource(id: string): Promise<string | null> {
  if (!isWorkspaceId(id)) return null;
  const root = workspacesDir();
  const file = path.resolve(root, id, "process.py");
  // Belt and braces: the id pattern already rules out leaving the folder.
  if (!file.startsWith(root + path.sep)) return null;
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}
