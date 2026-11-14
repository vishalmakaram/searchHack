import { respond } from "@/app/api/_lib/http";
import { deactivateScript } from "@/lib/server/scripts";

/** active → inactive. Any other starting status is a 409. */
export async function POST(_req: Request, ctx: RouteContext<"/api/scripts/[id]/deactivate">) {
  const { id } = await ctx.params;
  return respond(() => deactivateScript(id));
}
