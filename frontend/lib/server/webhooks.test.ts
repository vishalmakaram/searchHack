import { beforeEach, describe, expect, it, vi } from "vitest";
import * as runtime from "@/lib/backend/runtime";
import { read } from "./store";
import { makeRecord, rawWorkspace, setDb, useTestStore } from "./test-helpers";
import { createWebhook, deleteWebhook, getWebhook, listDeliveries, listWebhooks, sendTestEvent, updateWebhook } from "./webhooks";

vi.mock("@/lib/backend/runtime");
const mocked = vi.mocked(runtime);
const BASE = "http://localhost:3000/";

describe("webhooks", () => {
  useTestStore();
  beforeEach(() => {
    vi.resetAllMocks();
    const raw = rawWorkspace("ws_ready");
    mocked.listWorkspaceIds.mockResolvedValue([raw.id]);
    mocked.getWorkspace.mockImplementation(async (id) => (id === raw.id ? raw : null));
  });

  it("creates a webhook and never returns its secret", async () => {
    const hook = await createWebhook({ name: "  Telem   monitor ", scriptIds: ["ws_ready", "ws_ready"], secret: " whsec_abc " }, BASE);
    expect(hook).toMatchObject({ name: "Telem monitor", enabled: true, scriptIds: ["ws_ready"], secretSet: true, deliveryCount: 0 });
    expect(hook.url).toBe(`http://localhost:3000/api/hooks/${hook.id}`);
    expect(hook).not.toHaveProperty("secret");
    expect((await read()).webhooks[0].secret).toBe("whsec_abc");
    expect(await listWebhooks(BASE)).toHaveLength(1);
  });

  it("checks the name and the routing targets", async () => {
    await expect(createWebhook({ name: " ", scriptIds: [] }, BASE)).rejects.toMatchObject({ status: 400 });
    await expect(createWebhook({ name: "x".repeat(81), scriptIds: [] }, BASE)).rejects.toMatchObject({ status: 400 });
    await expect(createWebhook({ name: "x", scriptIds: ["ws_nope"] }, BASE)).rejects.toMatchObject({ status: 400 });
    // No routing targets: the runtime is not consulted, so this works while it is down.
    mocked.listWorkspaceIds.mockRejectedValue(new Error("down"));
    await expect(createWebhook({ name: "x", scriptIds: [] }, BASE)).resolves.toMatchObject({ secretSet: false });
  });

  it("updates name, switch, routing and secret", async () => {
    const hook = await createWebhook({ name: "x", scriptIds: [] }, BASE);
    expect(await updateWebhook(hook.id, { name: "y", enabled: false, scriptIds: ["ws_ready"], secret: "s" }, BASE)).toMatchObject({
      name: "y",
      enabled: false,
      scriptIds: ["ws_ready"],
      secretSet: true,
    });
    expect(await updateWebhook(hook.id, { secret: null }, BASE)).toMatchObject({ secretSet: false, name: "y" });
    await expect(updateWebhook("wh_missing", { name: "z" }, BASE)).rejects.toMatchObject({ status: 404 });
  });

  it("sends a test event through ingest for the given page", async () => {
    await setDb({ scripts: [makeRecord("ws_ready", "active")] });
    const hook = await createWebhook({ name: "x", scriptIds: ["ws_ready"], secret: "whsec" }, BASE);

    const first = await sendTestEvent(hook.id, { url: "https://a.example/page" });
    expect(first).toMatchObject({ isTest: true, webhookType: "agent.changes", eventCount: 1, signature: "not_checked" });
    expect(first.runIds).toHaveLength(1);
    expect((await read()).runs[0]).toMatchObject({ url: "https://a.example/page", source: "webhook", status: "queued" });

    // A second test is a new seq, not a duplicate.
    const second = await sendTestEvent(hook.id, { url: "https://a.example/page" });
    expect(second.duplicateCount).toBe(0);
    expect(await listDeliveries(hook.id)).toHaveLength(2);
    expect((await getWebhook(hook.id, BASE)).deliveryCount).toBe(2);

    await expect(sendTestEvent(hook.id, { url: "nope" })).rejects.toMatchObject({ status: 400 });
    await updateWebhook(hook.id, { enabled: false }, BASE);
    await expect(sendTestEvent(hook.id, { url: "https://a.example/page" })).rejects.toMatchObject({ status: 403 });
  });

  it("deletes a webhook with its deliveries and keeps the runs", async () => {
    await setDb({ scripts: [makeRecord("ws_ready", "active")] });
    const hook = await createWebhook({ name: "x", scriptIds: ["ws_ready"] }, BASE);
    await sendTestEvent(hook.id, { url: "https://a.example/page" });
    await deleteWebhook(hook.id);
    const db = await read();
    expect(db.webhooks).toEqual([]);
    expect(db.deliveries).toEqual([]);
    expect(db.runs).toHaveLength(1);
    await expect(deleteWebhook(hook.id)).rejects.toMatchObject({ status: 404 });
  });
});
