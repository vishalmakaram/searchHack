import { beforeEach, describe, expect, it, vi } from "vitest";
import * as output from "@/lib/backend/output";
import * as runtime from "@/lib/backend/runtime";
import { makeRecord, rawWorkspace, setDb, T0, useTestStore } from "./test-helpers";
import { createWorkspace, getWorkspace, getWorkspaceOutput, listWorkspaces, workspaceName } from "./workspaces";

vi.mock("@/lib/backend/runtime");
vi.mock("@/lib/backend/output");
const rt = vi.mocked(runtime);
const out = vi.mocked(output);

function serve(...workspaces: runtime.RawWorkspace[]) {
  rt.listWorkspaceIds.mockResolvedValue(workspaces.map((w) => w.id));
  rt.getWorkspace.mockImplementation(async (id) => workspaces.find((w) => w.id === id) ?? null);
}

describe("workspaceName", () => {
  it("uses the start of the query, cut at a word", () => {
    expect(workspaceName("ws_1", "  Watch   IBM filings ")).toBe("Watch IBM filings");
    expect(workspaceName("ws_1", null)).toBe("ws_1");
    const long = workspaceName("ws_1", "Tell me whenever any of the large European cloud providers changes the price of a plan");
    expect(long.length).toBeLessThanOrEqual(65);
    expect(long.endsWith("…")).toBe(true);
    expect(long).not.toMatch(/\s…$/);
  });
});

describe("workspaces", () => {
  useTestStore();
  beforeEach(() => vi.resetAllMocks());

  it("maps the runtime's statuses and puts builds first, result folders last", async () => {
    serve(
      { id: "demo_ws", status: {}, memory: "" },
      rawWorkspace("ws_ready"),
      rawWorkspace("ws_failed", {
        status: "failed",
        error: "Telem search failed\nTraceback (most recent call last):\n  File \"server.py\", line 65",
        built_at: undefined,
      }),
      rawWorkspace("ws_building", { status: "creating", built_at: undefined, created_at: T0.getTime() / 1000 - 5 }),
    );
    await setDb({ scripts: [makeRecord("ws_ready", "active")] });

    const list = await listWorkspaces();
    expect(list.map((w) => [w.id, w.status])).toEqual([
      ["ws_building", "building"],
      ["ws_failed", "failed"],
      ["ws_ready", "ready"],
      ["demo_ws", "output_only"],
    ]);
    expect(list[1]).toMatchObject({ error: "Telem search failed", scriptStatus: null, builtAt: null });
    expect(list[2]).toMatchObject({ scriptStatus: "active", error: null, builtAt: new Date(T0.getTime() - 60_000).toISOString() });
    expect(list[3]).toMatchObject({ name: "demo_ws", query: null, createdAt: null });
  });

  it("returns memory and the build check with one workspace", async () => {
    serve(rawWorkspace("ws_ready", { monitor_id: "mon_1", seen_urls: ["a", "b"], seq: 3 }));
    expect(await getWorkspace("ws_ready")).toMatchObject({
      memory: "# Memory: Acme Cloud pricing\n",
      sampleUrl: "https://acme.example/pricing",
      buildCheck: { ok: true, durationMs: 120, error: null },
      scriptStatus: "developed",
      monitorId: "mon_1",
      pagesSeen: 2,
      resultsHandled: 3,
    });
    await expect(getWorkspace("ws_missing")).rejects.toMatchObject({ status: 404 });
  });

  it("starts a build with the cleaned query", async () => {
    rt.createWorkspace.mockResolvedValue("ws_new");
    serve(rawWorkspace("ws_new", { status: "creating", query: "Watch IBM", built_at: undefined }));
    expect(await createWorkspace({ query: "  Watch   IBM " })).toMatchObject({ id: "ws_new", status: "building", name: "Watch IBM" });
    expect(rt.createWorkspace).toHaveBeenCalledWith("Watch IBM");

    await expect(createWorkspace({ query: "   " })).rejects.toMatchObject({ status: 400 });
    await expect(createWorkspace({ query: "x".repeat(501) })).rejects.toMatchObject({ status: 400 });
    expect(rt.createWorkspace).toHaveBeenCalledTimes(1);
  });

  it("reads alerts, counts and the research document from the output service", async () => {
    serve({ id: "demo_ws", status: {}, memory: "" });
    out.stats.mockResolvedValue({ total_received: 3, total_alerts_delivered: 1, total_suppressed: 2, doc_entries: 1 });
    out.researchDoc.mockResolvedValue("# Living research");
    out.alerts.mockResolvedValue([
      { seq: 1, timestamp: "2026-11-14 21:47:23Z", suppressed: false, suppression_reason: "approved", event_type: "8-K Filing", impact: "HIGH", summary: "s", source_url: "https://sec.gov/x", confidence: 0.96 },
      { seq: 2, timestamp: "garbage", suppressed: true, suppression_reason: "Duplicate event key", impact: "low" },
    ]);

    const result = await getWorkspaceOutput("demo_ws");
    expect(result).toMatchObject({ available: true, doc: "# Living research", stats: { received: 3, delivered: 1, suppressed: 2, docEntries: 1 } });
    expect(result.alerts.map((a) => a.seq)).toEqual([2, 1]);
    expect(result.alerts[1]).toMatchObject({ delivered: true, reason: "", impact: "high", at: "2026-11-14T21:47:23.000Z" });
    expect(result.alerts[0]).toMatchObject({ delivered: false, reason: "Duplicate event key", at: null, confidence: null });
  });

  it("does not ask the output service about a workspace that does not exist", async () => {
    serve();
    await expect(getWorkspaceOutput("ws_missing")).rejects.toMatchObject({ status: 404 });
    expect(out.stats).not.toHaveBeenCalled();
  });

  it("reports the output service being down without failing", async () => {
    serve(rawWorkspace("ws_ready"));
    out.stats.mockRejectedValue(new Error("down"));
    out.alerts.mockResolvedValue([]);
    out.researchDoc.mockResolvedValue("");
    expect(await getWorkspaceOutput("ws_ready")).toEqual({ available: false, stats: null, alerts: [], doc: "" });
  });
});
