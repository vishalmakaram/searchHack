import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_DELIVERIES, MAX_RUNS, dbPath, mutate, read, reset } from "./store";
import { runStatusAt } from "./runtime";
import { makeWebhook, T0, useTestStore } from "./test-helpers";
import type { Delivery, Run } from "@/lib/types";

describe("store", () => {
  const store = useTestStore();

  it("seeds a missing file on first read", async () => {
    const db = await read();
    expect(db.workspaces).toHaveLength(2);
    expect(db.webhooks).toHaveLength(2);
    expect(db.scripts.map((s) => s.status).sort()).toEqual(["active", "active", "developed", "inactive"]);
    expect(db.deliveries).toHaveLength(15);
    expect(db.runs).toHaveLength(30);

    const statuses = db.runs.map((r) => runStatusAt(r, T0));
    expect(statuses.every((s) => s === "succeeded" || s === "invalid" || s === "failed")).toBe(true);
    expect(statuses.filter((s) => s === "failed").length).toBeGreaterThan(0);
    expect(statuses.filter((s) => s === "invalid").length).toBeGreaterThan(0);
    expect(db.runs.every((r) => Date.parse(r.queuedAt) > T0.getTime() - 24 * 3600_000)).toBe(true);

    const onDisk = JSON.parse(await readFile(dbPath(), "utf8"));
    expect(onDisk.workspaces.map((w: { id: string }) => w.id)).toEqual(db.workspaces.map((w) => w.id));
  });

  it("seeds only once when first reads race", async () => {
    const [a, b, c] = await Promise.all([read(), read(), read()]);
    expect(b.workspaces.map((w) => w.id)).toEqual(a.workspaces.map((w) => w.id));
    expect(c.workspaces.map((w) => w.id)).toEqual(a.workspaces.map((w) => w.id));
  });

  it("applies concurrent mutations one at a time", async () => {
    await Promise.all(
      Array.from({ length: 20 }, () =>
        mutate((db) => {
          db.webhooks.push(makeWebhook([], { name: `hook ${db.webhooks.length}` }));
        }),
      ),
    );
    const names = (await read()).webhooks.map((w) => w.name).slice(2);
    expect(names).toEqual(Array.from({ length: 20 }, (_, i) => `hook ${i + 2}`));
  });

  it("saves nothing when a mutation throws, and keeps going", async () => {
    await read();
    await expect(
      mutate((db) => {
        db.webhooks = [];
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect((await read()).webhooks).toHaveLength(2);
    await expect(mutate((db) => db.webhooks.length)).resolves.toBe(2);
  });

  it("refuses an async mutation without saving it", async () => {
    await read();
    await expect(
      mutate(async (db) => {
        db.webhooks = [];
      }),
    ).rejects.toThrow(TypeError);
    expect((await read()).webhooks).toHaveLength(2);
  });

  it("keeps only the newest 500 deliveries and runs", async () => {
    await mutate((db) => {
      const base = db.deliveries[0];
      const run = db.runs[0];
      db.deliveries = Array.from({ length: 520 }, (_, i): Delivery => ({
        ...base,
        id: `dlv_${i}`,
        receivedAt: new Date(T0.getTime() - (520 - i) * 1000).toISOString(),
      }));
      db.runs = Array.from({ length: 510 }, (_, i): Run => ({
        ...run,
        id: `run_${i}`,
        queuedAt: new Date(T0.getTime() - (510 - i) * 1000).toISOString(),
      }));
    });
    const db = await read();
    expect(db.deliveries).toHaveLength(MAX_DELIVERIES);
    expect(db.deliveries[0].id).toBe("dlv_20");
    expect(db.deliveries.at(-1)?.id).toBe("dlv_519");
    expect(db.runs).toHaveLength(MAX_RUNS);
    expect(db.runs[0].id).toBe("run_10");
  });

  it("reset wipes and reseeds", async () => {
    const before = await read();
    await mutate((db) => {
      db.workspaces = [];
    });
    await reset();
    const after = await read();
    expect(after.workspaces).toHaveLength(2);
    expect(after.workspaces[0].id).not.toBe(before.workspaces[0].id);
  });

  it("writes through a temp file and leaves none behind", async () => {
    await read();
    await Promise.all(Array.from({ length: 5 }, () => mutate(() => undefined)));
    expect(await readdir(store.dir())).toEqual(["db.json"]);
  });

  it("moves a corrupt file aside and reseeds", async () => {
    await writeFile(dbPath(), "{ not json", "utf8");
    const db = await read();
    expect(db.workspaces).toHaveLength(2);
    const files = await readdir(path.dirname(dbPath()));
    expect(files.some((f) => f.startsWith("db.json.corrupt-"))).toBe(true);
  });
});
