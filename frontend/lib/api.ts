// The only place in the app that calls fetch().
//
// One typed function per route under app/api. Together with lib/types.ts this
// is the boundary between the pages and the server.

import type {
  CreateWebhookInput,
  CreateWorkspaceInput,
  Delivery,
  Overview,
  RunStatus,
  RunView,
  ScriptDetail,
  ScriptStatus,
  ScriptView,
  UpdateWebhookInput,
  WebhookView,
  WorkspaceDetail,
  WorkspaceOutput,
  WorkspaceView,
} from "./types";

/** A non-2xx response, or a request that never reached the server. */
export class ApiRequestError extends Error {
  /** HTTP status, or 0 when the server could not be reached. */
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 404;
}

/** A sentence fit to show the user for any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong.";
}

async function request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method ?? "GET",
      cache: "no-store",
      headers: init?.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiRequestError(0, "Can't reach the server. Is `npm run dev` still running?");
  }

  const text = await res.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!res.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : `The server answered ${res.status}.`;
    throw new ApiRequestError(res.status, message);
  }
  return payload as T;
}

function query(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

const id = encodeURIComponent;

// ------------------------------------------------------------------ Overview

export const getOverview = () => request<Overview>("/api/overview");

// ---------------------------------------------------------------- Workspaces

export const listWorkspaces = () => request<WorkspaceView[]>("/api/workspaces");

/** Starts a build. The workspace comes back "building". */
export const createWorkspace = (input: CreateWorkspaceInput) =>
  request<WorkspaceView>("/api/workspaces", { method: "POST", body: input });

export const getWorkspace = (workspaceId: string) =>
  request<WorkspaceDetail>(`/api/workspaces/${id(workspaceId)}`);

export const getWorkspaceOutput = (workspaceId: string) =>
  request<WorkspaceOutput>(`/api/workspaces/${id(workspaceId)}/output`);

// ------------------------------------------------------------------- Scripts

export const listScripts = (status?: ScriptStatus) =>
  request<ScriptView[]>(`/api/scripts${query({ status })}`);

export const getScript = (scriptId: string) => request<ScriptDetail>(`/api/scripts/${id(scriptId)}`);

export const deployScript = (scriptId: string) =>
  request<ScriptView>(`/api/scripts/${id(scriptId)}/deploy`, { method: "POST" });

export const deactivateScript = (scriptId: string) =>
  request<ScriptView>(`/api/scripts/${id(scriptId)}/deactivate`, { method: "POST" });

export const activateScript = (scriptId: string) =>
  request<ScriptView>(`/api/scripts/${id(scriptId)}/activate`, { method: "POST" });

/** Queues one page for the script. The run comes back "queued"; poll for its outcome. */
export const runScriptUrl = (scriptId: string, url: string) =>
  request<RunView>(`/api/scripts/${id(scriptId)}/run`, { method: "POST", body: { url } });

/** Queues a collect: ask Telem what is new and run each new page. */
export const collectScript = (scriptId: string) =>
  request<RunView>(`/api/scripts/${id(scriptId)}/collect`, { method: "POST" });

// ---------------------------------------------------------------------- Runs

export interface RunFilter {
  scriptId?: string;
  status?: RunStatus;
  deliveryId?: string;
  limit?: number;
}

export const listRuns = (filter: RunFilter = {}) => request<RunView[]>(`/api/runs${query({ ...filter })}`);

export const getRun = (runId: string) => request<RunView>(`/api/runs/${id(runId)}`);

// ------------------------------------------------------------------ Webhooks

export const listWebhooks = () => request<WebhookView[]>("/api/webhooks");

export const createWebhook = (input: CreateWebhookInput) =>
  request<WebhookView>("/api/webhooks", { method: "POST", body: input });

export const getWebhook = (webhookId: string) => request<WebhookView>(`/api/webhooks/${id(webhookId)}`);

export const updateWebhook = (webhookId: string, input: UpdateWebhookInput) =>
  request<WebhookView>(`/api/webhooks/${id(webhookId)}`, { method: "PATCH", body: input });

export const deleteWebhook = (webhookId: string) =>
  request<{ ok: true }>(`/api/webhooks/${id(webhookId)}`, { method: "DELETE" });

export const listDeliveries = (webhookId: string, limit?: number) =>
  request<Delivery[]>(`/api/webhooks/${id(webhookId)}/deliveries${query({ limit })}`);

/** Sends a test delivery naming `url`; active target scripts run that page for real. */
export const sendTestEvent = (webhookId: string, url: string) =>
  request<Delivery>(`/api/webhooks/${id(webhookId)}/test`, { method: "POST", body: { url } });

// ----------------------------------------------------------------------- Dev

/** Empties the local store: script switches, webhooks, deliveries and the run log. */
export const resetData = () => request<{ ok: true }>("/api/dev/reset", { method: "POST" });
