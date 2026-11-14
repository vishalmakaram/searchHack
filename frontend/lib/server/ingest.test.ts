import { describe, expect, it } from "vitest";
import { receive } from "./ingest";
import { read } from "./store";
import { jsonHeaders, makeRecord, makeWebhook, setDb, setupPipeline, T0, useTestStore } from "./test-helpers";
import { sign } from "./verify";

const changes = (...items: Record<string, unknown>[]) =>
  JSON.stringify({ type: "agent.changes", monitor_id: "mon_1", changes: items, next_cursor: "c", watermark: "w" });

describe("receive", () => {
  useTestStore();

  it("queues one run per event with a page address, for each active script", async () => {
    const { webhook, raw } = await setupPipeline("active");
    const delivery = await receive(
      webhook.id,
      jsonHeaders("agent.changes"),
      changes({ seq: 1, url: "https://a.example/1" }, { seq: 2, url: "https://a.example/2" }),
    );
    expect(delivery).toMatchObject({ webhookType: "agent.changes", eventCount: 2, duplicateCount: 0, eventsWithoutUrl: 0, signature: "not_checked" });
    expect(delivery.runIds).toHaveLength(2);

    const { runs } = await read();
    expect(runs.map((r) => r.url)).toEqual(["https://a.example/1", "https://a.example/2"]);
    expect(runs.every((r) => r.status === "queued" && r.source === "webhook" && r.scriptId === raw.id)).toBe(true);
    expect(runs.every((r) => r.deliveryId === delivery.id && r.webhookId === webhook.id)).toBe(true);
  });

  it("drops events whose seq it has already seen", async () => {
    const { webhook } = await setupPipeline("active");
    await receive(webhook.id, jsonHeaders("agent.changes"), changes({ seq: 1, url: "https://a.example/1" }));
    const again = await receive(
      webhook.id,
      jsonHeaders("agent.changes"),
      changes({ seq: 1, url: "https://a.example/1" }, { seq: 2, url: "https://a.example/2" }),
    );
    expect(again).toMatchObject({ eventCount: 2, duplicateCount: 1 });
    expect(again.runIds).toHaveLength(1);
  });

  it("records a script that is not active as skipped, once", async () => {
    for (const status of ["developed", "inactive"] as const) {
      const { webhook, raw } = await setupPipeline(status);
      const delivery = await receive(
        webhook.id,
        jsonHeaders("agent.changes"),
        changes({ seq: 1, url: "https://a.example/1" }, { seq: 2, url: "https://a.example/2" }),
      );
      expect(delivery.runIds).toEqual([]);
      expect(delivery.skipped).toEqual([{ scriptId: raw.id, reason: "script_not_active" }]);
    }
  });

  it("treats a routed script with no stored switch as not active", async () => {
    const webhook = makeWebhook(["ws_never_deployed"]);
    await setDb({ webhooks: [webhook] });
    const delivery = await receive(webhook.id, jsonHeaders("agent.changes"), changes({ seq: 1, url: "https://a.example/1" }));
    expect(delivery.skipped).toEqual([{ scriptId: "ws_never_deployed", reason: "script_not_active" }]);
  });

  it("counts events without a usable address and runs nothing for them", async () => {
    const { webhook } = await setupPipeline("active");
    const delivery = await receive(
      webhook.id,
      jsonHeaders("agent.changes"),
      changes({ seq: 1, kind: "value_changed" }, { seq: 2, url: "ftp://a.example/x" }, { seq: 3, entity: { url: "https://a.example/3" } }),
    );
    expect(delivery.eventsWithoutUrl).toBe(2);
    expect(delivery.runIds).toHaveLength(1);
    expect((await read()).runs[0].url).toBe("https://a.example/3");
  });

  it("stores any other body as one event and never rejects its shape", async () => {
    const { webhook } = await setupPipeline("active");
    const text = await receive(webhook.id, new Headers(), "not json at all");
    expect(text).toMatchObject({ webhookType: "unknown", eventCount: 1, eventsWithoutUrl: 1, body: "not json at all" });
    const single = await receive(webhook.id, jsonHeaders("vendor.items"), JSON.stringify({ url: "https://a.example/v" }));
    expect(single).toMatchObject({ webhookType: "vendor.items", eventCount: 1 });
    expect(single.runIds).toHaveLength(1);
  });

  it("checks the signature when the webhook has a secret", async () => {
    const { webhook } = await setupPipeline("active", { secret: "whsec_x" });
    const body = changes({ seq: 1, url: "https://a.example/1" });
    const t = String(Math.floor(T0.getTime() / 1000));

    const bad = await receive(webhook.id, new Headers({ "Telem-Signature": `t=${t},v1=${"0".repeat(64)}` }), body);
    expect(bad.signature).toBe("invalid");
    expect(bad.runIds).toEqual([]);
    expect(bad.body).not.toEqual(JSON.parse(body));

    // The refused delivery did not mark seq 1 as seen.
    const good = await receive(webhook.id, new Headers({ "Telem-Signature": `t=${t},v1=${sign("whsec_x", t, body)}` }), body);
    expect(good.signature).toBe("valid");
    expect(good.runIds).toHaveLength(1);

    const unsigned = await receive(webhook.id, new Headers(), changes({ seq: 2, url: "https://a.example/2" }));
    expect(unsigned.signature).toBe("not_checked");
    expect(unsigned.runIds).toHaveLength(1);
  });

  it("refuses unknown and disabled webhooks, and oversized bodies", async () => {
    const { webhook } = await setupPipeline("active", { enabled: false });
    await expect(receive("wh_missing", new Headers(), "{}")).rejects.toMatchObject({ status: 404 });
    await expect(receive(webhook.id, new Headers(), "{}")).rejects.toMatchObject({ status: 403 });
    await expect(receive(webhook.id, new Headers(), "x".repeat(1024 * 1024 + 1))).rejects.toMatchObject({ status: 413 });
    expect((await read()).deliveries).toEqual([]);
  });

  it("routes one event to several scripts", async () => {
    const webhook = makeWebhook(["ws_a", "ws_b"]);
    await setDb({ scripts: [makeRecord("ws_a", "active"), makeRecord("ws_b", "active")], webhooks: [webhook] });
    const delivery = await receive(webhook.id, jsonHeaders("agent.changes"), changes({ seq: 1, url: "https://a.example/1" }));
    expect(delivery.runIds).toHaveLength(2);
    expect((await read()).runs.map((r) => r.scriptId).sort()).toEqual(["ws_a", "ws_b"]);
  });
});
