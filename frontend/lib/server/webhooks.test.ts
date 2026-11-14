import { describe, expect, it } from "vitest";
import { receive } from "./ingest";
import { listRuns } from "./runtime";
import { read } from "./store";
import { advance, jsonHeaders, makeScript, setDb, setupPipeline, useTestStore } from "./test-helpers";
import {
  createWebhook,
  deleteWebhook,
  getWebhook,
  listDeliveries,
  listWebhooks,
  sendTestEvent,
  updateWebhook,
} from "./webhooks";

const BASE = "http://localhost:3000";

describe("webhooks", () => {
  useTestStore();

  it("creates a webhook with a secret and its public URL", async () => {
    const { script } = await setupPipeline("active");
    const view = await createWebhook({ name: "  Telem prod ", scriptIds: [script.id, script.id] }, `${BASE}/`);
    expect(view).toMatchObject({
      name: "Telem prod",
      enabled: true,
      scriptIds: [script.id],
      url: `${BASE}/api/hooks/${view.id}`,
      deliveryCount: 0,
      lastDeliveryAt: null,
    });
    expect(view.id).toMatch(/^wh_[0-9a-z]{12}$/);
    expect(view.secret).toMatch(/^whsec_[0-9a-z]{32}$/);
    expect((await listWebhooks(BASE)).map((w) => w.id)).toContain(view.id);
  });

  it("rejects unknown scripts and empty names", async () => {
    await setupPipeline("active");
    await expect(createWebhook({ name: "x", scriptIds: ["scr_nope"] }, BASE)).rejects.toMatchObject({ status: 400 });
    await expect(createWebhook({ name: " ", scriptIds: [] }, BASE)).rejects.toMatchObject({ status: 400 });
  });

  it("allows a webhook with no targets", async () => {
    await setupPipeline("active");
    await expect(createWebhook({ name: "Unrouted", scriptIds: [] }, BASE)).resolves.toMatchObject({ scriptIds: [] });
  });

  it("edits name, enabled and routing", async () => {
    const { webhook, workspace, script } = await setupPipeline("active");
    const second = makeScript(workspace, "developed");
    const db = await read();
    await setDb({ ...db, scripts: [...db.scripts, second] });

    const updated = await updateWebhook(webhook.id, { name: "Renamed", enabled: false, scriptIds: [second.id] }, BASE);
    expect(updated).toMatchObject({ name: "Renamed", enabled: false, scriptIds: [second.id] });
    await expect(updateWebhook(webhook.id, { scriptIds: ["scr_nope"] }, BASE)).rejects.toMatchObject({ status: 400 });
    await expect(updateWebhook("wh_missing", { name: "x" }, BASE)).rejects.toMatchObject({ status: 404 });
    expect((await getWebhook(webhook.id, BASE)).scriptIds).toEqual([second.id]);
    expect(script.id).not.toBe(second.id);
  });

  it("counts deliveries and lists them newest first", async () => {
    const { webhook } = await setupPipeline("active");
    const first = await receive(webhook.id, jsonHeaders(), "{}");
    advance(1000);
    const second = await receive(webhook.id, jsonHeaders(), "{}");

    const view = await getWebhook(webhook.id, BASE);
    expect(view.deliveryCount).toBe(2);
    expect(view.lastDeliveryAt).toBe(second.receivedAt);
    expect((await listDeliveries(webhook.id)).map((d) => d.id)).toEqual([second.id, first.id]);
    expect(await listDeliveries(webhook.id, 1)).toHaveLength(1);
    await expect(listDeliveries("wh_missing")).rejects.toMatchObject({ status: 404 });
  });

  it("deleting removes its deliveries but keeps the runs", async () => {
    const { webhook } = await setupPipeline("active");
    const delivery = await receive(webhook.id, jsonHeaders(), "{}");
    await deleteWebhook(webhook.id);
    const db = await read();
    expect(db.webhooks).toHaveLength(0);
    expect(db.deliveries).toHaveLength(0);
    expect(db.runs.map((r) => r.id)).toEqual(delivery.runIds);
    await expect(getWebhook(webhook.id, BASE)).rejects.toMatchObject({ status: 404 });
    await expect(deleteWebhook(webhook.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("sendTestEvent", () => {
  useTestStore();

  it("sends a sample agent.changes delivery through ingest", async () => {
    const { webhook, script } = await setupPipeline("active");
    const delivery = await sendTestEvent(webhook.id);
    expect(delivery).toMatchObject({
      webhookId: webhook.id,
      webhookType: "agent.changes",
      isTest: true,
      eventCount: 1,
      duplicateCount: 0,
    });
    expect(delivery.runIds).toHaveLength(1);

    advance(10_000);
    const [run] = await listRuns({ deliveryId: delivery.id });
    expect(run.scriptId).toBe(script.id);
    if (run.status === "succeeded") {
      // The sample page is written so the mock runtime extracts every schema field.
      expect(run.result?.extracted).toEqual({ vendor: "Acme Cloud", new_price: 59 });
    }
  });

  it("uses a fresh seq every time, above any real one", async () => {
    const { webhook } = await setupPipeline("active");
    await receive(
      webhook.id,
      jsonHeaders("agent.changes"),
      JSON.stringify({ type: "agent.changes", changes: [{ seq: 900 }] }),
    );
    const [a, b] = await Promise.all([sendTestEvent(webhook.id), sendTestEvent(webhook.id)]);
    expect(a.duplicateCount + b.duplicateCount).toBe(0);
    const seqs = [a, b].map((d) => (d.body as { changes: { seq: number }[] }).changes[0].seq).sort();
    expect(seqs).toEqual([901, 902]);
  });

  it("records a skip when the target is not active", async () => {
    const { webhook, script } = await setupPipeline("inactive");
    const delivery = await sendTestEvent(webhook.id);
    expect(delivery.runIds).toEqual([]);
    expect(delivery.skipped).toEqual([{ scriptId: script.id, reason: "script_not_active" }]);
  });

  it("403s a disabled webhook and 404s an unknown one", async () => {
    const { webhook } = await setupPipeline("active");
    await updateWebhook(webhook.id, { enabled: false }, BASE);
    await expect(sendTestEvent(webhook.id)).rejects.toMatchObject({ status: 403 });
    await expect(sendTestEvent("wh_missing")).rejects.toMatchObject({ status: 404 });
  });
});
