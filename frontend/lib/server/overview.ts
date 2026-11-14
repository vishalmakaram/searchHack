// The main page's picture of the pipeline: Ingest -> Dispatch -> Processing -> Delivery.
//
// Stage health, judged over the last hour:
//   attention  the stage saw failures (delivery: any failed run; ingest: any
//              delivery with a wrong signature)
//   busy       the stage has work in flight (ingest: a delivery in the last
//              10 s; dispatch: queued runs; processing: a running run)
//   idle       nothing happened in the last hour
//   ok         otherwise
// The overall health is the worst stage, or "attention" when one of the two
// Python services cannot be reached.

import { outputUrl, runtimeUrl } from "@/lib/backend/config";
import * as output from "@/lib/backend/output";
import * as runtime from "@/lib/backend/runtime";
import type { RawWorkspace } from "@/lib/backend/runtime";
import type { Channel, Health, Overview, RunView, ScriptStatus, StageKey } from "@/lib/types";
import { now } from "./clock";
import { isFinished, settleRuns, toRunView } from "./runs";
import { hasScript } from "./scripts";
import { read } from "./store";
import { ago, HOUR, ms, newestFirst, SECOND } from "./util";
import { loadRawWorkspaces, sortWorkspaces, toWorkspaceView } from "./workspaces";

/** A delivery this recent counts as Ingest being busy. */
export const INGEST_BUSY_MS = 10 * SECOND;
export const RECENT_LIMIT = 10;

const HEALTH_RANK: Record<Health, number> = { idle: 0, ok: 1, busy: 2, attention: 3 };

export function worstHealth(healths: Health[]): Health {
  return healths.reduce<Health>((worst, h) => (HEALTH_RANK[h] > HEALTH_RANK[worst] ? h : worst), "idle");
}

async function channels(): Promise<Channel[] | null> {
  try {
    const caps = await output.capabilities();
    return (caps.outputs ?? [])
      .filter((o): o is { name: string; configured?: boolean } => typeof o.name === "string" && o.name !== "")
      .map((o) => ({ name: o.name, configured: o.configured === true }));
  } catch {
    return null;
  }
}

async function workspaces(): Promise<RawWorkspace[] | null> {
  try {
    return await loadRawWorkspaces();
  } catch {
    return null;
  }
}

export async function getOverview(): Promise<Overview> {
  await settleRuns();
  const [db, raws, outputs, runtimeUp] = await Promise.all([read(), workspaces(), channels(), runtime.isUp()]);
  const at = now();
  const t = at.getTime();
  const hourAgo = t - HOUR;
  const inLastHour = (timestamp: string | null) => timestamp !== null && ms(timestamp) >= hourAgo;

  const runs = newestFirst(db.runs, (r) => r.queuedAt).map(toRunView);
  const deliveries = newestFirst(db.deliveries, (d) => d.receivedAt);

  // Ingest
  const hourDeliveries = deliveries.filter((d) => inLastHour(d.receivedAt));
  const ingest = stage("ingest", "Ingest", {
    attention: hourDeliveries.some((d) => d.signature === "invalid"),
    busy: deliveries.some((d) => t - ms(d.receivedAt) < INGEST_BUSY_MS),
    active: hourDeliveries.length > 0,
    metrics: [
      { label: "Deliveries (1h)", value: count(hourDeliveries.length) },
      { label: "Events (1h)", value: count(sum(hourDeliveries.map((d) => d.eventCount))) },
      { label: "Last delivery", value: ago(deliveries[0]?.receivedAt ?? null, at) },
    ],
  });

  // Dispatch
  const queued = runs.filter((r) => r.status === "queued");
  const hourRuns = runs.filter((r) => inLastHour(r.queuedAt));
  const dispatch = stage("dispatch", "Dispatch", {
    attention: false,
    busy: queued.length > 0,
    active: hourRuns.length > 0 || hourDeliveries.length > 0,
    metrics: [
      { label: "Runs queued (1h)", value: count(hourRuns.length) },
      { label: "Skipped (1h)", value: count(sum(hourDeliveries.map((d) => d.skipped.length + d.eventsWithoutUrl))) },
      { label: "Duplicates (1h)", value: count(sum(hourDeliveries.map((d) => d.duplicateCount))) },
    ],
  });

  // Processing
  const running = runs.filter((r) => r.status === "running");
  const finishedLastHour = runs.filter((r) => isFinished(r.status) && inLastHour(r.finishedAt));
  const processing = stage("processing", "Processing", {
    attention: false,
    busy: running.length > 0,
    active: runs.some((r) => inLastHour(r.startedAt)),
    metrics: [
      { label: "Running", value: count(running.length) },
      { label: "Waiting", value: count(queued.length) },
      { label: "Avg duration (1h)", value: averageDuration(finishedLastHour) },
    ],
  });

  // Delivery
  const by = (status: RunView["status"]) => finishedLastHour.filter((r) => r.status === status).length;
  const delivery = stage("delivery", "Delivery", {
    attention: by("failed") > 0,
    busy: false,
    active: finishedLastHour.length > 0,
    metrics: [
      { label: "Delivered (1h)", value: count(by("delivered")) },
      { label: "Nothing to send (1h)", value: count(by("dropped") + by("unchanged")) },
      { label: "Failed (1h)", value: count(by("failed")) },
    ],
  });

  const stages = [ingest, dispatch, processing, delivery];
  const scriptCounts: Record<ScriptStatus, number> = { developed: 0, active: 0, inactive: 0 };
  for (const raw of (raws ?? []).filter(hasScript)) {
    scriptCounts[db.scripts.find((s) => s.id === raw.id)?.status ?? "developed"]++;
  }

  const servicesUp = runtimeUp && outputs !== null;
  return {
    health: servicesUp ? worstHealth(stages.map((s) => s.health)) : "attention",
    services: [
      { key: "runtime", label: "Sentinel runtime", url: runtimeUrl(), up: runtimeUp },
      { key: "output", label: "Output service", url: outputUrl(), up: outputs !== null },
    ],
    channels: outputs ?? [],
    stages,
    scriptCounts,
    building: sortWorkspaces((raws ?? []).map((raw) => toWorkspaceView(raw, db))).filter((w) => w.status === "building"),
    runsInFlight: runs.filter((r) => !isFinished(r.status)).reverse(),
    recentDeliveries: deliveries.slice(0, RECENT_LIMIT),
    recentProblems: newestFirst(
      runs.filter((r) => r.status === "failed"),
      (r) => r.finishedAt ?? r.queuedAt,
    ).slice(0, RECENT_LIMIT),
  };
}

type Stage = Overview["stages"][number];

function stage(
  key: StageKey,
  label: string,
  signals: { attention: boolean; busy: boolean; active: boolean; metrics: Stage["metrics"] },
): Stage {
  const health: Health = signals.attention ? "attention" : signals.busy ? "busy" : signals.active ? "ok" : "idle";
  return { key, label, health, metrics: signals.metrics };
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function count(n: number): string {
  return n.toLocaleString("en-US");
}

function averageDuration(runs: RunView[]): string {
  const timed = runs.filter((r) => r.durationMs !== null);
  if (timed.length === 0) return "—";
  const seconds = sum(timed.map((r) => r.durationMs ?? 0)) / timed.length / 1000;
  return seconds < 90 ? `${seconds.toFixed(1)} s` : `${(seconds / 60).toFixed(1)} min`;
}
