// Size-limited body reading for the public webhook receiver.

import { DomainError } from "@/lib/server/errors";

/** Largest body POST /api/hooks/{id} accepts: 1 MB. Anything over it is a 413. */
export const MAX_HOOK_BODY_BYTES = 1024 * 1024;

/**
 * Reads the raw body as UTF-8 text, refusing anything over `maxBytes` with a
 * 413. A declared `Content-Length` over the limit is refused without reading;
 * otherwise the stream is counted as it arrives, so a chunked upload cannot
 * get past the limit either, and reading stops as soon as it is crossed.
 */
export async function readTextWithLimit(req: Request, maxBytes: number): Promise<string> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge(maxBytes);
  if (!req.body) return "";

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw tooLarge(maxBytes);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function tooLarge(maxBytes: number): DomainError {
  return new DomainError(413, `The request body is larger than ${maxBytes / (1024 * 1024)} MB.`);
}
