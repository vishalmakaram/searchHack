import { describe, expect, it } from "vitest";
import type { ChangeEvent } from "@/lib/contracts";
import { getOverview, worstHealth } from "./overview";
import { createRun } from "./runtime";
import { mutate, read } from "./store";
import { advance, setDb, setupPipeline, T0, useTestStore } from "./test-helpers";
import { sendTestEvent } from "./webhooks";

const health = (overview: Awaited<ReturnType<typeof getOverview>>) =>
  Object.fromEntries(overview.stages.map((s) => [s.key, s.health]));

describe("overview", () => {
  useTestStore();

  it("summarises the seed", async () => {
    const overview = await getOverview();
    expect(overview.stages.map((s) => s.key)).toEqual(["ingest", "dispatch", "processing", "results"]);
    expect(overview.scriptCounts).toEqual({ developed: 1, active: 2, inactive: 1 });
    expect(overview.runsInFlight).toEqual([]);
    expect(overview.recentDeliveries).toHaveLength(10);
    expect(overview.recentProblems.length).toBeGreaterThan(0);
    expect(overview.recentProblems.every((r) => r.status === "failed" || r.status === "invalid")).toBe(true);
    expect(overview.health).toBe("ok");
    expect(overview.stages.every((s) => s.metrics.length >= 2)).toBe(true);
  });

  it("is idle with nothing in the last hour", async () => {
    await setDb({});
    const overview = await getOverview();
    expect(overview.health).toBe("idle");
    expect(Object.values(health(overview))).toEqual(["idle", "idle", "idle", "idle"]);
  });

  it("follows a delivery through the stages", async () => {
    const { webhook } = await setupPipeline("active");
    await sendTestEvent(webhook.id);

    let overview = await getOverview();
    expect(health(overview)).toMatchObject({ ingest: "busy", dispatch: "busy" });
    expect(overview.runsInFlight).toHaveLength(1);
    expect(overview.health).toBe("busy");

    const run = (await read()).runs[0];
    advance(Date.parse(run.startsAt) - T0.getTime());
    overview = await getOverview();
    expect(health(overview)).toMatchObject({ dispatch: "ok", processing: "busy" });

    advance(Date.parse(run.finishesAt) - Date.parse(run.startsAt) + 10_000);
    overview = await getOverview();
    expect(overview.runsInFlight).toEqual([]);
    expect(health(overview)).toMatchObject({ ingest: "ok", dispatch: "ok", processing: "ok" });
    expect(["ok", "attention"]).toContain(health(overview).results);
  });

  it("needs attention after a failed or invalid run in the last hour", async () => {
    const { script, webhook } = await setupPipeline("active");
    const event: ChangeEvent = {
      workspace_id: "",
      seq: 1,
      kind: "alert",
      url: "",
      page_text: "",
      telem_run_id: "",
      received_at: T0.toISOString(),
    };
    await mutate((db) => {
      db.runs.push(createRun(script, event, { id: "d", webhookId: webhook.id }, { outcome: "invalid", at: new Date(T0.getTime() - 20 * 60_000) }));
    });
    const overview = await getOverview();
    expect(health(overview).results).toBe("attention");
    expect(overview.health).toBe("attention");
    expect(overview.recentProblems).toHaveLength(1);

    advance(61 * 60_000);
    expect(health(await getOverview()).results).toBe("idle");
  });

  it("needs attention on ingest after an invalid signature", async () => {
    const { webhook } = await setupPipeline("active");
    await sendTestEvent(webhook.id);
    await mutate((db) => {
      db.deliveries[0].signature = "invalid";
    });
    expect(health(await getOverview()).ingest).toBe("attention");
  });

  it("ranks health attention > busy > ok > idle", () => {
    expect(worstHealth(["idle", "ok"])).toBe("ok");
    expect(worstHealth(["ok", "busy", "idle"])).toBe("busy");
    expect(worstHealth(["busy", "attention"])).toBe("attention");
    expect(worstHealth([])).toBe("idle");
  });
});
