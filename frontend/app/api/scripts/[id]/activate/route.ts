import { respond } from "@/app/api/_lib/http";
import { activateScript } from "@/lib/server/scripts";

/** inactive → active ("Reactivate"). Any other starting status is a 409. */
export async function POST(_req: Request, ctx: RouteContext<"/api/scripts/[id]/activate">) {
  const { id } = await ctx.params;
  return respond(() => activateScript(id));
}
