import type {
  CreateWebhookInput,
  Delivery,
  TestEventInput,
  UpdateWebhookInput,
  Webhook,
  WebhookView,
} from "@/lib/types";
import { now } from "./clock";
import { DomainError, notFound } from "./errors";
import { newId } from "./ids";
import { ingestInto, seenSeqs, WEBHOOK_TYPE_HEADER } from "./ingest";
import { checkLimit, checkUrl } from "./runs";
import { hasScript } from "./scripts";
import { mutate, read, type Db, MAX_DELIVERIES } from "./store";
import { cleanText, newestFirst } from "./util";
import { loadRawWorkspaces } from "./workspaces";

export const MAX_WEBHOOK_NAME_LENGTH = 80;
export const MAX_SECRET_LENGTH = 500;
export const DEFAULT_DELIVERY_LIMIT = 50;

// -------------------------------------------------------------------- Views

/** `baseUrl` has no trailing slash, e.g. "http://localhost:3000". */
export function webhookUrl(id: string, baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/hooks/${id}`;
}

export function toWebhookView(webhook: Webhook, db: Db, baseUrl: string): WebhookView {
  const deliveries = db.deliveries.filter((d) => d.webhookId === webhook.id);
  const last = newestFirst(deliveries, (d) => d.receivedAt)[0];
  const { secret, ...rest } = webhook;
  return {
    ...rest,
    secretSet: typeof secret === "string" && secret !== "",
    url: webhookUrl(webhook.id, baseUrl),
    deliveryCount: deliveries.length,
    lastDeliveryAt: last ? last.receivedAt : null,
  };
}

// -------------------------------------------------------------------- Reads

/** Newest first. */
export async function listWebhooks(baseUrl: string): Promise<WebhookView[]> {
  const db = await read();
  return newestFirst(db.webhooks, (w) => w.createdAt).map((w) => toWebhookView(w, db, baseUrl));
}

export async function getWebhook(id: string, baseUrl: string): Promise<WebhookView> {
  const db = await read();
  return toWebhookView(findWebhook(db, id), db, baseUrl);
}

/** Newest first. Default 50. */
export async function listDeliveries(webhookId: string, limit?: number): Promise<Delivery[]> {
  const take = checkLimit(limit, DEFAULT_DELIVERY_LIMIT, MAX_DELIVERIES);
  const db = await read();
  findWebhook(db, webhookId);
  return newestFirst(
    db.deliveries.filter((d) => d.webhookId === webhookId),
    (d) => d.receivedAt,
  ).slice(0, take);
}

// ------------------------------------------------------------------- Writes

/** 400 if `scriptIds` names something that is not a script. */
export async function createWebhook(input: CreateWebhookInput, baseUrl: string): Promise<WebhookView> {
  const name = checkName(input?.name);
  const secret = checkSecret(input?.secret) ?? null;
  const scriptIds = await checkScriptIds(input?.scriptIds);
  return mutate((db) => {
    const webhook: Webhook = {
      id: newId("wh"),
      name,
      secret,
      enabled: true,
      scriptIds,
      createdAt: now().toISOString(),
    };
    db.webhooks.push(webhook);
    return toWebhookView(webhook, db, baseUrl);
  });
}

export async function updateWebhook(id: string, input: UpdateWebhookInput, baseUrl: string): Promise<WebhookView> {
  const name = input.name === undefined ? undefined : checkName(input.name);
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") {
    throw new DomainError(400, "enabled must be true or false.");
  }
  const secret = checkSecret(input.secret);
  const scriptIds = input.scriptIds === undefined ? undefined : await checkScriptIds(input.scriptIds);
  return mutate((db) => {
    const webhook = findWebhook(db, id);
    if (name !== undefined) webhook.name = name;
    if (input.enabled !== undefined) webhook.enabled = input.enabled;
    if (secret !== undefined) webhook.secret = secret;
    if (scriptIds !== undefined) webhook.scriptIds = scriptIds;
    return toWebhookView(webhook, db, baseUrl);
  });
}

/** Also deletes its deliveries. Runs it produced stay in the run log. */
export async function deleteWebhook(id: string): Promise<void> {
  await mutate((db) => {
    findWebhook(db, id);
    db.webhooks = db.webhooks.filter((w) => w.id !== id);
    db.deliveries = db.deliveries.filter((d) => d.webhookId !== id);
  });
}

/**
 * Sends an agent.changes delivery naming `url` through the real ingest path,
 * with a seq one higher than any this webhook has seen. Every active script
 * the webhook routes to then runs that page for real. 403 if the webhook is
 * disabled. Call `drainRuns()` afterwards.
 */
export async function sendTestEvent(webhookId: string, input: TestEventInput): Promise<Delivery> {
  const url = checkUrl(input?.url);
  return mutate((db) => {
    const webhook = findWebhook(db, webhookId);
    // Checked here too so a disabled webhook fails before a payload is built.
    if (!webhook.enabled) throw new DomainError(403, "This webhook is disabled.");
    const seq = Math.max(0, ...seenSeqs(db, webhook.id)) + 1;
    const rawBody = JSON.stringify({
      type: "agent.changes",
      monitor_id: "mon_sentinel_test",
      changes: [{ seq, kind: "entity_added", url, title: "Test event from Sentinel" }],
      next_cursor: `cur_test_${seq}`,
      watermark: now().toISOString(),
    });
    const headers = new Headers({
      "content-type": "application/json",
      [WEBHOOK_TYPE_HEADER]: "agent.changes",
    });
    return ingestInto(db, webhook.id, headers, rawBody, { isTest: true });
  });
}

// ------------------------------------------------------------------ Helpers

function findWebhook(db: Db, id: string): Webhook {
  const webhook = db.webhooks.find((w) => w.id === id);
  if (!webhook) throw notFound("webhook", id);
  return webhook;
}

function checkName(raw: unknown): string {
  const name = cleanText(typeof raw === "string" ? raw : "");
  if (name === "") throw new DomainError(400, "Give the webhook a name.");
  if (name.length > MAX_WEBHOOK_NAME_LENGTH) {
    throw new DomainError(400, `The name is too long (at most ${MAX_WEBHOOK_NAME_LENGTH} characters).`);
  }
  return name;
}

/** undefined: leave as it is. null or blank: remove. Otherwise the trimmed secret. */
function checkSecret(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") throw new DomainError(400, "secret must be text.");
  const secret = raw.trim();
  if (secret.length > MAX_SECRET_LENGTH) throw new DomainError(400, "That secret is too long.");
  return secret === "" ? null : secret;
}

/** Deduplicated, in the order given. 400 for anything that is not a script in the runtime. */
async function checkScriptIds(raw: unknown): Promise<string[]> {
  if (!Array.isArray(raw) || raw.some((id) => typeof id !== "string")) {
    throw new DomainError(400, "scriptIds must be a list of script ids.");
  }
  const ids = [...new Set(raw as string[])];
  if (ids.length === 0) return ids;
  const known = new Set((await loadRawWorkspaces()).filter(hasScript).map((w) => w.id));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new DomainError(400, `Unknown script${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}.`);
  }
  return ids;
}
