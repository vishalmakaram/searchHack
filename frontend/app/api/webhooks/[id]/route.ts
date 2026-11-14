import { connection } from "next/server";
import { OK, baseUrl, readJson, respond } from "@/app/api/_lib/http";
import { updateWebhookBody } from "@/app/api/_lib/schemas";
import { deleteWebhook, getWebhook, updateWebhook } from "@/lib/server/webhooks";

type Ctx = RouteContext<"/api/webhooks/[id]">;

export async function GET(req: Request, ctx: Ctx) {
  await connection();
  const { id } = await ctx.params;
  return respond(() => getWebhook(id, baseUrl(req)));
}

/** Edits name, enabled, scriptIds or the signing secret. */
export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return respond(async () => updateWebhook(id, await readJson(req, updateWebhookBody), baseUrl(req)));
}

/** Also deletes the webhook's deliveries; the runs it produced stay in the run log. */
export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return respond(async () => {
    await deleteWebhook(id);
    return OK;
  });
}
