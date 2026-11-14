import { describe, expect, it } from "vitest";
import { receive } from "./ingest";
import { listRuns } from "./runtime";
import { read } from "./store";
import {
  advance,
  jsonHeaders,
  makeScript,
  makeWebhook,
  makeWorkspace,
  setDb,
  setupPipeline,
  useTestStore,
} from "./test-helpers";

function changesBody(changes: Record<string, unknown>[]) {
  return JSON.stringify({ type: "agent.changes", monitor_id: "mon_1", changes, next_cursor: "c", watermark: "w" });
}

describe("ingest.receive", () => {
  useTestStore();

  it("turns an agent.changes body into one event and one run per change", async () => {
    const { webhook, script, workspace } = await setupPipeline("active");
    const raw = changesBody([
      { seq: 1, kind: "value_changed", url: "https://a.example", page_text: "Vendor: Acme" },
      { seq: 2, kind: "alert", url: "https://b.example", text: "second" },
      { seq: 3, url: "https://c.example" },
    ]);
    const delivery = await receive(webhook.id, jsonHeaders("agent.changes"), raw);

    expect(delivery).toMatchObject({
      webhookId: webhook.id,
      webhookType: "agent.changes",
      signature: "not_checked",
      isTest: false,
      bodyBytes: Buffer.byteLength(raw),
      eventCount: 3,
      duplicateCount: 0,
      skipped: [],
    });
    expect(delivery.id).toMatch(/^dlv_/);
    expect(delivery.body).toEqual(JSON.parse(raw));
    expect(delivery.runIds).toHaveLength(3);

    const db = await read();
    expect(db.deliveries.map((d) => d.id)).toEqual([delivery.id]);
    const runs = db.runs.filter((r) => delivery.runIds.includes(r.id));
    expect(runs.map((r) => r.scriptId)).toEqual([script.id, script.id, script.id]);
    expect(runs.map((r) => r.event.seq)).toEqual([1, 2, 3]);
    expect(runs.map((r) => r.event.kind)).toEqual(["value_changed", "alert", "entity_added"]);
    expect(runs.map((r) => r.event.url)).toEqual(["https://a.example", "https://b.example", "https://c.example"]);
    expect(runs[1].event.page_text).toBe("second");
    expect(runs.every((r) => r.event.workspace_id === workspace.id)).toBe(true);
    expect(runs.every((r) => r.event.received_at === delivery.receivedAt)).toBe(true);
  });

  it("treats a body of unknown shape as a single event, never rejecting it", async () => {
    const { webhook } = await setupPipeline("active");
    const raw = JSON.stringify({ anything: ["goes", 1, null], nested: { deep: true } });
    const delivery = await receive(webhook.id, jsonHeaders(), raw);
    expect(delivery.webhookType).toBe("unknown");
    expect(delivery.eventCount).toBe(1);
    expect(delivery.runIds).toHaveLength(1);
    const [run] = await listRuns();
    expect(run.event).toMatchObject({ seq: 0, kind: "entity_added", url: "", telem_run_id: "", page_text: raw });
  });

  it("stores a non-JSON body as the raw string, as one event", async () => {
    const { webhook } = await setupPipeline("active");
    const delivery = await receive(webhook.id, new Headers(), "plain text, not json");
    expect(delivery.body).toBe("plain text, not json");
    expect(delivery.eventCount).toBe(1);
  });

  it("treats vendor.items as one event whatever its shape", async () => {
    const { webhook } = await setupPipeline("active");
    const raw = JSON.stringify({ type: "vendor.items", changes: [{ seq: 1 }, { seq: 2 }], items: [1, 2, 3] });
    const delivery = await receive(webhook.id, jsonHeaders("vendor.items"), raw);
    expect(delivery.webhookType).toBe("vendor.items");
    expect(delivery.eventCount).toBe(1);
  });

  it("falls back to the body's type when the header is missing", async () => {
    const { webhook } = await setupPipeline("active");
    const delivery = await receive(webhook.id, jsonHeaders(), changesBody([{ seq: 1 }, { seq: 2 }]));
    expect(delivery.webhookType).toBe("agent.changes");
    expect(delivery.eventCount).toBe(2);
  });

  it("drops a seq this webhook has already seen", async () => {
    const { webhook } = await setupPipeline("active");
    await receive(webhook.id, jsonHeaders("agent.changes"), changesBody([{ seq: 10 }, { seq: 11 }]));
    const again = await receive(webhook.id, jsonHeaders("agent.changes"), changesBody([{ seq: 11 }, { seq: 12 }]));
    expect(again).toMatchObject({ eventCount: 2, duplicateCount: 1 });
    expect(again.runIds).toHaveLength(1);
    expect((await listRuns({ deliveryId: again.id })).map((r) => r.event.seq)).toEqual([12]);
  });

  it("drops a seq repeated inside one delivery", async () => {
    const { webhook } = await setupPipeline("active");
    const delivery = await receive(
      webhook.id,
      jsonHeaders("agent.changes"),
      changesBody([{ seq: 5 }, { seq: 5 }, { seq: "6" }]),
    );
    expect(delivery).toMatchObject({ eventCount: 3, duplicateCount: 1 });
    expect(delivery.runIds).toHaveLength(2);
  });

  it("tracks seq per webhook", async () => {
    const { webhook, script } = await setupPipeline("active");
    const other = makeWebhook([script.id]);
    const db = await read();
    await setDb({ ...db, webhooks: [...db.webhooks, other] });
    await receive(webhook.id, jsonHeaders("agent.changes"), changesBody([{ seq: 1 }]));
    const delivery = await receive(other.id, jsonHeaders("agent.changes"), changesBody([{ seq: 1 }]));
    expect(delivery.duplicateCount).toBe(0);
  });

  it("never treats an event without a numeric seq as a duplicate", async () => {
    const { webhook } = await setupPipeline("active");
    const raw = JSON.stringify({ hello: "world" });
    await receive(webhook.id, jsonHeaders(), raw);
    const second = await receive(webhook.id, jsonHeaders(), raw);
    expect(second.duplicateCount).toBe(0);
    expect(second.runIds).toHaveLength(1);
  });

  it("skips scripts that are not active, with the reason, and runs the active ones", async () => {
    const workspace = makeWorkspace();
    const active = makeScript(workspace, "active");
    const developed = makeScript(workspace, "developed");
    const inactive = makeScript(workspace, "inactive");
    const webhook = makeWebhook([developed.id, active.id, inactive.id]);
    await setDb({ workspaces: [workspace], scripts: [active, developed, inactive], webhooks: [webhook] });

    const delivery = await receive(webhook.id, jsonHeaders("agent.changes"), changesBody([{ seq: 1 }, { seq: 2 }]));
    expect(delivery.skipped).toEqual([
      { scriptId: developed.id, reason: "script_not_active" },
      { scriptId: inactive.id, reason: "script_not_active" },
    ]);
    expect(delivery.runIds).toHaveLength(2);
    const runs = await listRuns({ deliveryId: delivery.id });
    expect(runs.every((r) => r.scriptId === active.id)).toBe(true);
  });

  it("creates a run for every event and every active script", async () => {
    const one = makeWorkspace();
    const two = makeWorkspace();
    const a = makeScript(one, "active");
    const b = makeScript(two, "active");
    const webhook = makeWebhook([a.id, b.id]);
    await setDb({ workspaces: [one, two], scripts: [a, b], webhooks: [webhook] });

    const delivery = await receive(webhook.id, jsonHeaders("agent.changes"), changesBody([{ seq: 1 }, { seq: 2 }]));
    const runs = await listRuns({ deliveryId: delivery.id });
    expect(runs).toHaveLength(4);
    expect(runs.find((r) => r.scriptId === b.id)?.event.workspace_id).toBe(two.id);
  });

  it("records a delivery with no runs when nothing is routed", async () => {
    const { workspace } = await setupPipeline("active");
    const webhook = makeWebhook([]);
    await setDb({ workspaces: [workspace], webhooks: [webhook] });
    const delivery = await receive(webhook.id, jsonHeaders(), "{}");
    expect(delivery).toMatchObject({ eventCount: 1, runIds: [], skipped: [] });
  });

  it("runs move from queued to running to finished as the clock moves", async () => {
    const { webhook } = await setupPipeline("active");
    const delivery = await receive(webhook.id, jsonHeaders(), "{}");
    expect((await listRuns({ deliveryId: delivery.id }))[0].status).toBe("queued");
    advance(2000);
    expect((await listRuns({ deliveryId: delivery.id }))[0].status).toBe("running");
    advance(6000);
    expect(["succeeded", "invalid", "failed"]).toContain((await listRuns({ deliveryId: delivery.id }))[0].status);
  });

  it("marks test deliveries", async () => {
    const { webhook } = await setupPipeline("active");
    expect((await receive(webhook.id, jsonHeaders(), "{}", { isTest: true })).isTest).toBe(true);
  });

  it("404s an unknown webhook, 403s a disabled one, 413s an oversized body", async () => {
    const { workspace, script } = await setupPipeline("active");
    const disabled = makeWebhook([script.id], { enabled: false });
    await setDb({ workspaces: [workspace], scripts: [script], webhooks: [disabled] });

    await expect(receive("wh_missing", jsonHeaders(), "{}")).rejects.toMatchObject({ status: 404 });
    await expect(receive(disabled.id, jsonHeaders(), "{}")).rejects.toMatchObject({ status: 403 });
    await expect(receive(disabled.id, jsonHeaders(), "x".repeat(1024 * 1024 + 1))).rejects.toMatchObject({
      status: 413,
    });
    expect((await read()).deliveries).toHaveLength(0);
  });
});
