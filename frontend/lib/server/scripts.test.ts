import { beforeEach, describe, expect, it, vi } from "vitest";
import * as runtime from "@/lib/backend/runtime";
import { activateScript, deactivateScript, deployScript, getScript, listScripts } from "./scripts";
import { read } from "./store";
import { makeRecord, makeRun, makeWebhook, rawWorkspace, setDb, T0, useTestStore } from "./test-helpers";

vi.mock("@/lib/backend/runtime");
const mocked = vi.mocked(runtime);

const READY = rawWorkspace("ws_ready");
const BUILDING = rawWorkspace("ws_building", { status: "creating", built_at: undefined });
const OUTPUT_ONLY = { id: "demo_ws", status: {}, memory: "" };

function serve(...workspaces: runtime.RawWorkspace[]) {
  mocked.listWorkspaceIds.mockResolvedValue(workspaces.map((w) => w.id));
  mocked.getWorkspace.mockImplementation(async (id) => workspaces.find((w) => w.id === id) ?? null);
  mocked.readScriptSource.mockResolvedValue("import sys\nprint('{}')\n");
}

describe("scripts", () => {
  useTestStore();
  beforeEach(() => {
    vi.resetAllMocks();
    serve(READY, BUILDING, OUTPUT_ONLY);
  });

  it("lists only workspaces whose build finished, as developed until deployed", async () => {
    const scripts = await listScripts();
    expect(scripts.map((s) => s.id)).toEqual(["ws_ready"]);
    expect(scripts[0]).toMatchObject({
      workspaceId: "ws_ready",
      name: "Tell me when Acme Cloud changes its prices",
      status: "developed",
      activity: "off",
      deployedAt: null,
      failureRate: null,
      runsLast24h: 0,
    });
    expect(await listScripts({ status: "active" })).toEqual([]);
  });

  it("returns the source and the build check with one script", async () => {
    const script = await getScript("ws_ready");
    expect(script.source).toContain("import sys");
    expect(script.sampleUrl).toBe("https://acme.example/pricing");
    expect(script.buildCheck).toMatchObject({ ok: true, durationMs: 120 });
    await expect(getScript("ws_building")).rejects.toMatchObject({ status: 404 });
    await expect(getScript("demo_ws")).rejects.toMatchObject({ status: 404 });
    await expect(getScript("ws_missing")).rejects.toMatchObject({ status: 404 });
  });

  it("moves developed -> active -> inactive -> active and refuses everything else", async () => {
    await expect(deactivateScript("ws_ready")).rejects.toMatchObject({ status: 409 });
    await expect(activateScript("ws_ready")).rejects.toMatchObject({ status: 409 });

    const deployed = await deployScript("ws_ready");
    expect(deployed).toMatchObject({ status: "active", activity: "idle", deployedAt: T0.toISOString() });
    await expect(deployScript("ws_ready")).rejects.toMatchObject({ status: 409 });

    expect(await deactivateScript("ws_ready")).toMatchObject({ status: "inactive", activity: "off" });
    await expect(deployScript("ws_ready")).rejects.toMatchObject({ status: 409 });
    expect(await activateScript("ws_ready")).toMatchObject({ status: "active", deployedAt: T0.toISOString() });

    expect((await read()).scripts).toEqual([
      { id: "ws_ready", name: deployed.name, status: "active", deployedAt: T0.toISOString(), statusChangedAt: T0.toISOString() },
    ]);
    await expect(deployScript("ws_building")).rejects.toMatchObject({ status: 404 });
  });

  it("derives activity and counts from the run log", async () => {
    const finished = (id: string, status: "delivered" | "failed") =>
      makeRun("ws_ready", { id, status, startedAt: T0.toISOString(), finishedAt: T0.toISOString() });
    const hook = makeWebhook(["ws_ready"]);
    await setDb({
      scripts: [makeRecord("ws_ready", "active")],
      webhooks: [hook],
      runs: [finished("run_1", "delivered"), finished("run_2", "delivered"), finished("run_3", "failed"), makeRun("ws_ready", { id: "run_4" })],
    });
    expect((await listScripts())[0]).toMatchObject({
      activity: "processing",
      runsInFlight: 1,
      runsLast24h: 4,
      failureRate: 1 / 3,
      webhookIds: [hook.id],
    });

    await setDb({ scripts: [makeRecord("ws_ready", "active")], runs: [finished("run_1", "failed"), finished("run_2", "delivered")] });
    expect((await listScripts())[0].activity).toBe("failing");
  });
});
