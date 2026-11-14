import { after } from "next/server";
import { readJson, respond } from "@/app/api/_lib/http";
import { testEventBody } from "@/app/api/_lib/schemas";
import { drainRuns } from "@/lib/server/runs";
import { sendTestEvent } from "@/lib/server/webhooks";

/**
 * Sends an `agent.changes` payload naming the given page through ingest and
 * returns the Delivery. Active target scripts run the page for real. 403 when
 * the webhook is disabled.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/webhooks/[id]/test">) {
  const { id } = await ctx.params;
  return respond(async () => {
    const delivery = await sendTestEvent(id, await readJson(req, testEventBody));
    if (delivery.runIds.length > 0) after(() => drainRuns());
    return delivery;
  });
}
