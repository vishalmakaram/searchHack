// Webhook signature verification.
//
// NOT IMPLEMENTED, ON PURPOSE. We do not yet know the name of the header Telem
// signs its webhooks with, nor the algorithm (for example HMAC-SHA256 over
// the raw body, possibly with a timestamp). Guessing would either reject real
// deliveries or give a false sense of security, so every delivery is accepted
// and recorded as "not_checked".
//
// When Telem documents its scheme, implement it here and only here: compute
// the expected signature from `secret` and the exact `rawBody` bytes, compare
// it in constant time (crypto.timingSafeEqual) with the header value, and
// return "valid" or "invalid". ingest.ts already stores the result on the
// Delivery, and overview.ts already flags "invalid" ones on the Ingest stage.

import type { Delivery } from "@/lib/types";

export type SignatureCheck = Delivery["signature"];

export function verifySignature(secret: string, headers: Headers, rawBody: string): SignatureCheck {
  void secret;
  void headers;
  void rawBody;
  return "not_checked";
}
