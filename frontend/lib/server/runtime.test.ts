import { describe, expect, it } from "vitest";
import type { ChangeEvent } from "@/lib/contracts";
import { createRun, getRun, listRuns, runStatusAt, toRunView } from "./runtime";
import { mutate } from "./store";
import { seededRandom } from "./util";
import { makeScript, makeWorkspace, setupPipeline, T0, useTestStore } from "./test-helpers";

const workspace = makeWorkspace();
const script = makeScript(workspace, "active", { version: 3 });
const delivery = { id: "dlv_test", webhookId: "wh_test" };
const event: ChangeEvent = {
  workspace_id: "ws_wrong",
  seq: 7,
  kind: "value_changed",
  url: "https://acme-cloud.example/pricing",
  page_text: "Acme pricing\nVendor: Acme Cloud\nNew price: $59.00",
  telem_run_id: "trun_1",
  received_at: T0.toISOString(),
};
const at = (ms: number) => new Date(T0.getTime() + ms);
const fixed = (value: number) => () => value;

describe("createRun", () => {
  it("decides the schedule and outcome up front", () => {
    const run = createRun(script, event, delivery, { random: fixed(0), at: T0 });
    expect(run.queuedAt).toBe(T0.toISOString());
    expect(run.startsAt).toBe(at(500).toISOString());
    expect(run.finishesAt).toBe(at(2500).toISOString());
    expect(run.outcome).toBe("succeeded");
    expect(run.webhookId).toBe("wh_test");
    expect(run.deliveryId).toBe("dlv_test");
    expect(run.id).toMatch(/^run_[0-9a-z]{12}$/);
  });

  it("keeps the queue delay within 0.5–2 s and the duration within 2–6 s", () => {
    const run = createRun(script, event, delivery, { random: fixed(0.999999), at: T0 });
    expect(Date.parse(run.startsAt) - T0.getTime()).toBe(2000);
    expect(Date.parse(run.finishesAt) - Date.parse(run.startsAt)).toBe(6000);
  });

  it("addresses the event to the script's workspace", () => {
    const run = createRun(script, event, delivery, { random: fixed(0), at: T0 });
    expect(run.event.workspace_id).toBe(workspace.id);
    expect(run.result?.workspace_id).toBe(workspace.id);
  });

  it("builds a ProcessedResult that matches the schema", () => {
    const run = createRun(script, event, delivery, { random: fixed(0), at: T0 });
    expect(run.error).toBeNull();
    expect(run.result).toMatchObject({
      seq: 7,
      extracted: { vendor: "Acme Cloud", new_price: 59 },
      pipeline_version: "v3",
    });
    expect(run.result?.confidence).toBeGreaterThanOrEqual(0);
    expect(run.result?.confidence).toBeLessThanOrEqual(1);
    expect(run.result?.dedupe_key).toMatch(new RegExp(`^${workspace.id}:[0-9a-f]{16}$`));
  });

  it("gives an invalid run a schema error and no result", () => {
    const run = createRun(script, event, delivery, { random: fixed(0.9), at: T0 });
    expect(run.outcome).toBe("invalid");
    expect(run.result).toBeNull();
    expect(run.error).toMatch(/did not match the schema: "(vendor|new_price)"/);
  });

  it("gives a failed run an error and no result", () => {
    const run = createRun(script, event, delivery, { random: fixed(0.99), at: T0 });
    expect(run.outcome).toBe("failed");
    expect(run.result).toBeNull();
    expect(run.error).toBeTruthy();
  });

  it("succeeds about 85% of the time, invalid 10%, failed 5%", () => {
    const random = seededRandom(1);
    const counts = { succeeded: 0, invalid: 0, failed: 0 };
    for (let i = 0; i < 4000; i++) counts[createRun(script, event, delivery, { random, at: T0 }).outcome]++;
    expect(counts.succeeded / 4000).toBeCloseTo(0.85, 1);
    expect(counts.invalid / 4000).toBeCloseTo(0.1, 1);
    expect(counts.failed / 4000).toBeCloseTo(0.05, 1);
  });

  it("can be forced to an outcome", () => {
    expect(createRun(script, event, delivery, { random: fixed(0), outcome: "failed" }).outcome).toBe("failed");
  });
});

describe("run status from the clock", () => {
  const succeeded = createRun(script, event, delivery, { random: fixed(0), at: T0 }); // starts +500, ends +2500
  const failed = createRun(script, event, delivery, { random: fixed(0.99), at: T0 }); // starts +1985, ends +7945

  it.each([
    [0, "queued"],
    [499, "queued"],
    [500, "running"],
    [2499, "running"],
    [2500, "succeeded"],
    [60_000, "succeeded"],
  ] as const)("at +%i ms a succeeding run is %s", (offset, status) => {
    expect(runStatusAt(succeeded, at(offset))).toBe(status);
  });

  it("hides the outcome, result and error until the run finishes", () => {
    for (const offset of [0, 1000]) {
      const view = toRunView(succeeded, "S", at(offset));
      expect(view.result).toBeNull();
      expect(view.error).toBeNull();
      expect(view.durationMs).toBeNull();
      expect(view).not.toHaveProperty("outcome");
    }
    const done = toRunView(succeeded, "S", at(2500));
    expect(done.status).toBe("succeeded");
    expect(done.result).toEqual(succeeded.result);
    expect(done.durationMs).toBe(2000);
    expect(done.scriptName).toBe("S");
  });

  it("shows a failure only once it has finished", () => {
    expect(toRunView(failed, "S", at(3000)).status).toBe("running");
    expect(toRunView(failed, "S", at(3000)).error).toBeNull();
    const done = toRunView(failed, "S", at(8000));
    expect(done.status).toBe("failed");
    expect(done.error).toBe(failed.error);
  });
});

describe("listRuns and getRun", () => {
  useTestStore();

  async function seedRuns() {
    const { script: s, webhook } = await setupPipeline("active");
    const runs = [
      createRun(s, event, { id: "dlv_a", webhookId: webhook.id }, { random: fixed(0), at: at(-60_000) }),
      createRun(s, event, { id: "dlv_a", webhookId: webhook.id }, { random: fixed(0.99), at: at(-30_000) }),
      createRun(s, event, { id: "dlv_b", webhookId: webhook.id }, { random: fixed(0), at: T0 }),
    ];
    await mutate((db) => {
      db.runs.push(...runs);
    });
    return { script: s, runs };
  }

  it("lists newest first with derived statuses", async () => {
    const { runs } = await seedRuns();
    const list = await listRuns();
    expect(list.map((r) => r.id)).toEqual([runs[2].id, runs[1].id, runs[0].id]);
    expect(list.map((r) => r.status)).toEqual(["queued", "failed", "succeeded"]);
  });

  it("filters by script, status and delivery", async () => {
    const { script: s, runs } = await seedRuns();
    expect((await listRuns({ status: "failed" })).map((r) => r.id)).toEqual([runs[1].id]);
    expect((await listRuns({ deliveryId: "dlv_a" })).map((r) => r.id)).toEqual([runs[1].id, runs[0].id]);
    expect(await listRuns({ scriptId: s.id })).toHaveLength(3);
    expect(await listRuns({ scriptId: "scr_unknown" })).toEqual([]);
    expect(await listRuns({ limit: 1 })).toHaveLength(1);
  });

  it("defaults to 50, caps at 200, and rejects bad input", async () => {
    const { script: s } = await seedRuns();
    await mutate((db) => {
      for (let i = 0; i < 250; i++) db.runs.push(createRun(s, event, { id: "dlv_c", webhookId: "wh" }, { at: T0 }));
    });
    expect(await listRuns()).toHaveLength(50);
    expect(await listRuns({ limit: 1000 })).toHaveLength(200);
    await expect(listRuns({ limit: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(listRuns({ limit: 1.5 })).rejects.toMatchObject({ status: 400 });
    // @ts-expect-error: checking the runtime guard
    await expect(listRuns({ status: "bogus" })).rejects.toMatchObject({ status: 400 });
  });

  it("gets one run, or 404", async () => {
    const { runs } = await seedRuns();
    expect((await getRun(runs[1].id)).status).toBe("failed");
    await expect(getRun("run_missing")).rejects.toMatchObject({ status: 404 });
  });
});
