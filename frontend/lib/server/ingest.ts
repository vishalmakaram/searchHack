// The webhook receiver's logic. The HTTP route checks the 1 MB limit, reads
// the raw body as text and hands it here.
//
// 1. Check the signature, then record a Delivery. A delivery whose signature
//    is wrong is recorded and goes no further.
// 2. Turn the body into events. An agent.changes envelope
//    `{ type, monitor_id, changes[], next_cursor, watermark }` gives one event
//    per item in `changes`; any other body is one event. No shape is rejected.
// 3. Drop events whose seq this webhook has already seen (Telem delivers at
//    least once). An event without a numeric seq is never a duplicate.
// 4. For each remaining event that names a page, and each routed script: an
//    active script gets a queued run; any other script is recorded as skipped.
//    The caller starts the queue once this is saved.

import type { Delivery, WebhookType } from "@/lib/types";
import { now } from "./clock";
import { DomainError, notFound } from "./errors";
import { newId } from "./ids";
import { queueRun } from "./runs";
import { mutate, type Db } from "./store";
import { isRecord } from "./util";
import { verifySignature } from "./verify";

/** The route enforces the limit first; this is a backstop. */
export const MAX_BODY_BYTES = 1024 * 1024;

export const WEBHOOK_TYPE_HEADER = "telem-webhook-type";

export interface ReceiveOptions {
  isTest?: boolean;
}

/**
 * Throws 404 for an unknown webhook, 403 for a disabled one, 413 for a body
 * over 1 MB. A wrong signature is not thrown: the delivery comes back with
 * `signature: "invalid"` and the route answers 401.
 */
export async function receive(
  webhookId: string,
  headers: Headers,
  rawBody: string,
  options: ReceiveOptions = {},
): Promise<Delivery> {
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    throw new DomainError(413, "The body is larger than 1 MB.");
  }
  return mutate((db) => ingestInto(db, webhookId, headers, rawBody, options));
}

/** Does the whole receive inside an open mutation. Also used by the test-event route. */
export function ingestInto(
  db: Db,
  webhookId: string,
  headers: Headers,
  rawBody: string,
  options: ReceiveOptions = {},
): Delivery {
  const webhook = db.webhooks.find((w) => w.id === webhookId);
  if (!webhook) throw notFound("webhook", webhookId);
  if (!webhook.enabled) throw new DomainError(403, "This webhook is disabled.");

  const at = now();
  const body = parseBody(rawBody);
  const webhookType = readWebhookType(headers, body);
  const events = extractEvents(webhookType, body);

  const delivery: Delivery = {
    id: newId("dlv"),
    webhookId: webhook.id,
    receivedAt: at.toISOString(),
    webhookType,
    // The in-app test button is not signed; there is nothing to check.
    signature: options.isTest ? "not_checked" : verifySignature(webhook.secret, headers, rawBody),
    isTest: options.isTest === true,
    bodyBytes: Buffer.byteLength(rawBody, "utf8"),
    body,
    eventCount: events.length,
    duplicateCount: 0,
    eventsWithoutUrl: 0,
    runIds: [],
    skipped: [],
  };

  if (delivery.signature === "invalid") {
    // Kept in the log so the mismatch is visible, but its events are not trusted:
    // they create no runs and do not count as seen.
    delivery.body = "(not stored: the signature did not match)";
    db.deliveries.push(delivery);
    return delivery;
  }

  const seen = seenSeqs(db, webhook.id);
  const kept: RawEvent[] = [];
  for (const event of events) {
    if (event.seq !== null) {
      if (seen.has(event.seq)) {
        delivery.duplicateCount++;
        continue;
      }
      seen.add(event.seq);
    }
    kept.push(event);
  }

  const targets = webhook.scriptIds.map((id) => db.scripts.find((s) => s.id === id) ?? { id, name: id, status: "developed" as const });
  for (const event of kept) {
    const url = pageUrl(event.url);
    if (url === null) {
      delivery.eventsWithoutUrl++;
      continue;
    }
    for (const script of targets) {
      if (script.status !== "active") {
        // One entry per script, not per event: the reason is the same for every event.
        if (!delivery.skipped.some((s) => s.scriptId === script.id)) {
          delivery.skipped.push({ scriptId: script.id, reason: "script_not_active" });
        }
        continue;
      }
      const run = queueRun(
        db,
        { scriptId: script.id, scriptName: script.name, source: "webhook", url, webhookId: webhook.id, deliveryId: delivery.id },
        at,
      );
      delivery.runIds.push(run.id);
    }
  }

  db.deliveries.push(delivery);
  return delivery;
}

// -------------------------------------------------------------- Body parsing

/** An event as read from a body. */
export interface RawEvent {
  seq: number | null;
  url: string;
}

/** Parsed JSON, or the raw string when it is not JSON. */
export function parseBody(rawBody: string): unknown {
  if (rawBody.trim() === "") return rawBody;
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    return rawBody;
  }
}

/** From the header. Without one, a body that names a known `type` is trusted. */
export function readWebhookType(headers: Headers, body: unknown): WebhookType {
  const header = headers.get(WEBHOOK_TYPE_HEADER);
  const value = header ?? (isRecord(body) && typeof body.type === "string" ? body.type : "");
  const type = value.trim().toLowerCase();
  return type === "agent.changes" || type === "vendor.items" ? type : "unknown";
}

export function extractEvents(webhookType: WebhookType, body: unknown): RawEvent[] {
  if (webhookType === "agent.changes" && isRecord(body) && Array.isArray(body.changes)) {
    return body.changes.map(readEvent);
  }
  if (isRecord(body) && Array.isArray(body.items)) return body.items.map(readEvent);
  return [readEvent(body)];
}

/** Every numeric seq in this webhook's earlier deliveries. */
export function seenSeqs(db: Db, webhookId: string): Set<number> {
  const seen = new Set<number>();
  for (const delivery of db.deliveries) {
    if (delivery.webhookId !== webhookId) continue;
    for (const event of extractEvents(delivery.webhookType, delivery.body)) {
      if (event.seq !== null) seen.add(event.seq);
    }
  }
  return seen;
}

const URL_KEYS = ["url", "link", "source_url", "page_url", "href"];

function readEvent(item: unknown): RawEvent {
  if (!isRecord(item)) return { seq: null, url: "" };
  // Telem nests the changed entity in some change kinds; look one level down too.
  const nested = [item.entity, item.item, item.data, item.after].filter(isRecord);
  const url = firstString(item, URL_KEYS) ?? nested.map((n) => firstString(n, URL_KEYS)).find((u) => u !== null) ?? "";
  return { seq: readSeq(item.seq), url };
}

function readSeq(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value.trim());
  return null;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

/** The address as an http(s) URL, or null when the event does not name a page. */
function pageUrl(raw: string): string | null {
  if (raw === "") return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
