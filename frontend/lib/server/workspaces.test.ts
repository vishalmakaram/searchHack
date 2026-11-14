import { describe, expect, it } from "vitest";
import type { ChangeEvent } from "@/lib/contracts";
import type { Workspace } from "@/lib/types";
import { createRun } from "./runtime";
import { read } from "./store";
import {
  advance,
  makeScript,
  makeWebhook,
  makeWorkspace,
  setDb,
  T0,
  useTestStore,
} from "./test-helpers";
import {
  approveWorkspace,
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  listWorkspaces,
  updateWorkspace,
  workspaceStatusAt,
} from "./workspaces";

describe("workspace status", () => {
  const ws: Workspace = makeWorkspace({
    createdAt: T0.toISOString(),
    compileReadyAt: new Date(T0.getTime() + 4000).toISOString(),
  });
  const at = (ms: number) => new Date(T0.getTime() + ms);

  it("is compiling until compileReadyAt, then awaiting approval", () => {
    expect(workspaceStatusAt(ws, at(0))).toBe("compiling");
    expect(workspaceStatusAt(ws, at(3999))).toBe("compiling");
    expect(workspaceStatusAt(ws, at(4000))).toBe("awaiting_approval");
  });

  it("is ready once approved", () => {
    expect(workspaceStatusAt({ ...ws, approvedAt: at(5000).toISOString() }, at(6000))).toBe("ready");
  });
});

describe("workspaces", () => {
  useTestStore();

  it("creates a compiling workspace with proposed queries and schema", async () => {
    await setDb({});
    const ws = await createWorkspace({ intent: "  Tell me when Acme Cloud changes its pricing.  " });
    expect(ws.status).toBe("compiling");
    expect(ws.id).toMatch(/^ws_[0-9a-z]{12}$/);
    expect(ws.intent).toBe("Tell me when Acme Cloud changes its pricing.");
    expect(ws.name).toBe("Acme Cloud changes its pricing");
    expect(ws.queries.length).toBeGreaterThanOrEqual(3);
    expect(ws.queries.length).toBeLessThanOrEqual(5);
    expect(ws.queries.every((q) => q.id.startsWith("q_"))).toBe(true);
    expect(ws.extractionSchema).toHaveProperty("new_price");
    expect(ws.scriptId).toBeNull();
    expect(ws.approvedAt).toBeNull();
    expect(ws.compileReadyAt).toBe(new Date(T0.getTime() + 4000).toISOString());

    advance(4000);
    expect((await getWorkspace(ws.id)).status).toBe("awaiting_approval");
  });

  it("rejects an empty intent", async () => {
    await expect(createWorkspace({ intent: "   " })).rejects.toMatchObject({ status: 400 });
  });

  it("lists newest first", async () => {
    await setDb({});
    const first = await createWorkspace({ intent: "first thing" });
    advance(1000);
    const second = await createWorkspace({ intent: "second thing" });
    expect((await listWorkspaces()).map((w) => w.id)).toEqual([second.id, first.id]);
  });

  it("approves: saves the queries, creates a developed script, sets scriptId and approvedAt", async () => {
    await setDb({});
    const ws = await createWorkspace({ intent: "Watch for new staff engineer jobs at Northwind" });
    await expect(approveWorkspace(ws.id, { queries: ["a"] })).rejects.toMatchObject({ status: 409 });

    advance(4000);
    const keptId = ws.queries[0].id;
    const approved = await approveWorkspace(ws.id, { queries: [ws.queries[0].text, "  extra   query ", "", "Extra query"] });
    expect(approved.status).toBe("ready");
    expect(approved.approvedAt).toBe(new Date(T0.getTime() + 4000).toISOString());
    expect(approved.queries.map((q) => q.text)).toEqual([ws.queries[0].text, "extra query"]);
    expect(approved.queries[0].id).toBe(keptId);

    const db = await read();
    expect(db.scripts).toHaveLength(1);
    const script = db.scripts[0];
    expect(approved.scriptId).toBe(script.id);
    expect(script).toMatchObject({
      workspaceId: ws.id,
      status: "developed",
      deployedAt: null,
      version: 1,
      extractionSchema: ws.extractionSchema,
    });
    expect(script.source).toContain("def process");

    await expect(approveWorkspace(ws.id, { queries: ["again"] })).rejects.toMatchObject({ status: 409 });
    expect((await read()).scripts).toHaveLength(1);
  });

  it("refuses to approve with no queries, or an unknown id", async () => {
    await setDb({});
    const ws = await createWorkspace({ intent: "anything" });
    advance(4000);
    await expect(approveWorkspace(ws.id, { queries: [] })).rejects.toMatchObject({ status: 400 });
    await expect(approveWorkspace(ws.id, { queries: ["  ", ""] })).rejects.toMatchObject({ status: 400 });
    await expect(approveWorkspace("ws_missing", { queries: ["a"] })).rejects.toMatchObject({ status: 404 });
  });

  it("edits name, queries and frequency before approval", async () => {
    await setDb({});
    const ws = await createWorkspace({ intent: "anything at all" });
    advance(4000);
    const updated = await updateWorkspace(ws.id, {
      name: "Renamed",
      queries: [ws.queries[1].text, "new one"],
      frequency: "12h",
    });
    expect(updated).toMatchObject({ name: "Renamed", frequency: "12h", status: "awaiting_approval" });
    expect(updated.queries.map((q) => q.text)).toEqual([ws.queries[1].text, "new one"]);
    expect(updated.queries[0].id).toBe(ws.queries[1].id);
  });

  it("freezes queries and frequency once approved, but not the name", async () => {
    await setDb({});
    const ws = await createWorkspace({ intent: "anything at all" });
    advance(4000);
    const approved = await approveWorkspace(ws.id, { queries: ["one", "two"] });

    await expect(updateWorkspace(ws.id, { queries: ["three"] })).rejects.toMatchObject({ status: 409 });
    await expect(updateWorkspace(ws.id, { frequency: approved.frequency === "1h" ? "6h" : "1h" })).rejects.toMatchObject({
      status: 409,
    });
    // Sending the unchanged values is not a change.
    await expect(
      updateWorkspace(ws.id, { queries: ["one", "two"], frequency: approved.frequency }),
    ).resolves.toMatchObject({ status: "ready" });
    await expect(updateWorkspace(ws.id, { name: "Still editable" })).resolves.toMatchObject({ name: "Still editable" });
  });

  it("validates edits", async () => {
    await setDb({});
    const ws = await createWorkspace({ intent: "anything at all" });
    await expect(updateWorkspace(ws.id, { name: " " })).rejects.toMatchObject({ status: 400 });
    await expect(updateWorkspace(ws.id, { queries: [] })).rejects.toMatchObject({ status: 400 });
    // @ts-expect-error: checking the runtime guard
    await expect(updateWorkspace(ws.id, { frequency: "2h" })).rejects.toMatchObject({ status: 400 });
    await expect(updateWorkspace("ws_missing", { name: "x" })).rejects.toMatchObject({ status: 404 });
  });

  it("deleting cascades to its scripts, their runs and webhook routing, but keeps deliveries", async () => {
    const doomed = makeWorkspace({ name: "Doomed" });
    const kept = makeWorkspace({ name: "Kept" });
    const doomedLive = makeScript(doomed, "active");
    const doomedOld = makeScript(doomed, "inactive");
    const keptScript = makeScript(kept, "active");
    doomed.scriptId = doomedLive.id;
    kept.scriptId = keptScript.id;
    const webhook = makeWebhook([doomedLive.id, keptScript.id, doomedOld.id]);
    const delivery = { id: "dlv_1", webhookId: webhook.id };
    const event: ChangeEvent = {
      workspace_id: "",
      seq: 1,
      kind: "entity_added",
      url: "",
      page_text: "",
      telem_run_id: "",
      received_at: T0.toISOString(),
    };
    const runs = [
      createRun(doomedLive, event, delivery),
      createRun(doomedOld, event, delivery),
      createRun(keptScript, event, delivery),
    ];
    const stored = {
      id: "dlv_1",
      webhookId: webhook.id,
      receivedAt: T0.toISOString(),
      webhookType: "unknown" as const,
      signature: "not_checked" as const,
      isTest: false,
      bodyBytes: 2,
      body: {},
      eventCount: 1,
      duplicateCount: 0,
      runIds: runs.map((r) => r.id),
      skipped: [],
    };
    await setDb({
      workspaces: [doomed, kept],
      scripts: [doomedLive, doomedOld, keptScript],
      webhooks: [webhook],
      deliveries: [stored],
      runs,
    });

    await deleteWorkspace(doomed.id);

    const db = await read();
    expect(db.workspaces.map((w) => w.id)).toEqual([kept.id]);
    expect(db.scripts.map((s) => s.id)).toEqual([keptScript.id]);
    expect(db.runs.map((r) => r.scriptId)).toEqual([keptScript.id]);
    expect(db.webhooks[0].scriptIds).toEqual([keptScript.id]);
    expect(db.deliveries).toHaveLength(1);

    await expect(getWorkspace(doomed.id)).rejects.toMatchObject({ status: 404 });
    await expect(deleteWorkspace(doomed.id)).rejects.toMatchObject({ status: 404 });
  });
});
