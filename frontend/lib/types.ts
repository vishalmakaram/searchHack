// Every type shared by the browser and the route handlers.
//
// Together with lib/api.ts this file is the boundary between the pages and
// the server. The route handlers fill these shapes from two real services
// (the Sentinel runtime and the output integration service) plus a small
// local store that holds what those services do not: script switches,
// webhooks, deliveries and the run log.
//
// All timestamps are ISO 8601 strings. A workspace id comes from the runtime
// (for example "ws_ab12cd34ef"); a script has the same id as its workspace.
// Local ids are a prefix plus 12 random characters: wh_, dlv_, run_.

// ---------------------------------------------------------------- Workspaces

/**
 * building     the runtime is searching, fetching and writing the script
 * ready        the script was written and passed its check
 * failed       the build ended with an error
 * interrupted  the runtime restarted in the middle of the build
 * output_only  a folder that only holds delivered results; it has no script
 */
export type WorkspaceStatus = "building" | "ready" | "failed" | "interrupted" | "output_only";

export interface WorkspaceView {
  id: string;
  /** Short label: the start of the query, or the id when there is no query. */
  name: string;
  /** The sentence the workspace was created from. */
  query: string | null;
  status: WorkspaceStatus;
  createdAt: string | null;
  builtAt: string | null;
  /** Why the build failed. */
  error: string | null;
  /** Null until the workspace has a script. */
  scriptStatus: ScriptStatus | null;
  /** The Telem monitor that watches the query, once one exists. */
  monitorId: string | null;
  /** Pages this workspace has already run. */
  pagesSeen: number;
  /** Results the delivery agent has handled. */
  resultsHandled: number;
}

/** The run of the new script against a real sample page, done at the end of a build. */
export interface BuildCheck {
  ok: boolean;
  durationMs: number | null;
  /** What the script printed for the sample page. */
  output: unknown;
  error: string | null;
}

export interface WorkspaceDetail extends WorkspaceView {
  /** The workspace's memory.md: what the delivery agent has recorded so far. */
  memory: string;
  /** The page the script was written against. */
  sampleUrl: string | null;
  buildCheck: BuildCheck | null;
}

/** One result the output service received for a workspace. */
export interface Alert {
  seq: number;
  at: string | null;
  /** False when the output service held it back. */
  delivered: boolean;
  /** Why it was held back; empty when it was delivered. */
  reason: string;
  eventType: string;
  impact: string;
  summary: string;
  sourceUrl: string;
  confidence: number | null;
}

export interface OutputStats {
  received: number;
  delivered: number;
  suppressed: number;
  docEntries: number;
}

/** What the output service holds for one workspace. */
export interface WorkspaceOutput {
  /** False when the output service could not be reached. */
  available: boolean;
  stats: OutputStats | null;
  /** Newest first. */
  alerts: Alert[];
  /** The living research document, as Markdown. */
  doc: string;
}

// ------------------------------------------------------------------- Scripts

/** What the local store keeps for a script: its switch. Everything else comes from the runtime. */
export interface ScriptRecord {
  id: string;
  name: string;
  status: ScriptStatus;
  deployedAt: string | null;
  statusChangedAt: string | null;
}

/**
 * developed  written by a build, never deployed; receives nothing
 * active     deployed and switched on; receives events
 * inactive   was deployed, now switched off; receives nothing
 */
export type ScriptStatus = "developed" | "active" | "inactive";
export type ScriptActivity = "off" | "idle" | "processing" | "failing";

/** A workspace's process.py and its switch. */
export interface ScriptView {
  /** Same as the workspace id. */
  id: string;
  workspaceId: string;
  name: string;
  query: string;
  status: ScriptStatus;
  activity: ScriptActivity;
  builtAt: string | null;
  /** First deployment; null means never deployed. */
  deployedAt: string | null;
  statusChangedAt: string | null;
  runsInFlight: number;
  runsLast24h: number;
  /** Over the last 10 finished runs, 0..1. */
  failureRate: number | null;
  lastRunAt: string | null;
  /** Webhooks that route to this script. */
  webhookIds: string[];
}

export interface ScriptDetail extends ScriptView {
  /** The text of process.py, or null when the file could not be read. */
  source: string | null;
  sampleUrl: string | null;
  buildCheck: BuildCheck | null;
}

// ------------------------------------------------------------------ Webhooks

export interface Webhook {
  id: string;
  name: string;
  /** The signing secret Telem issued for the monitor; null until one is saved. */
  secret: string | null;
  enabled: boolean;
  /** Routing targets; may be empty. */
  scriptIds: string[];
  createdAt: string;
}

/** The secret itself never leaves the server. */
export type WebhookView = Omit<Webhook, "secret"> & {
  secretSet: boolean;
  /** PUBLIC_BASE_URL (or the request origin) + /api/hooks/{id} */
  url: string;
  deliveryCount: number;
  lastDeliveryAt: string | null;
};

export type WebhookType = "agent.changes" | "vendor.items" | "unknown";

export type SignatureCheck = "not_checked" | "valid" | "invalid";

export interface Delivery {
  id: string;
  webhookId: string;
  receivedAt: string;
  /** From the Telem-Webhook-Type request header. */
  webhookType: WebhookType;
  signature: SignatureCheck;
  /** Sent by the in-app test button. */
  isTest: boolean;
  bodyBytes: number;
  /** Parsed JSON, or the raw string if not JSON. */
  body: unknown;
  eventCount: number;
  /** Events dropped because their seq was already seen. */
  duplicateCount: number;
  /** Events that named no page address, so there was nothing to run. */
  eventsWithoutUrl: number;
  runIds: string[];
  skipped: { scriptId: string; reason: "script_not_active" }[];
}

// ---------------------------------------------------------------------- Runs

/** What started the run. */
export type RunSource = "webhook" | "manual" | "collect";

/**
 * queued     waiting for the runs ahead of it
 * running    the runtime is working on it
 * delivered  the delivery agent recorded the result
 * dropped    the script judged the page not relevant
 * unchanged  the page gave the same result as last time; nothing was sent
 * failed     something went wrong; see `error`
 */
export type RunStatus = "queued" | "running" | "delivered" | "dropped" | "unchanged" | "failed";
export type PageOutcome = "delivered" | "dropped" | "unchanged" | "failed";

/** One page taken through a workspace's pipeline. */
export interface PageResult {
  url: string;
  title: string | null;
  outcome: PageOutcome;
  /** Why it was dropped, left unchanged or failed. */
  reason: string | null;
  /** The script's one-line reading of the page. */
  processed: string | null;
  /** The fields the script extracted. */
  data: Record<string, unknown> | null;
  /** The last thing the delivery agent said. */
  agentReply: string | null;
}

export interface Run {
  id: string;
  scriptId: string;
  /** The script's name when the run was created. */
  scriptName: string;
  source: RunSource;
  webhookId: string | null;
  deliveryId: string | null;
  /** The page to run. Null for a collect, which finds its own pages. */
  url: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: RunStatus;
  /** One sentence about how it ended. */
  summary: string | null;
  error: string | null;
  /** One entry for a page run; zero or more for a collect. */
  pages: PageResult[];
}

export type RunView = Run & {
  durationMs: number | null;
};

// ------------------------------------------------------------------ Overview

export type Health = "ok" | "busy" | "attention" | "idle";

export type StageKey = "ingest" | "dispatch" | "processing" | "delivery";

export interface ServiceStatus {
  key: "runtime" | "output";
  label: string;
  /** Where the server looks for it. */
  url: string;
  up: boolean;
}

/** An output the delivery agent can send to. */
export interface Channel {
  name: string;
  configured: boolean;
}

export interface Overview {
  /** Worst of the stage healths; "attention" when a service is down. */
  health: Health;
  services: ServiceStatus[];
  channels: Channel[];
  stages: {
    key: StageKey;
    label: string;
    health: Health;
    metrics: { label: string; value: string }[];
  }[];
  scriptCounts: Record<ScriptStatus, number>;
  /** Workspaces whose build is still going. */
  building: WorkspaceView[];
  /** Queued or running, oldest first (the order they will run). */
  runsInFlight: RunView[];
  /** Last 10. */
  recentDeliveries: Delivery[];
  /** Last 10 failed runs. */
  recentProblems: RunView[];
}

// ----------------------------------------------------------- Request bodies

export interface CreateWorkspaceInput {
  query: string;
}
export interface RunUrlInput {
  url: string;
}
export interface CreateWebhookInput {
  name: string;
  scriptIds: string[];
  secret?: string | null;
}
export interface UpdateWebhookInput {
  name?: string;
  enabled?: boolean;
  scriptIds?: string[];
  /** A new signing secret, or null to remove it. */
  secret?: string | null;
}
export interface TestEventInput {
  url: string;
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
