import type {
  ApproveWorkspaceInput,
  CreateWorkspaceInput,
  Frequency,
  UpdateWorkspaceInput,
  Workspace,
  WorkspaceStatus,
  WorkspaceView,
} from "@/lib/types";
import { now } from "./clock";
import { DomainError, notFound } from "./errors";
import { newId } from "./ids";
import { buildScript, COMPILE_MS, compileIntent } from "./mock-compiler";
import { mutate, read, type Db } from "./store";
import { cleanText, iso, ms, newestFirst } from "./util";

export const FREQUENCIES: readonly Frequency[] = ["1h", "6h", "12h", "1d", "7d"];
export const MAX_INTENT_LENGTH = 1000;
export const MAX_NAME_LENGTH = 80;
export const MAX_QUERY_LENGTH = 300;
export const MAX_QUERIES = 20;

// ------------------------------------------------------------------- Status

/** compiling until compileReadyAt, then awaiting_approval, then ready once approved. */
export function workspaceStatusAt(workspace: Workspace, at: Date): WorkspaceStatus {
  if (workspace.approvedAt !== null) return "ready";
  return at.getTime() < ms(workspace.compileReadyAt) ? "compiling" : "awaiting_approval";
}

export function toWorkspaceView(workspace: Workspace, at: Date = now()): WorkspaceView {
  return { ...workspace, status: workspaceStatusAt(workspace, at) };
}

// -------------------------------------------------------------------- Reads

export async function listWorkspaces(): Promise<WorkspaceView[]> {
  const db = await read();
  const at = now();
  return newestFirst(db.workspaces, (w) => w.createdAt).map((w) => toWorkspaceView(w, at));
}

export async function getWorkspace(id: string): Promise<WorkspaceView> {
  const db = await read();
  return toWorkspaceView(findWorkspace(db, id));
}

// ------------------------------------------------------------------- Writes

export async function createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceView> {
  const intent = cleanText(typeof input?.intent === "string" ? input.intent : "");
  if (intent === "") throw new DomainError(400, "Describe what you want watched.");
  if (intent.length > MAX_INTENT_LENGTH) {
    throw new DomainError(400, `The description is too long (at most ${MAX_INTENT_LENGTH} characters).`);
  }

  const at = now();
  const proposal = compileIntent(intent);
  const workspace: Workspace = {
    id: newId("ws"),
    name: proposal.name.slice(0, MAX_NAME_LENGTH),
    intent,
    queries: proposal.queries.map((text) => ({ id: newId("q"), text })),
    frequency: proposal.frequency,
    escalationProviders: proposal.escalationProviders,
    extractionSchema: proposal.extractionSchema,
    scriptId: null,
    createdAt: at.toISOString(),
    compileReadyAt: iso(at.getTime() + COMPILE_MS),
    approvedAt: null,
  };
  await mutate((db) => {
    db.workspaces.push(workspace);
  });
  return toWorkspaceView(workspace, at);
}

/** Name can always change. Queries and frequency are frozen once approved (409 if they differ). */
export async function updateWorkspace(id: string, input: UpdateWorkspaceInput): Promise<WorkspaceView> {
  const name = input.name === undefined ? undefined : checkName(input.name);
  const queries = input.queries === undefined ? undefined : checkQueries(input.queries);
  if (input.frequency !== undefined && !FREQUENCIES.includes(input.frequency)) {
    throw new DomainError(400, `Unknown frequency "${String(input.frequency)}".`);
  }

  return mutate((db) => {
    const workspace = findWorkspace(db, id);
    const approved = workspace.approvedAt !== null;
    const queriesChange = queries !== undefined && !sameTexts(queries, workspace.queries);
    const frequencyChange = input.frequency !== undefined && input.frequency !== workspace.frequency;
    if (approved && (queriesChange || frequencyChange)) {
      throw new DomainError(409, "Queries and frequency are frozen once a workspace is approved.");
    }

    if (name !== undefined) workspace.name = name;
    if (queries !== undefined && queriesChange) workspace.queries = withIds(queries, workspace.queries);
    if (input.frequency !== undefined) workspace.frequency = input.frequency;
    return toWorkspaceView(workspace);
  });
}

/** Also deletes the workspace's scripts and their runs, and unroutes those scripts from every webhook. Deliveries stay. */
export async function deleteWorkspace(id: string): Promise<void> {
  await mutate((db) => {
    const workspace = findWorkspace(db, id);
    const scriptIds = new Set(
      db.scripts.filter((s) => s.workspaceId === workspace.id || s.id === workspace.scriptId).map((s) => s.id),
    );
    db.workspaces = db.workspaces.filter((w) => w.id !== workspace.id);
    db.scripts = db.scripts.filter((s) => !scriptIds.has(s.id));
    db.runs = db.runs.filter((r) => !scriptIds.has(r.scriptId));
    for (const webhook of db.webhooks) {
      webhook.scriptIds = webhook.scriptIds.filter((sid) => !scriptIds.has(sid));
    }
  });
}

/** Saves the final queries and creates the workspace's `developed` script. */
export async function approveWorkspace(id: string, input: ApproveWorkspaceInput): Promise<WorkspaceView> {
  const queries = checkQueries(input?.queries);

  return mutate((db) => {
    const workspace = findWorkspace(db, id);
    const at = now();
    const status = workspaceStatusAt(workspace, at);
    if (status === "ready") throw new DomainError(409, "This workspace is already approved.");
    if (status === "compiling") {
      throw new DomainError(409, "This workspace is still compiling; wait for the proposed queries.");
    }

    workspace.queries = withIds(queries, workspace.queries);
    const script = buildScript(workspace, { at });
    db.scripts.push(script);
    workspace.scriptId = script.id;
    workspace.approvedAt = at.toISOString();
    return toWorkspaceView(workspace, at);
  });
}

// ------------------------------------------------------------------ Helpers

function findWorkspace(db: Db, id: string): Workspace {
  const workspace = db.workspaces.find((w) => w.id === id);
  if (!workspace) throw notFound("workspace", id);
  return workspace;
}

function checkName(raw: unknown): string {
  const name = cleanText(typeof raw === "string" ? raw : "");
  if (name === "") throw new DomainError(400, "The name cannot be empty.");
  if (name.length > MAX_NAME_LENGTH) {
    throw new DomainError(400, `The name is too long (at most ${MAX_NAME_LENGTH} characters).`);
  }
  return name;
}

/** Trimmed, blank and repeated queries dropped. 400 if nothing is left. */
function checkQueries(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new DomainError(400, "queries must be a list of strings.");
  const seen = new Set<string>();
  const queries: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") throw new DomainError(400, "queries must be a list of strings.");
    const text = cleanText(item);
    if (text === "" || seen.has(text.toLowerCase())) continue;
    if (text.length > MAX_QUERY_LENGTH) {
      throw new DomainError(400, `A query is too long (at most ${MAX_QUERY_LENGTH} characters).`);
    }
    seen.add(text.toLowerCase());
    queries.push(text);
  }
  if (queries.length === 0) throw new DomainError(400, "Keep at least one query.");
  if (queries.length > MAX_QUERIES) throw new DomainError(400, `At most ${MAX_QUERIES} queries.`);
  return queries;
}

function sameTexts(texts: string[], queries: Workspace["queries"]): boolean {
  return texts.length === queries.length && texts.every((t, i) => t === queries[i].text);
}

/** Keeps the id of any query whose text is unchanged. */
function withIds(texts: string[], previous: Workspace["queries"]): Workspace["queries"] {
  const unused = [...previous];
  return texts.map((text) => {
    const index = unused.findIndex((q) => q.text === text);
    if (index === -1) return { id: newId("q"), text };
    return { id: unused.splice(index, 1)[0].id, text };
  });
}
