// The main page's picture of the pipeline: Ingest -> Dispatch -> Processing -> Results.
//
// Stage health, judged over the last hour:
//   attention  the stage saw failures (results: any failed or invalid run;
//              ingest: any delivery with an invalid signature)
//   busy       the stage has work in flight (ingest: a delivery in the last
//              10 s; dispatch: queued runs; processing: running runs)
//   idle       nothing happened in the last hour
//   ok         otherwise
// The overall health is the worst stage: attention > busy > ok > idle.

import type { Health, Overview, RunView, ScriptStatus, StageKey } from "@/lib/types";
import { now } from "./clock";
import { isProblem, runViews } from "./runtime";
import { read } from "./store";
import { ago, HOUR, ms, newestFirst, SECOND } from "./util";

/** A delivery this recent counts as Ingest being busy. */
export const INGEST_BUSY_MS = 10 * SECOND;
export const RECENT_LIMIT = 10;

const HEALTH_RANK: Record<Health, number> = { idle: 0, ok: 1, busy: 2, attention: 3 };

export function worstHealth(healths: Health[]): Health {
  return healths.reduce<Health>((worst, h) => (HEALTH_RANK[h] > HEALTH_RANK[worst] ? h : worst), "idle");
}

export async function getOverview(): Promise<Overview> {
  const db = await read();
  const at = now();
  const t = at.getTime();
  const hourAgo = t - HOUR;
  const inLastHour = (timestamp: string) => ms(timestamp) >= hourAgo && ms(timestamp) <= t;

  const runs = runViews(db, at);
  const deliveries = newestFirst(db.deliveries, (d) => d.receivedAt).filter((d) => ms(d.receivedAt) <= t);

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
      { label: "Runs created (1h)", value: count(hourRuns.length) },
      { label: "Skipped (1h)", value: count(sum(hourDeliveries.map((d) => d.skipped.length))) },
      { label: "Duplicates (1h)", value: count(sum(hourDeliveries.map((d) => d.duplicateCount))) },
    ],
  });

  // Processing
  const running = runs.filter((r) => r.status === "running");
  const finishedLastHour = runs.filter((r) => r.durationMs !== null && inLastHour(r.finishesAt));
  const processing = stage("processing", "Processing", {
    attention: false,
    busy: running.length > 0,
    active: runs.some((r) => r.status !== "queued" && inLastHour(r.startsAt)),
    metrics: [
      { label: "Running", value: count(running.length) },
      { label: "Queued", value: count(queued.length) },
      { label: "Avg duration (1h)", value: averageDuration(finishedLastHour) },
    ],
  });

  // Results
  const by = (status: RunView["status"]) => finishedLastHour.filter((r) => r.status === status).length;
  const results = stage("results", "Results", {
    attention: finishedLastHour.some((r) => isProblem(r.status)),
    busy: false,
    active: finishedLastHour.length > 0,
    metrics: [
      { label: "Succeeded (1h)", value: count(by("succeeded")) },
      { label: "Invalid (1h)", value: count(by("invalid")) },
      { label: "Failed (1h)", value: count(by("failed")) },
    ],
  });

  const stages = [ingest, dispatch, processing, results];
  const scriptCounts: Record<ScriptStatus, number> = { developed: 0, active: 0, inactive: 0 };
  for (const script of db.scripts) scriptCounts[script.status]++;

  return {
    health: worstHealth(stages.map((s) => s.health)),
    stages,
    scriptCounts,
    runsInFlight: runs.filter((r) => r.status === "queued" || r.status === "running"),
    recentDeliveries: deliveries.slice(0, RECENT_LIMIT),
    recentProblems: newestFirst(
      runs.filter((r) => isProblem(r.status)),
      (r) => r.finishesAt,
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
  if (runs.length === 0) return "—";
  const mean = sum(runs.map((r) => r.durationMs ?? 0)) / runs.length;
  return `${(mean / 1000).toFixed(1)} s`;
}
