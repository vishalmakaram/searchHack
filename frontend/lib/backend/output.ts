// Client for the output integration service (output_integration/server.py, port 4096).
//
// It receives results from the runtime's delivery agent, decides which become
// alerts, keeps the living research document, and pushes to chat channels.
// This app only reads from it.

import { outputUrl } from "./config";
import { callJson } from "./http";

/** One line of a workspace's alerts.jsonl. */
export interface RawAlert {
  workspace_id?: string;
  seq?: number;
  /** "2026-11-14 21:47:23Z" */
  timestamp?: string;
  suppressed?: boolean;
  /** "approved" when the alert went out. */
  suppression_reason?: string;
  event_type?: string;
  impact?: string;
  summary?: string;
  source_url?: string;
  confidence?: number;
  dedupe_key?: string;
}

export interface RawStats {
  total_received?: number;
  total_alerts_delivered?: number;
  total_suppressed?: number;
  doc_entries?: number;
}

export interface RawCapabilities {
  service?: string;
  version?: string;
  outputs?: { name?: string; configured?: boolean; transport?: string; requires?: string[] }[];
}

const call = <T>(path: string, options?: Parameters<typeof callJson>[3]) =>
  callJson<T>("output", outputUrl(), path, options);

const id = encodeURIComponent;

/** Which outputs exist and which are configured. Also serves as the health check. */
export function capabilities(): Promise<RawCapabilities> {
  return call<RawCapabilities>("/api/v1/capabilities", { method: "POST", body: { include_schemas: false }, timeoutMs: 2500 });
}

// The three reads below make the service create a folder for an id it has not
// seen, so only call them for workspaces that already exist.

export async function alerts(workspaceId: string, limit = 100): Promise<RawAlert[]> {
  const body = await call<{ alerts?: RawAlert[] }>(`/api/v1/delivery/workspaces/${id(workspaceId)}/alerts?limit=${limit}`);
  return body.alerts ?? [];
}

export async function stats(workspaceId: string): Promise<RawStats> {
  const body = await call<{ stats?: RawStats }>(`/api/v1/delivery/workspaces/${id(workspaceId)}/stats`);
  return body.stats ?? {};
}

export async function researchDoc(workspaceId: string): Promise<string> {
  const body = await call<{ markdown?: string }>(`/api/v1/delivery/workspaces/${id(workspaceId)}/doc`);
  return body.markdown ?? "";
}
