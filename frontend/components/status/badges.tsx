import { Check, Clock, LoaderCircle, TriangleAlert, X } from "lucide-react";
import type { Delivery, Health, RunStatus, ScriptActivity, ScriptStatus, WorkspaceStatus } from "@/lib/types";
import { cn } from "@/lib/cn";
import { StatusPill } from "./status-pill";
import { HEALTH, RUN_STATUS, SCRIPT_ACTIVITY, SCRIPT_STATUS, SIGNATURE, WORKSPACE_STATUS } from "./tones";

const spinner = <LoaderCircle className="animate-spin" />;

/** The stored lifecycle state of a script: developed, active or inactive. */
export function ScriptStatusBadge({ status }: { status: ScriptStatus }) {
  const look = SCRIPT_STATUS[status];
  return <StatusPill tone={look.tone} label={look.label} />;
}

/** What a script is doing right now. Shown lighter than its status. */
export function ScriptActivityBadge({ activity }: { activity: ScriptActivity }) {
  const look = SCRIPT_ACTIVITY[activity];
  return (
    <StatusPill
      variant="plain"
      tone={look.tone}
      label={look.label}
      icon={activity === "processing" ? spinner : activity === "failing" ? <TriangleAlert /> : undefined}
    />
  );
}

const RUN_ICONS: Record<RunStatus, React.ReactNode> = {
  queued: <Clock />,
  running: spinner,
  succeeded: <Check />,
  invalid: <TriangleAlert />,
  failed: <X />,
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const look = RUN_STATUS[status];
  return <StatusPill tone={look.tone} label={look.label} icon={RUN_ICONS[status]} />;
}

export function WorkspaceStatusBadge({ status }: { status: WorkspaceStatus }) {
  const look = WORKSPACE_STATUS[status];
  return <StatusPill tone={look.tone} label={look.label} icon={status === "compiling" ? spinner : undefined} />;
}

export function HealthBadge({ health }: { health: Health }) {
  const look = HEALTH[health];
  return <StatusPill tone={look.tone} label={look.label} live={health === "busy"} />;
}

/** Just the coloured mark for a health state. Pair it with visible text. */
export function HealthDot({ health, className }: { health: Health; className?: string }) {
  return (
    <span
      data-tone={HEALTH[health].tone}
      className={cn("inline-block size-2 shrink-0 rounded-full bg-tone-dot", health === "busy" && "animate-pulse-dot", className)}
      aria-hidden
    />
  );
}

export function SignatureBadge({ signature }: { signature: Delivery["signature"] }) {
  const look = SIGNATURE[signature];
  return <StatusPill variant="plain" tone={look.tone} label={look.label} />;
}

export function EnabledBadge({ enabled }: { enabled: boolean }) {
  return <StatusPill tone={enabled ? "green" : "grey"} label={enabled ? "Enabled" : "Disabled"} />;
}
