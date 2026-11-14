// The single place where a status is given a colour and a label.
// The colours themselves are tokens in app/globals.css.

import type { Health, RunStatus, ScriptActivity, ScriptStatus, SignatureCheck, WorkspaceStatus } from "@/lib/types";

export type Tone = "green" | "blue" | "amber" | "red" | "grey";

interface Look {
  tone: Tone;
  label: string;
}

export const SCRIPT_STATUS: Record<ScriptStatus, Look> = {
  active: { tone: "green", label: "Active" },
  inactive: { tone: "grey", label: "Inactive" },
  developed: { tone: "blue", label: "Developed" },
};

export const SCRIPT_ACTIVITY: Record<ScriptActivity, Look> = {
  off: { tone: "grey", label: "Off" },
  idle: { tone: "grey", label: "Idle" },
  processing: { tone: "blue", label: "Processing" },
  failing: { tone: "red", label: "Failing" },
};

export const RUN_STATUS: Record<RunStatus, Look> = {
  queued: { tone: "grey", label: "Queued" },
  running: { tone: "blue", label: "Running" },
  delivered: { tone: "green", label: "Delivered" },
  dropped: { tone: "grey", label: "Dropped" },
  unchanged: { tone: "grey", label: "Unchanged" },
  failed: { tone: "red", label: "Failed" },
};

export const WORKSPACE_STATUS: Record<WorkspaceStatus, Look> = {
  building: { tone: "blue", label: "Building" },
  ready: { tone: "green", label: "Ready" },
  failed: { tone: "red", label: "Build failed" },
  interrupted: { tone: "amber", label: "Interrupted" },
  output_only: { tone: "grey", label: "Results only" },
};

export const HEALTH: Record<Health, Look> = {
  ok: { tone: "green", label: "Healthy" },
  busy: { tone: "blue", label: "Busy" },
  attention: { tone: "amber", label: "Needs attention" },
  idle: { tone: "grey", label: "Idle" },
};

export const SIGNATURE: Record<SignatureCheck, Look> = {
  not_checked: { tone: "grey", label: "Not checked" },
  valid: { tone: "green", label: "Valid" },
  invalid: { tone: "red", label: "Invalid" },
};

/** The live event stream's connection. */
export const STREAM: Record<"connecting" | "live" | "offline", Look> = {
  connecting: { tone: "grey", label: "Connecting" },
  live: { tone: "green", label: "Live" },
  offline: { tone: "amber", label: "Offline" },
};

/** How much an alert matters, as the output service rated it. */
export function impactLook(impact: string): Look {
  switch (impact.toLowerCase()) {
    case "high":
    case "critical":
      return { tone: "red", label: "High" };
    case "medium":
      return { tone: "amber", label: "Medium" };
    case "low":
      return { tone: "grey", label: "Low" };
    default:
      return { tone: "grey", label: impact || "Unrated" };
  }
}
