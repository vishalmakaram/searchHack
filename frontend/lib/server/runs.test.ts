import { beforeEach, describe, expect, it, vi } from "vitest";
import * as runtime from "@/lib/backend/runtime";
import { drainRuns, finishCollect, getRun, listRuns, startCollect, startManualRun, toPageResult } from "./runs";
import { read } from "./store";
import { advance, makeRecord, makeRun, rawWorkspace, setDb, T0, useTestStore } from "./test-helpers";

vi.mock("@/lib/backend/runtime");
const mocked = vi.mocked(runtime);

const delivered = (url: string) => ({
  url,
  ok: true,
  page: { title: "Pricing" },
  process: { ok: true, output: { keep: true, processed: "Team plan 59 EUR", data: { plan: "Team" } } },
  delivery: { ok: true, reply: "Recorded; called local_alert_feed." },
});

describe("toPageResult", () => {
  it("reads each way a page can end", () => {
    expect(toPageResult(delivered("https://a.example"), "x")).toMatchObject({
      url: "https://a.example",
      title: "Pricing",
      outcome: "delivered",
      processed: "Team plan 59 EUR",
      data: { plan: "Team" },
      agentReply: "Recorded; called local_alert_feed.",
    });
    expect(toPageResult({ ok: true, dropped: true, reason: "not about pricing" }, "u")).toMatchObject({
      url: "u",
      outcome: "dropped",
      reason: "not about pricing",
    });
    expect(toPageResult({ ok: true, unchanged: true }, "u").outcome).toBe("unchanged");
    expect(toPageResult({ ok: false, process: { ok: false, error: "Traceback" } }, "u")).toMatchObject({
      outcome: "failed",
      reason: "Traceback",
    });
    // The runtime says ok even when the delivery agent gave up.
    expect(toPageResult({ ok: true, delivery: { ok: false } }, "u").outcome).toBe("failed");
  });
});

describe("finishCollect", () => {
  it("says so when there was nothing new", () => {
    expect(finishCollect({ source: "monitor", new_items: 0, results: [] })).toMatchObject({
      status: "unchanged",
      summary: "Telem reported nothing new.",
      pages: [],
    });
  });

  it("summarises the pages it ran", () => {
    const finish = finishCollect({
      source: "escalation",
      new_items: 5,
      results: [delivered("https://a.example/1"), { url: "https://a.example/2", ok: true, dropped: true }, { url: "https://a.example/3", ok: false, error: "boom" }],
    });
    expect(finish.status).toBe("delivered");
    expect(finish.summary).toBe(
      "5 new pages (the monitor had nothing, so a wider search was run); 3 run: 1 delivered, 1 dropped, 1 failed.",
    );
    expect(finish.pages).toHaveLength(3);
  });

  it("fails when every page failed", () => {
    expect(finishCollect({ new_items: 1, results: [{ url: "u", ok: false, error: "boom" }] })).toMatchObject({
      status: "failed",
      error: "boom",
    });
  });
});

describe("the run queue", () => {
  useTestStore();
  beforeEach(() => vi.resetAllMocks());

  it("runs queued pages one at a time, oldest first, and records how each ended", async () => {
    const raw = rawWorkspace();
    const order: string[] = [];
    mocked.runUrl.mockImplementation(async (_id, url) => {
      order.push(url);
      advance(4000);
      if (url.endsWith("/2")) throw new Error("The Sentinel runtime answered 500: fetch failed");
      return delivered(url);
    });

    const first = await startManualRun(raw, "Acme", { url: " https://a.example/1 " });
    advance(1000);
    await startManualRun(raw, "Acme", { url: "https://a.example/2" });
    expect(first).toMatchObject({ status: "queued", source: "manual", url: "https://a.example/1", scriptName: "Acme", durationMs: null });

    await drainRuns();
    expect(order).toEqual(["https://a.example/1", "https://a.example/2"]);

    const [second, one] = await listRuns();
    expect(one).toMatchObject({ status: "delivered", error: null, durationMs: 4000 });
    expect(one.pages[0]).toMatchObject({ outcome: "delivered", processed: "Team plan 59 EUR" });
    expect(second).toMatchObject({ status: "failed", error: "The Sentinel runtime answered 500: fetch failed", pages: [] });
    expect((await getRun(one.id)).finishedAt).not.toBeNull();
  });

  it("refuses addresses that are not web pages", async () => {
    const raw = rawWorkspace();
    for (const url of ["", "nope", "file:///etc/passwd", "javascript:alert(1)"]) {
      await expect(startManualRun(raw, "Acme", { url })).rejects.toMatchObject({ status: 400 });
    }
    expect((await read()).runs).toEqual([]);
  });

  it("collects only for an active script, one at a time", async () => {
    const raw = rawWorkspace();
    await expect(startCollect(raw, "Acme")).rejects.toMatchObject({ status: 409 });
    await setDb({ scripts: [makeRecord(raw.id, "inactive")] });
    await expect(startCollect(raw, "Acme")).rejects.toMatchObject({ status: 409 });

    await setDb({ scripts: [makeRecord(raw.id, "active")] });
    const run = await startCollect(raw, "Acme");
    expect(run).toMatchObject({ source: "collect", url: null, status: "queued" });
    await expect(startCollect(raw, "Acme")).rejects.toMatchObject({ status: 409 });

    mocked.collect.mockResolvedValue({ source: "monitor", new_items: 1, results: [delivered("https://a.example/n")] });
    await drainRuns();
    expect(await getRun(run.id)).toMatchObject({ status: "delivered", summary: "1 new page; 1 run: 1 delivered." });
    await expect(startCollect(raw, "Acme")).resolves.toMatchObject({ status: "queued" });
  });

  it("closes a run that a restart cut off, and picks queued runs up again", async () => {
    mocked.runUrl.mockResolvedValue(delivered("https://a.example/q"));
    await setDb({
      runs: [
        makeRun("ws_a", { id: "run_cut", status: "running", startedAt: new Date(T0.getTime() - 5000).toISOString() }),
        makeRun("ws_a", { id: "run_waiting", url: "https://a.example/q" }),
      ],
    });
    const runs = await listRuns();
    expect(runs.find((r) => r.id === "run_cut")).toMatchObject({ status: "failed" });
    expect(runs.find((r) => r.id === "run_cut")?.error).toMatch(/restarted/);

    await drainRuns();
    expect(await getRun("run_waiting")).toMatchObject({ status: "delivered" });
  });

  it("filters and limits the list", async () => {
    await setDb({
      runs: [
        makeRun("ws_a", { id: "run_1", status: "delivered", finishedAt: T0.toISOString(), deliveryId: "dlv_1" }),
        makeRun("ws_b", { id: "run_2", status: "failed", finishedAt: T0.toISOString(), queuedAt: T0.toISOString() }),
      ],
    });
    expect((await listRuns()).map((r) => r.id)).toEqual(["run_2", "run_1"]);
    expect((await listRuns({ scriptId: "ws_a" })).map((r) => r.id)).toEqual(["run_1"]);
    expect((await listRuns({ status: "failed" })).map((r) => r.id)).toEqual(["run_2"]);
    expect((await listRuns({ deliveryId: "dlv_1" })).map((r) => r.id)).toEqual(["run_1"]);
    expect(await listRuns({ limit: 1 })).toHaveLength(1);
    await expect(listRuns({ limit: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(getRun("run_missing")).rejects.toMatchObject({ status: 404 });
  });
});
