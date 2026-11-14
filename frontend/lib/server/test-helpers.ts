// Shared setup for the lib/server unit tests. Not imported by app code.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";
import type { Script, ScriptStatus, Webhook, Workspace } from "@/lib/types";
import { now, setNow } from "./clock";
import { newId } from "./ids";
import { buildScript } from "./mock-compiler";
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

export function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  const createdAt = overrides.createdAt ?? new Date(T0.getTime() - 60_000).toISOString();
  return {
    id: newId("ws"),
    name: "Test workspace",
    intent: "Tell me when Acme Cloud changes its prices.",
    queries: [{ id: newId("q"), text: "Acme Cloud pricing" }],
    frequency: "1d",
    escalationProviders: ["brave"],
    extractionSchema: { vendor: "string — company", new_price: "number — price" },
    scriptId: null,
    createdAt,
    compileReadyAt: new Date(Date.parse(createdAt) + 4000).toISOString(),
    approvedAt: null,
    ...overrides,
  };
}

export function makeScript(workspace: Workspace, status: ScriptStatus, overrides: Partial<Script> = {}): Script {
  const built = buildScript(workspace, { at: new Date(T0.getTime() - 60_000) });
  return {
    ...built,
    status,
    deployedAt: status === "developed" ? null : built.createdAt,
    ...overrides,
  };
}

export function makeWebhook(scriptIds: string[], overrides: Partial<Webhook> = {}): Webhook {
  return {
    id: newId("wh"),
    name: "Test webhook",
    secret: "whsec_test",
    enabled: true,
    scriptIds,
    createdAt: new Date(T0.getTime() - 60_000).toISOString(),
    ...overrides,
  };
}

/** One workspace with one script in `status`, and a webhook routed to it. */
export async function setupPipeline(status: ScriptStatus = "active") {
  const workspace = makeWorkspace({ approvedAt: new Date(T0.getTime() - 30_000).toISOString() });
  const script = makeScript(workspace, status);
  workspace.scriptId = script.id;
  const webhook = makeWebhook([script.id]);
  await setDb({ workspaces: [workspace], scripts: [script], webhooks: [webhook] });
  return { workspace, script, webhook };
}

export function jsonHeaders(webhookType?: string): Headers {
  const headers = new Headers({ "content-type": "application/json" });
  if (webhookType) headers.set("Telem-Webhook-Type", webhookType);
  return headers;
}
