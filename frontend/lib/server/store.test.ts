import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_DELIVERIES, MAX_RUNS, dbPath, emptyDb, mutate, read, reset } from "./store";
import { makeRun, makeWebhook, T0, useTestStore } from "./test-helpers";
import type { Delivery, Run } from "@/lib/types";

const delivery = (i: number): Delivery => ({
  id: `dlv_${i}`,
  webhookId: "wh_x",
  receivedAt: new Date(T0.getTime() - (520 - i) * 1000).toISOString(),
  webhookType: "agent.changes",
  signature: "not_checked",
  isTest: false,
  bodyBytes: 2,
  body: {},
  eventCount: 0,
  duplicateCount: 0,
  eventsWithoutUrl: 0,
  runIds: [],
  skipped: [],
});

describe("store", () => {
  const store = useTestStore();

  it("starts empty and creates the file on first read", async () => {
    expect(await read()).toEqual(emptyDb());
    expect(JSON.parse(await readFile(dbPath(), "utf8"))).toEqual(emptyDb());
  });

  it("applies concurrent mutations one at a time", async () => {
    await Promise.all(
      Array.from({ length: 20 }, () =>
        mutate((db) => {
          db.webhooks.push(makeWebhook([], { name: `hook ${db.webhooks.length}` }));
        }),
      ),
    );
    const names = (await read()).webhooks.map((w) => w.name);
    expect(names).toEqual(Array.from({ length: 20 }, (_, i) => `hook ${i}`));
  });

  it("saves nothing when a mutation throws, and keeps going", async () => {
    await mutate((db) => void db.webhooks.push(makeWebhook([])));
    await expect(
      mutate((db) => {
        db.webhooks = [];
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect((await read()).webhooks).toHaveLength(1);
    await expect(mutate((db) => db.webhooks.length)).resolves.toBe(1);
  });

  it("refuses an async mutation without saving it", async () => {
    await mutate((db) => void db.webhooks.push(makeWebhook([])));
    await expect(
      mutate(async (db) => {
        db.webhooks = [];
      }),
    ).rejects.toThrow(TypeError);
    expect((await read()).webhooks).toHaveLength(1);
  });

  it("keeps only the newest 500 deliveries and runs", async () => {
    await mutate((db) => {
      db.deliveries = Array.from({ length: 520 }, (_, i) => delivery(i));
      db.runs = Array.from({ length: 510 }, (_, i): Run =>
        makeRun("ws_x", { id: `run_${i}`, queuedAt: new Date(T0.getTime() - (510 - i) * 1000).toISOString() }),
      );
    });
    const db = await read();
    expect(db.deliveries).toHaveLength(MAX_DELIVERIES);
    expect(db.deliveries[0].id).toBe("dlv_20");
    expect(db.deliveries.at(-1)?.id).toBe("dlv_519");
    expect(db.runs).toHaveLength(MAX_RUNS);
    expect(db.runs[0].id).toBe("run_10");
  });

  it("reset empties the store", async () => {
    await mutate((db) => void db.webhooks.push(makeWebhook([])));
    await reset();
    expect(await read()).toEqual(emptyDb());
  });

  it("writes through a temp file and leaves none behind", async () => {
    await read();
    await Promise.all(Array.from({ length: 5 }, () => mutate(() => undefined)));
    expect(await readdir(store.dir())).toEqual(["db.json"]);
  });

  it("moves a corrupt file aside and starts empty", async () => {
    await writeFile(dbPath(), "{ not json", "utf8");
    expect(await read()).toEqual(emptyDb());
    const files = await readdir(path.dirname(dbPath()));
    expect(files.some((f) => f.startsWith("db.json.corrupt-"))).toBe(true);
  });

  it("reads a file from the earlier mock version without its old collections", async () => {
    await writeFile(dbPath(), JSON.stringify({ workspaces: [{ id: "ws_old" }], webhooks: [] }), "utf8");
    expect(await read()).toEqual(emptyDb());
  });
});
