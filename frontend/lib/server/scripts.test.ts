import { describe, expect, it } from "vitest";
import type { ChangeEvent } from "@/lib/contracts";
import type { ScriptStatus } from "@/lib/types";
import { DomainError } from "./errors";
import { createRun } from "./runtime";
import { activateScript, deactivateScript, deployScript, getScript, listScripts } from "./scripts";
import { mutate, read } from "./store";
import { advance, makeScript, makeWorkspace, setDb, setupPipeline, T0, useTestStore } from "./test-helpers";

const event: ChangeEvent = {
  workspace_id: "",
  seq: 1,
  kind: "entity_added",
  url: "https://example.com",
  page_text: "Vendor: Acme Cloud",
  telem_run_id: "trun",
  received_at: T0.toISOString(),
};

describe("script status transitions", () => {
  useTestStore();

  it("developed -> active -> inactive -> active", async () => {
    const { script } = await setupPipeline("developed");

    advance(1000);
    const deployed = await deployScript(script.id);
    expect(deployed.status).toBe("active");
    expect(deployed.deployedAt).toBe(new Date(T0.getTime() + 1000).toISOString());
    expect(deployed.statusChangedAt).toBe(deployed.deployedAt);

    advance(1000);
    const deactivated = await deactivateScript(script.id);
    expect(deactivated.status).toBe("inactive");
    expect(deactivated.statusChangedAt).toBe(new Date(T0.getTime() + 2000).toISOString());

    advance(1000);
    const reactivated = await activateScript(script.id);
    expect(reactivated.status).toBe("active");
    // deployedAt is the first deployment and does not move.
    expect(reactivated.deployedAt).toBe(deployed.deployedAt);
    expect(reactivated.statusChangedAt).toBe(new Date(T0.getTime() + 3000).toISOString());

    expect((await getScript(script.id)).status).toBe("active");
  });

  const illegal: [ScriptStatus, "deploy" | "deactivate" | "activate"][] = [
    ["active", "deploy"],
    ["inactive", "deploy"],
    ["developed", "deactivate"],
    ["inactive", "deactivate"],
    ["developed", "activate"],
    ["active", "activate"],
  ];
  const actions = { deploy: deployScript, deactivate: deactivateScript, activate: activateScript };

  it.each(illegal)("a %s script cannot %s (409, unchanged)", async (status, action) => {
    const { script } = await setupPipeline(status);
    const error = await actions[action](script.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ status: 409 });
    const stored = (await read()).scripts[0];
    expect(stored.status).toBe(status);
    expect(stored.statusChangedAt).toBe(script.statusChangedAt);
  });

  it.each(["deploy", "deactivate", "activate"] as const)("%s on an unknown id is a 404", async (action) => {
    await setupPipeline();
    await expect(actions[action]("scr_missing")).rejects.toMatchObject({ status: 404 });
  });
});

describe("script views", () => {
  useTestStore();

  it("lists newest first, filters by status, and 404s an unknown id", async () => {
    const ws = makeWorkspace({ name: "Pricing" });
    const older = makeScript(ws, "active", { createdAt: "2026-11-01T00:00:00.000Z" });
    const newer = makeScript(ws, "developed", { createdAt: "2026-11-10T00:00:00.000Z" });
    await setDb({ workspaces: [ws], scripts: [older, newer] });

    expect((await listScripts()).map((s) => s.id)).toEqual([newer.id, older.id]);
    expect((await listScripts({ status: "active" })).map((s) => s.id)).toEqual([older.id]);
    expect((await listScripts())[0].workspaceName).toBe("Pricing");
    // @ts-expect-error: checking the runtime guard
    await expect(listScripts({ status: "bogus" })).rejects.toMatchObject({ status: 400 });
    await expect(getScript("scr_missing")).rejects.toMatchObject({ status: 404 });
  });

  it("derives activity, failure rate, counts and webhooks from runs", async () => {
    const { script, webhook } = await setupPipeline("active");
    const delivery = { id: "dlv_x", webhookId: webhook.id };
    const finished = (outcome: "succeeded" | "failed" | "invalid", minutesAgo: number) =>
      createRun(script, event, delivery, { outcome, at: new Date(T0.getTime() - minutesAgo * 60_000) });

    let view = await getScript(script.id);
    expect(view).toMatchObject({ activity: "idle", failureRate: null, lastRunAt: null, runsInFlight: 0 });
    expect(view.webhookIds).toEqual([webhook.id]);

    // 2 problems in the last 10 finished: idle, rate 0.2.
    await mutate((db) => {
      db.runs.push(finished("failed", 30), finished("invalid", 29));
      for (let i = 0; i < 8; i++) db.runs.push(finished("succeeded", 20 - i));
      db.runs.push(finished("succeeded", 26 * 60)); // older than a day
    });
    view = await getScript(script.id);
    expect(view.activity).toBe("idle");
    expect(view.failureRate).toBeCloseTo(0.2);
    expect(view.runsLast24h).toBe(10);
    expect(view.lastRunAt).toBe(new Date(T0.getTime() - 13 * 60_000).toISOString());

    // A run in flight: processing.
    await mutate((db) => {
      db.runs.push(createRun(script, event, delivery, { outcome: "succeeded", at: T0 }));
    });
    view = await getScript(script.id);
    expect(view.activity).toBe("processing");
    expect(view.runsInFlight).toBe(1);

    // Half of the last 10 finished runs failed: failing, which wins over processing.
    await mutate((db) => {
      for (let i = 0; i < 5; i++) db.runs.push(finished("failed", 5 - i));
    });
    view = await getScript(script.id);
    expect(view.failureRate).toBeCloseTo(0.5);
    expect(view.activity).toBe("failing");
  });

  it("is off whenever the script is not active", async () => {
    const { script } = await setupPipeline("inactive");
    await mutate((db) => {
      db.runs.push(createRun(script, event, { id: "d", webhookId: "w" }, { outcome: "failed", at: T0 }));
    });
    const view = await getScript(script.id);
    expect(view.activity).toBe("off");
    expect(view.runsInFlight).toBe(1);
  });
});
