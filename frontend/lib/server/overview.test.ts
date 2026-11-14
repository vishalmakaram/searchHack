import { beforeEach, describe, expect, it, vi } from "vitest";
import * as output from "@/lib/backend/output";
import * as runtime from "@/lib/backend/runtime";
import { receive } from "./ingest";
import { getOverview, worstHealth } from "./overview";
import { drainRuns } from "./runs";
import { advance, jsonHeaders, makeRecord, makeRun, rawWorkspace, setDb, setupPipeline, T0, useTestStore } from "./test-helpers";

vi.mock("@/lib/backend/runtime");
vi.mock("@/lib/backend/output");
vi.mock("@/lib/backend/config", () => ({ runtimeUrl: () => "http://runtime.test", outputUrl: () => "http://output.test" }));
const rt = vi.mocked(runtime);
const out = vi.mocked(output);

function servicesUp(...workspaces: runtime.RawWorkspace[]) {
  rt.isUp.mockResolvedValue(true);
  rt.listWorkspaceIds.mockResolvedValue(workspaces.map((w) => w.id));
  rt.getWorkspace.mockImplementation(async (id) => workspaces.find((w) => w.id === id) ?? null);
  out.capabilities.mockResolvedValue({ service: "x", outputs: [{ name: "slack", configured: false }, { name: "local_alert_feed", configured: true }] });
}

const stageOf = (overview: Awaited<ReturnType<typeof getOverview>>, key: string) => overview.stages.find((s) => s.key === key)!;

describe("getOverview", () => {
  useTestStore();
  beforeEach(() => vi.resetAllMocks());

  it("is idle with nothing in the log", async () => {
    servicesUp(rawWorkspace("ws_ready"), rawWorkspace("ws_building", { status: "creating" }));
    const overview = await getOverview();
    expect(overview.health).toBe("idle");
    expect(overview.stages.map((s) => [s.key, s.health])).toEqual([
      ["ingest", "idle"],
      ["dispatch", "idle"],
      ["processing", "idle"],
      ["delivery", "idle"],
    ]);
    expect(overview.services).toEqual([
      { key: "runtime", label: "Sentinel runtime", url: "http://runtime.test", up: true },
      { key: "output", label: "Output service", url: "http://output.test", up: true },
    ]);
    expect(overview.channels).toEqual([{ name: "slack", configured: false }, { name: "local_alert_feed", configured: true }]);
    expect(overview.scriptCounts).toEqual({ developed: 1, active: 0, inactive: 0 });
    expect(overview.building.map((w) => w.id)).toEqual(["ws_building"]);
  });

  it("needs attention when a service is down, and still answers", async () => {
    rt.isUp.mockResolvedValue(false);
    rt.listWorkspaceIds.mockRejectedValue(new Error("down"));
    out.capabilities.mockRejectedValue(new Error("down"));
    const overview = await getOverview();
    expect(overview.health).toBe("attention");
    expect(overview.services.map((s) => s.up)).toEqual([false, false]);
    expect(overview.channels).toEqual([]);
    expect(overview.building).toEqual([]);
  });

  it("follows a delivery through the stages", async () => {
    const { webhook, raw } = await setupPipeline("active");
    servicesUp(raw);
    let release = () => {};
    rt.runUrl.mockImplementation(
      () => new Promise((resolve) => (release = () => resolve({ ok: true, delivery: { ok: true } }))),
    );

    await receive(webhook.id, jsonHeaders("agent.changes"), JSON.stringify({ type: "agent.changes", changes: [{ seq: 1, url: "https://a.example/1" }, { seq: 1, url: "https://a.example/1" }] }));
    let overview = await getOverview();
    expect(stageOf(overview, "ingest")).toMatchObject({ health: "busy", metrics: [{ value: "1" }, { value: "2" }, { value: "just now" }] });
    expect(stageOf(overview, "dispatch").metrics.map((m) => m.value)).toEqual(["1", "0", "1"]);
    expect(overview.scriptCounts.active).toBe(1);

    // getOverview picked the queued run up; it is now with the runtime.
    await vi.waitFor(() => expect(rt.runUrl).toHaveBeenCalled());
    advance(20_000);
    overview = await getOverview();
    expect(stageOf(overview, "processing").health).toBe("busy");
    expect(overview.runsInFlight).toHaveLength(1);
    expect(overview.health).toBe("busy");

    release();
    await drainRuns();
    overview = await getOverview();
    expect(stageOf(overview, "delivery")).toMatchObject({ health: "ok", metrics: [{ value: "1" }, { value: "0" }, { value: "0" }] });
    expect(stageOf(overview, "processing").metrics[2].value).toBe("20.0 s");
    expect(overview.runsInFlight).toEqual([]);
    expect(overview.health).toBe("ok");
  });

  it("flags failed runs and wrong signatures, and lists recent problems", async () => {
    servicesUp(rawWorkspace());
    const at = new Date(T0.getTime() - 60_000).toISOString();
    await setDb({
      scripts: [makeRecord("ws_test000001", "active")],
      runs: [makeRun("ws_test000001", { id: "run_bad", status: "failed", error: "boom", startedAt: at, finishedAt: at })],
      deliveries: [
        { id: "dlv_1", webhookId: "wh_1", receivedAt: at, webhookType: "unknown", signature: "invalid", isTest: false, bodyBytes: 0, body: "", eventCount: 1, duplicateCount: 0, eventsWithoutUrl: 0, runIds: [], skipped: [] },
      ],
    });
    const overview = await getOverview();
    expect(stageOf(overview, "ingest").health).toBe("attention");
    expect(stageOf(overview, "delivery").health).toBe("attention");
    expect(overview.health).toBe("attention");
    expect(overview.recentProblems.map((r) => r.id)).toEqual(["run_bad"]);
    expect(overview.recentDeliveries).toHaveLength(1);
  });
});

describe("worstHealth", () => {
  it("ranks attention over busy over ok over idle", () => {
    expect(worstHealth(["idle", "ok", "busy"])).toBe("busy");
    expect(worstHealth(["ok", "attention", "busy"])).toBe("attention");
    expect(worstHealth([])).toBe("idle");
  });
});
