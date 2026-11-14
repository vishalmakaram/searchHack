// Every type shared by the client and the server (PLAN.md section 6.2).
//
// Together with lib/api.ts this file is the replacement boundary: the real
// backend will be built against these shapes. Do not change them without
// flagging it.
//
// All timestamps are ISO 8601 strings. IDs are a prefix plus 12 random
// characters: ws_, scr_, wh_, dlv_, run_.

import type { ChangeEvent, ProcessedResult } from "./contracts";

export type { ChangeEvent, ProcessedResult };

// ---------------------------------------------------------------- Workspaces

export type Frequency = "1h" | "6h" | "12h" | "1d" | "7d";
export type WorkspaceStatus = "compiling" | "awaiting_approval" | "ready";

export interface Workspace {
  id: string;
  /** Short label derived from the intent, editable. */
  name: string;
  /** The user's sentence. */
  intent: string;
  queries: { id: string; text: string }[];
  frequency: Frequency;
  /** e.g. ["brave", "exa", "tavily"] */
  escalationProviders: string[];
  /** Field name -> type description. */
  extractionSchema: Record<string, string>;
  /** Set when queries are approved. */
  scriptId: string | null;
  createdAt: string;
  /** Before this moment the status reads "compiling". */
  compileReadyAt: string;
  approvedAt: string | null;
}
export type WorkspaceView = Workspace & { status: WorkspaceStatus };

// ------------------------------------------------------------------- Scripts

export type ScriptStatus = "developed" | "active" | "inactive";
export type ScriptActivity = "off" | "idle" | "processing" | "failing";

export interface Script {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  /** Shown as "v3". */
  version: number;
  status: ScriptStatus;
  /** Script text, shown read-only. */
  source: string;
  extractionSchema: Record<string, string>;
  createdAt: string;
  /** First deployment; null means never deployed. */
  deployedAt: string | null;
  statusChangedAt: string;
}
export type ScriptView = Script & {
  workspaceName: string;
  activity: ScriptActivity;
  runsInFlight: number;
  runsLast24h: number;
  /** Over the last 10 finished runs, 0..1. */
  failureRate: number | null;
  lastRunAt: string | null;
  /** Webhooks that route to this script. */
  webhookIds: string[];
};

// ------------------------------------------------------------------ Webhooks

export interface Webhook {
  id: string;
  name: string;
  /** Given to Telem as the webhook secret. */
  secret: string;
  enabled: boolean;
  /** Routing targets; may be empty. */
  scriptIds: string[];
  createdAt: string;
}
export type WebhookView = Webhook & {
  /** PUBLIC_BASE_URL (or request origin) + /api/hooks/{id} */
  url: string;
  deliveryCount: number;
  lastDeliveryAt: string | null;
};

export type WebhookType = "agent.changes" | "vendor.items" | "unknown";

export interface Delivery {
  id: string;
  webhookId: string;
  receivedAt: string;
  /** From the Telem-Webhook-Type request header. */
  webhookType: WebhookType;
  signature: "not_checked" | "valid" | "invalid";
  /** Sent by the in-app test button. */
  isTest: boolean;
  bodyBytes: number;
  /** Parsed JSON, or the raw string if not JSON. */
  body: unknown;
  eventCount: number;
  /** Events dropped because their seq was already seen. */
  duplicateCount: number;
  runIds: string[];
  skipped: { scriptId: string; reason: "script_not_active" }[];
}

// ---------------------------------------------------------------------- Runs

export type RunStatus = "queued" | "running" | "succeeded" | "invalid" | "failed";

export interface Run {
  id: string;
  scriptId: string;
  webhookId: string;
  deliveryId: string;
  event: ChangeEvent;
  queuedAt: string;
  startsAt: string;
  finishesAt: string;
  /** Decided at creation, hidden until finished. */
  outcome: "succeeded" | "invalid" | "failed";
  /** Only for "succeeded". */
  result: ProcessedResult | null;
  /** For "invalid" and "failed". */
  error: string | null;
}
/** What the API returns: status derived from the clock; result and error are null until finished. */
export type RunView = Omit<Run, "outcome"> & {
  status: RunStatus;
  durationMs: number | null;
  scriptName: string;
};

// ------------------------------------------------------------------ Overview

export type Health = "ok" | "busy" | "attention" | "idle";

export type StageKey = "ingest" | "dispatch" | "processing" | "results";

export interface Overview {
  /** Worst of the stage healths. */
  health: Health;
  stages: {
    key: StageKey;
    label: string;
    health: Health;
    metrics: { label: string; value: string }[];
  }[];
  scriptCounts: Record<ScriptStatus, number>;
  /** Queued or running, newest first. */
  runsInFlight: RunView[];
  /** Last 10. */
  recentDeliveries: Delivery[];
  /** Last 10 failed or invalid. */
  recentProblems: RunView[];
}

// ----------------------------------------------------------- Request bodies
// One per write route in PLAN.md section 6.5. The route handlers validate
// these with zod; lib/api.ts sends them.

export interface CreateWorkspaceInput {
  intent: string;
}
export interface UpdateWorkspaceInput {
  name?: string;
  queries?: string[];
  frequency?: Frequency;
}
export interface ApproveWorkspaceInput {
  queries: string[];
}
export interface CreateWebhookInput {
  name: string;
  scriptIds: string[];
}
export interface UpdateWebhookInput {
  name?: string;
  enabled?: boolean;
  scriptIds?: string[];
}

/** Body of every error response. */
export interface ApiError {
  error: string;
}

/** Response of POST /api/hooks/{id}. */
export interface ReceiveResult {
  ok: true;
  delivery_id: string;
}
