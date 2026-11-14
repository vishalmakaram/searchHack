// Shared setup for the lib/server unit tests. Not imported by app code.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";
import type { RawWorkspace } from "@/lib/backend/runtime";
import type { Run, ScriptRecord, ScriptStatus, Webhook } from "@/lib/types";
import { now, setNow } from "./clock";
import { newId } from "./ids";
import { emptyDb, mutate, setDbPath, type Db } from "./store";

export const T0 = new Date("2026-11-14T12:00:00.000Z");

/** Each test gets its own db file in a temp directory and a clock frozen at T0. */
export function useTestStore(): { dir: () => string } {
  let dir = "";
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "sentinel-test-"));
    setDbPath(path.join(dir, "db.json"));
    setNow(T0);
  });
  afterEach(async () => {
    setNow(null);
    setDbPath(null);
    await rm(dir, { recursive: true, force: true });
  });
  return { dir: () => dir };
}

export function advance(ms: number): void {
  setNow(new Date(now().getTime() + ms));
}

/** Replaces the whole db with `contents` (missing collections become empty). */
export async function setDb(contents: Partial<Db>): Promise<void> {
  await mutate((db) => {
    Object.assign(db, emptyDb(), contents);
  });
}

/** A workspace as the runtime describes it. Defaults to one whose build finished a minute ago. */
export function rawWorkspace(id = "ws_test000001", status: RawWorkspace["status"] = {}): RawWorkspace {
  const built = T0.getTime() / 1000 - 60;
  return {
    id,
    memory: "# Memory: Acme Cloud pricing\n",
    status: {
      status: "ready",
      query: "Tell me when Acme Cloud changes its prices",
      created_at: built - 90,
      built_at: built,
      sample: "https://acme.example/pricing",
      build: { ok: true, steps: [], verify: { ok: true, duration_ms: 120, output: { keep: true, processed: "Team plan 59 EUR" } } },
      ...status,
    },
  };
}

export function makeRecord(id: string, status: ScriptStatus, overrides: Partial<ScriptRecord> = {}): ScriptRecord {
  const at = new Date(T0.getTime() - 30_000).toISOString();
  return {
    id,
    name: "Tell me when Acme Cloud changes its prices",
    status,
    deployedAt: status === "developed" ? null : at,
    statusChangedAt: status === "developed" ? null : at,
    ...overrides,
  };
}

export function makeWebhook(scriptIds: string[], overrides: Partial<Webhook> = {}): Webhook {
  return {
    id: newId("wh"),
    name: "Test webhook",
    secret: null,
    enabled: true,
    scriptIds,
    createdAt: new Date(T0.getTime() - 60_000).toISOString(),
    ...overrides,
  };
}

export function makeRun(scriptId: string, overrides: Partial<Run> = {}): Run {
  return {
    id: newId("run"),
    scriptId,
    scriptName: "Test script",
    source: "manual",
    webhookId: null,
    deliveryId: null,
    url: "https://acme.example/pricing",
    queuedAt: new Date(T0.getTime() - 10_000).toISOString(),
    startedAt: null,
    finishedAt: null,
    status: "queued",
    summary: null,
    error: null,
    pages: [],
    ...overrides,
  };
}

/** A script in `status` (stored switch only) and a webhook routed to it. */
export async function setupPipeline(status: ScriptStatus = "active", webhook: Partial<Webhook> = {}) {
  const raw = rawWorkspace();
  const record = makeRecord(raw.id, status);
  const hook = makeWebhook([raw.id], webhook);
  await setDb({ scripts: [record], webhooks: [hook] });
  return { raw, record, webhook: hook };
}

export function jsonHeaders(webhookType?: string): Headers {
  const headers = new Headers({ "content-type": "application/json" });
  if (webhookType) headers.set("Telem-Webhook-Type", webhookType);
  return headers;
}
