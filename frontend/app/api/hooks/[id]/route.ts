// The public receiver Telem posts to.
//
// 200 { ok: true, delivery_id }; 401 wrong signature; 403 webhook disabled;
// 404 unknown webhook; 413 body over 1 MB. The body is read as raw text and
// never rejected for its shape: lib/server/ingest parses it and records
// whatever arrives. The runs it queues start after the response is sent.

import { after } from "next/server";
import { MAX_HOOK_BODY_BYTES, readTextWithLimit } from "@/app/api/_lib/body";
import { respond } from "@/app/api/_lib/http";
import { DomainError } from "@/lib/server/errors";
import { receive } from "@/lib/server/ingest";
import { drainRuns } from "@/lib/server/runs";
import type { ReceiveResult } from "@/lib/types";

export async function POST(req: Request, ctx: RouteContext<"/api/hooks/[id]">) {
  const { id } = await ctx.params;
  return respond(async (): Promise<ReceiveResult> => {
    // The size limit is enforced here, before ingest sees the body.
    const rawBody = await readTextWithLimit(req, MAX_HOOK_BODY_BYTES);
    const delivery = await receive(id, req.headers, rawBody);
    if (delivery.signature === "invalid") {
      throw new DomainError(401, "The Telem-Signature header does not match this webhook's secret.");
    }
    if (delivery.runIds.length > 0) after(() => drainRuns());
    return { ok: true, delivery_id: delivery.id };
  });
}
