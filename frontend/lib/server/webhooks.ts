import type {
  CreateWebhookInput,
  Delivery,
  Script,
  UpdateWebhookInput,
  Webhook,
  WebhookView,
} from "@/lib/types";
import { now } from "./clock";
import { DomainError, notFound } from "./errors";
import { newId, newSecret, randomString } from "./ids";
import { ingestInto, seenSeqs, WEBHOOK_TYPE_HEADER } from "./ingest";
import { checkLimit, typeKind } from "./runtime";
import { mutate, read, type Db, MAX_DELIVERIES } from "./store";
import { cleanText, newestFirst } from "./util";

export const MAX_WEBHOOK_NAME_LENGTH = 80;
export const DEFAULT_DELIVERY_LIMIT = 50;

// -------------------------------------------------------------------- Views

/** `baseUrl` has no trailing slash, e.g. "http://localhost:3000". */
export function webhookUrl(id: string, baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/hooks/${id}`;
}

export function toWebhookView(webhook: Webhook, db: Db, baseUrl: string): WebhookView {
  const deliveries = db.deliveries.filter((d) => d.webhookId === webhook.id);
  const last = newestFirst(deliveries, (d) => d.receivedAt)[0];
  return {
    ...webhook,
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

/** Generates the secret. 400 if `scriptIds` names an unknown script. */
export async function createWebhook(input: CreateWebhookInput, baseUrl: string): Promise<WebhookView> {
  const name = checkName(input?.name);
  return mutate((db) => {
    const webhook: Webhook = {
      id: newId("wh"),
      name,
      secret: newSecret(),
      enabled: true,
      scriptIds: checkScriptIds(db, input?.scriptIds),
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
  return mutate((db) => {
    const webhook = findWebhook(db, id);
    if (name !== undefined) webhook.name = name;
    if (input.enabled !== undefined) webhook.enabled = input.enabled;
    if (input.scriptIds !== undefined) webhook.scriptIds = checkScriptIds(db, input.scriptIds);
    return toWebhookView(webhook, db, baseUrl);
  });
}

/** Also deletes its deliveries. Runs it produced stay with their scripts. */
export async function deleteWebhook(id: string): Promise<void> {
  await mutate((db) => {
    findWebhook(db, id);
    db.webhooks = db.webhooks.filter((w) => w.id !== id);
    db.deliveries = db.deliveries.filter((d) => d.webhookId !== id);
  });
}

/**
 * Sends a sample agent.changes delivery through the real ingest path, with a
 * seq one higher than any this webhook has seen. 403 if the webhook is disabled.
 */
export async function sendTestEvent(webhookId: string): Promise<Delivery> {
  return mutate((db) => {
    const webhook = findWebhook(db, webhookId);
    // Checked here too so a disabled webhook fails before a payload is built.
    if (!webhook.enabled) throw new DomainError(403, "This webhook is disabled.");
    const targets = webhook.scriptIds.flatMap((id) => db.scripts.filter((s) => s.id === id));
    const sample = targets.find((s) => s.status === "active") ?? targets[0] ?? null;
    const seq = Math.max(0, ...seenSeqs(db, webhook.id)) + 1;
    const rawBody = JSON.stringify(testPayload(seq, sample));
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

/** Deduplicated, in the order given. 400 for anything unknown. */
function checkScriptIds(db: Db, raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.some((id) => typeof id !== "string")) {
    throw new DomainError(400, "scriptIds must be a list of script ids.");
  }
  const ids = [...new Set(raw as string[])];
  const unknown = ids.filter((id) => !db.scripts.some((s) => s.id === id));
  if (unknown.length > 0) {
    throw new DomainError(400, `Unknown script${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}.`);
  }
  return ids;
}

function testPayload(seq: number, script: Script | null) {
  const at = now();
  const url = `https://telem.example/test/${seq}`;
  return {
    type: "agent.changes",
    monitor_id: "mon_sentinel_test",
    changes: [
      {
        seq,
        kind: "entity_added",
        url,
        title: "Test event from Sentinel",
        page_text: samplePage(script, url, at),
        telem_run_id: `trun_test_${randomString(8)}`,
      },
    ],
    next_cursor: `cur_test_${seq}`,
    watermark: at.toISOString(),
  };
}

const SAMPLE_VALUES: Record<string, string> = {
  title: "Test event from Sentinel",
  summary: "A sample change sent with the Send test event button.",
  vendor: "Acme Cloud",
  plan: "Team",
  old_price: "49",
  new_price: "59",
  currency: "EUR",
  authority: "Office for AI Oversight",
  company: "Novacrest AI",
  action: "warning",
  penalty_amount: "none",
  penalty_eur: "none",
  role: "Staff engineer",
  location: "Remote (EU)",
  seniority: "staff",
  product: "Sentinel test product",
  version: "1.0",
};

/** "Field name: value" lines for the target script's schema, which the mock runtime reads back. */
function samplePage(script: Script | null, url: string, at: Date): string {
  const lines = ["Test event from Sentinel", ""];
  const schema = script?.extractionSchema ?? { summary: "string" };
  for (const [field, type] of Object.entries(schema)) {
    const label = field.charAt(0).toUpperCase() + field.slice(1).replace(/_/g, " ");
    lines.push(`${label}: ${sampleValue(field, type, url, at)}`);
  }
  return lines.join("\n");
}

function sampleValue(field: string, type: string, url: string, at: Date): string {
  if (SAMPLE_VALUES[field]) return SAMPLE_VALUES[field];
  switch (typeKind(type)) {
    case "number":
      return "42";
    case "boolean":
      return "yes";
    case "date":
      return at.toISOString().slice(0, 10);
    case "url":
      return url;
    case "list":
      return "first example, second example";
    default:
      return /url|link/.test(field) ? url : `Sample ${field.replace(/_/g, " ")}`;
  }
}
