// The webhook receiver's logic. The HTTP route checks the 1 MB limit, reads
// the raw body as text and hands it here.
//
// 1. Record a Delivery; Telem-Webhook-Type sets its webhookType.
// 2. Turn the body into events. An agent.changes envelope
//    `{ type, monitor_id, changes[], next_cursor, watermark }` gives one event
//    per item in `changes`; any other body is one event. No shape is rejected.
// 3. Drop events whose seq this webhook has already seen (Telem delivers at
//    least once). An event without a numeric seq is never a duplicate.
// 4. For each remaining event and each routed script: an active script gets a
//    run; any other script is recorded as skipped.

import type { ChangeEvent } from "@/lib/contracts";
import type { Delivery, WebhookType } from "@/lib/types";
import { now } from "./clock";
import { DomainError, notFound } from "./errors";
import { newId } from "./ids";
import { createRun, type Random } from "./runtime";
import { mutate, type Db } from "./store";
import { isRecord } from "./util";
import { verifySignature } from "./verify";

/** The route enforces the limit first; this is a backstop. */
export const MAX_BODY_BYTES = 1024 * 1024;
/** page_text longer than this is cut, to keep db.json small. */
export const MAX_PAGE_TEXT = 20_000;

export const WEBHOOK_TYPE_HEADER = "telem-webhook-type";

export interface ReceiveOptions {
  isTest?: boolean;
}

/** Throws 404 for an unknown webhook, 403 for a disabled one, 413 for a body over 1 MB. */
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
  random?: Random,
): Delivery {
  const webhook = db.webhooks.find((w) => w.id === webhookId);
  if (!webhook) throw notFound("webhook", webhookId);
  if (!webhook.enabled) throw new DomainError(403, "This webhook is disabled.");

  const at = now();
  const body = parseBody(rawBody);
  const webhookType = readWebhookType(headers, body);
  const events = extractEvents(webhookType, body);

  const seen = seenSeqs(db, webhook.id);
  const kept: RawEvent[] = [];
  let duplicateCount = 0;
  for (const event of events) {
    if (event.seq !== null) {
      if (seen.has(event.seq)) {
        duplicateCount++;
        continue;
      }
      seen.add(event.seq);
    }
    kept.push(event);
  }

  const delivery: Delivery = {
    id: newId("dlv"),
    webhookId: webhook.id,
    receivedAt: at.toISOString(),
    webhookType,
    signature: verifySignature(webhook.secret, headers, rawBody),
    isTest: options.isTest === true,
    bodyBytes: Buffer.byteLength(rawBody, "utf8"),
    body,
    eventCount: events.length,
    duplicateCount,
    runIds: [],
    skipped: [],
  };

  const targets = webhook.scriptIds.flatMap((id) => db.scripts.filter((s) => s.id === id));
  for (const event of kept) {
    for (const script of targets) {
      if (script.status !== "active") {
        // One entry per script, not per event: the reason is the same for every event.
        if (!delivery.skipped.some((s) => s.scriptId === script.id)) {
          delivery.skipped.push({ scriptId: script.id, reason: "script_not_active" });
        }
        continue;
      }
      const run = createRun(script, toChangeEvent(event, script.workspaceId, delivery.receivedAt), delivery, {
        at,
        random,
      });
      db.runs.push(run);
      delivery.runIds.push(run.id);
    }
  }

  db.deliveries.push(delivery);
  return delivery;
}

// -------------------------------------------------------------- Body parsing

/** An event as read from a body, before it is addressed to a script. */
export interface RawEvent {
  seq: number | null;
  kind: ChangeEvent["kind"];
  url: string;
  page_text: string;
  telem_run_id: string;
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
    return body.changes.map((item) => readEvent(item, body));
  }
  return [readEvent(body, null)];
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

const KINDS: readonly ChangeEvent["kind"][] = ["entity_added", "value_changed", "alert"];

function readEvent(item: unknown, envelope: Record<string, unknown> | null): RawEvent {
  const envelopeRunId = envelope ? firstString(envelope, ["telem_run_id", "run_id"]) : null;
  if (!isRecord(item)) {
    return {
      seq: null,
      kind: "entity_added",
      url: "",
      page_text: clip(typeof item === "string" ? item : JSON.stringify(item)),
      telem_run_id: envelopeRunId ?? "",
    };
  }
  return {
    seq: readSeq(item.seq),
    kind: readKind(item),
    url: firstString(item, ["url", "link", "source_url", "page_url", "href"]) ?? "",
    page_text: clip(
      firstString(item, ["page_text", "text", "content", "markdown", "snippet", "summary", "description"]) ??
        JSON.stringify(item),
    ),
    telem_run_id: firstString(item, ["telem_run_id", "run_id"]) ?? envelopeRunId ?? "",
  };
}

function readSeq(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value.trim());
  return null;
}

function readKind(item: Record<string, unknown>): ChangeEvent["kind"] {
  const raw = firstString(item, ["kind", "change_type", "type"])?.toLowerCase() ?? "";
  if ((KINDS as readonly string[]).includes(raw)) return raw as ChangeEvent["kind"];
  if (/alert/.test(raw)) return "alert";
  if (/chang|updat|modif|edit/.test(raw)) return "value_changed";
  return "entity_added";
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
}

function clip(text: string | undefined): string {
  if (text === undefined) return "";
  return text.length > MAX_PAGE_TEXT ? `${text.slice(0, MAX_PAGE_TEXT)}…` : text;
}

function toChangeEvent(event: RawEvent, workspaceId: string, receivedAt: string): ChangeEvent {
  return {
    workspace_id: workspaceId,
    seq: event.seq ?? 0,
    kind: event.kind,
    url: event.url,
    page_text: event.page_text,
    telem_run_id: event.telem_run_id,
    received_at: receivedAt,
  };
}
