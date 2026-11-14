import { connection } from "next/server";
import { readQuery, respond } from "@/app/api/_lib/http";
import { deliveriesQuery } from "@/app/api/_lib/schemas";
import { listDeliveries } from "@/lib/server/webhooks";

/** `?limit=`, newest first. */
export async function GET(req: Request, ctx: RouteContext<"/api/webhooks/[id]/deliveries">) {
  await connection();
  const { id } = await ctx.params;
  return respond(() => listDeliveries(id, readQuery(req, deliveriesQuery).limit));
}
