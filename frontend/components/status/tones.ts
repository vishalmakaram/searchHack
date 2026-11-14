// The single place where a status is given a colour and a label.
// The colours themselves are tokens in app/globals.css.

import type { Delivery, Health, RunStatus, ScriptActivity, ScriptStatus, WorkspaceStatus } from "@/lib/types";

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
  succeeded: { tone: "green", label: "Succeeded" },
  invalid: { tone: "amber", label: "Invalid" },
  failed: { tone: "red", label: "Failed" },
};

export const WORKSPACE_STATUS: Record<WorkspaceStatus, Look> = {
  compiling: { tone: "blue", label: "Compiling" },
  awaiting_approval: { tone: "amber", label: "Awaiting approval" },
  ready: { tone: "green", label: "Ready" },
};

export const HEALTH: Record<Health, Look> = {
  ok: { tone: "green", label: "Healthy" },
  busy: { tone: "blue", label: "Busy" },
  attention: { tone: "amber", label: "Needs attention" },
  idle: { tone: "grey", label: "Idle" },
};

export const SIGNATURE: Record<Delivery["signature"], Look> = {
  not_checked: { tone: "grey", label: "Not checked" },
  valid: { tone: "green", label: "Valid" },
  invalid: { tone: "red", label: "Invalid" },
};
