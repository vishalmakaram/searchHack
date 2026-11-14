import { respond } from "@/app/api/_lib/http";
import { deployScript } from "@/lib/server/scripts";

/** developed → active. Any other starting status is a 409. */
export async function POST(_req: Request, ctx: RouteContext<"/api/scripts/[id]/deploy">) {
  const { id } = await ctx.params;
  return respond(() => deployScript(id));
}
