// The public receiver Telem posts to (PLAN.md section 4: this part is real).
//
// 200 { ok: true, delivery_id }; 404 unknown webhook; 403 webhook disabled;
// 413 body over 1 MB. The body is read as raw text and never rejected for its
// shape: lib/server/ingest parses it and records whatever arrives.

import { MAX_HOOK_BODY_BYTES, readTextWithLimit } from "@/app/api/_lib/body";
import { respond } from "@/app/api/_lib/http";
import { receive } from "@/lib/server/ingest";
import type { ReceiveResult } from "@/lib/types";

export async function POST(req: Request, ctx: RouteContext<"/api/hooks/[id]">) {
  const { id } = await ctx.params;
  return respond(async (): Promise<ReceiveResult> => {
    // The size limit is enforced here, before ingest sees the body.
    const rawBody = await readTextWithLimit(req, MAX_HOOK_BODY_BYTES);
    const delivery = await receive(id, req.headers, rawBody);
    return { ok: true, delivery_id: delivery.id };
  });
}
