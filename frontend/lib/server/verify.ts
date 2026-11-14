// Webhook signature verification.
//
// Telem signs each delivery with the secret it issued when the monitor was
// created. The header is
//
//     Telem-Signature: t=<unix seconds>,v1=<hex>
//
// where <hex> is HMAC-SHA256 of "<t>.<raw body>" keyed with that secret. A
// header may carry several v1 values (during a secret rotation); any match
// passes. A timestamp more than five minutes from our clock is refused, so a
// captured delivery cannot be replayed later. This mirrors webhooks/server.py
// at the repository root.
//
//   not_checked  no secret is saved for the webhook, or the request carries
//                no signature (a hand-made curl request, for example)
//   valid        the signature matches
//   invalid      a signature was sent and it does not match

import { createHmac, timingSafeEqual } from "node:crypto";
import type { SignatureCheck } from "@/lib/types";
import { now } from "./clock";

export const SIGNATURE_HEADER = "telem-signature";
export const TOLERANCE_SECONDS = 300;

export function verifySignature(secret: string | null, headers: Headers, rawBody: string): SignatureCheck {
  const header = headers.get(SIGNATURE_HEADER);
  if (!secret || header === null || header.trim() === "") return "not_checked";

  let timestamp: string | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") timestamp = value;
    else if (key === "v1") signatures.push(value.toLowerCase());
  }
  if (timestamp === null || !/^\d+$/.test(timestamp) || signatures.length === 0) return "invalid";
  if (Math.abs(now().getTime() / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return "invalid";

  const expected = Buffer.from(sign(secret, timestamp, rawBody), "utf8");
  const matches = signatures.some((candidate) => {
    const given = Buffer.from(candidate, "utf8");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  return matches ? "valid" : "invalid";
}

/** The hex signature for a body at a timestamp (unix seconds, as text). */
export function sign(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
}
