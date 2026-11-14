// The whole app state lives in one JSON file, frontend/.data/db.json.
//
// - Reads parse the file fresh every time. Nothing is cached in memory,
//   because module state does not survive dev-server reloads.
// - Writes go to a temp file that is renamed into place, so a reader never
//   sees half a file.
// - Mutations run one at a time through a promise chain kept on globalThis,
//   which (unlike module state) is shared by every reloaded copy of this
//   module in the process.
// - A missing file is seeded on first use.
//
// The /* turbopackIgnore: true */ comments stop `next build` from tracing the
// whole project into the server output because of these runtime paths.

import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Delivery, Run, Script, Webhook, Workspace } from "@/lib/types";
import { now } from "./clock";
import { newestFirst } from "./util";

export interface Db {
  workspaces: Workspace[];
  scripts: Script[];
  webhooks: Webhook[];
  deliveries: Delivery[];
  runs: Run[];
}

/** Only the newest this many deliveries and runs are kept. */
export const MAX_DELIVERIES = 500;
export const MAX_RUNS = 500;

// ---------------------------------------------------------------- Public API

export async function read(): Promise<Db> {
  const file = dbPath();
  try {
    return normalize(JSON.parse(await readFile(/* turbopackIgnore: true */ file, "utf8")));
  } catch {
    // Missing or unreadable: let the queue seed or repair it, once.
    return enqueue(() => loadOrSeed(file));
  }
}

/**
 * Runs `fn` against the current state and saves whatever it changed. `fn`
 * must be synchronous; throw (normally a DomainError) to abort without
 * saving. Resolves with `fn`'s return value.
 */
export function mutate<T>(fn: (db: Db) => T): Promise<T> {
  return enqueue(async () => {
    const file = dbPath();
    const db = await loadOrSeed(file);
    const result = fn(db);
    if (isThenable(result)) {
      throw new TypeError("mutate() needs a synchronous function; the change was not saved.");
    }
    await writeDb(file, capped(db));
    return result;
  });
}

/** Wipe and reseed. */
export function reset(): Promise<void> {
  return enqueue(async () => {
    await writeDb(dbPath(), await buildSeedDb());
  });
}

export function emptyDb(): Db {
  return { workspaces: [], scripts: [], webhooks: [], deliveries: [], runs: [] };
}

// ------------------------------------------------------------- Test support

let pathOverride: string | null = null;

/** Tests only: point the store at another file. Pass null to restore the default. */
export function setDbPath(file: string | null): void {
  pathOverride = file;
}

export function dbPath(): string {
  return pathOverride ?? path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "db.json");
}

// ------------------------------------------------------------------ Internal

const QUEUE_KEY = "__sentinelStoreQueue";
type QueueHolder = { [QUEUE_KEY]?: Promise<unknown> };

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const holder = globalThis as QueueHolder;
  const previous = holder[QUEUE_KEY] ?? Promise.resolve();
  const next = previous.then(task);
  // The chain itself never rejects, so one failed task cannot block the rest.
  holder[QUEUE_KEY] = next.catch(() => undefined);
  return next;
}

/** Call only from inside the queue. */
async function loadOrSeed(file: string): Promise<Db> {
  let text: string;
  try {
    text = await readFile(/* turbopackIgnore: true */ file, "utf8");
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    const db = await buildSeedDb();
    await writeDb(file, db);
    return db;
  }
  try {
    return normalize(JSON.parse(text));
  } catch {
    // A hand-edited or otherwise broken file: keep it aside and start over.
    const aside = `${file}.corrupt-${Date.now()}`;
    await rename(/* turbopackIgnore: true */ file, aside);
    console.warn(`[store] ${file} was not valid JSON; moved it to ${aside} and reseeded.`);
    const db = await buildSeedDb();
    await writeDb(file, db);
    return db;
  }
}

async function writeDb(file: string, db: Db): Promise<void> {
  await mkdir(/* turbopackIgnore: true */ path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await writeFile(/* turbopackIgnore: true */ temp, JSON.stringify(db, null, 2), "utf8");
    await rename(/* turbopackIgnore: true */ temp, file);
  } catch (error) {
    await unlink(/* turbopackIgnore: true */ temp).catch(() => undefined);
    throw error;
  }
}

async function buildSeedDb(): Promise<Db> {
  // Imported lazily: seed.ts builds runs with runtime.ts, which reads this
  // module, so a static import would be a cycle.
  const { buildSeed } = await import("./seed");
  return capped(buildSeed(now()));
}

function capped(db: Db): Db {
  if (db.deliveries.length > MAX_DELIVERIES) {
    const keep = new Set(newestFirst(db.deliveries, (d) => d.receivedAt).slice(0, MAX_DELIVERIES));
    db.deliveries = db.deliveries.filter((d) => keep.has(d));
  }
  if (db.runs.length > MAX_RUNS) {
    const keep = new Set(newestFirst(db.runs, (r) => r.queuedAt).slice(0, MAX_RUNS));
    db.runs = db.runs.filter((r) => keep.has(r));
  }
  return db;
}

function normalize(value: unknown): Db {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SyntaxError("db.json does not hold an object");
  }
  const raw = value as Partial<Record<keyof Db, unknown>>;
  const list = <T>(key: keyof Db): T[] => (Array.isArray(raw[key]) ? (raw[key] as T[]) : []);
  return {
    workspaces: list<Workspace>("workspaces"),
    scripts: list<Script>("scripts"),
    webhooks: list<Webhook>("webhooks"),
    deliveries: list<Delivery>("deliveries"),
    runs: list<Run>("runs"),
  };
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

function isThenable(value: unknown): boolean {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}
