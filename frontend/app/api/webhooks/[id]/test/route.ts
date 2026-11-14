import { respond } from "@/app/api/_lib/http";
import { sendTestEvent } from "@/lib/server/webhooks";

/** Sends a sample `agent.changes` payload through ingest; returns the Delivery. 403 when disabled. */
export async function POST(_req: Request, ctx: RouteContext<"/api/webhooks/[id]/test">) {
  const { id } = await ctx.params;
  return respond(() => sendTestEvent(id));
}
