import { connection } from "next/server";
import { respond } from "@/app/api/_lib/http";
import { getScript } from "@/lib/server/scripts";

export async function GET(_req: Request, ctx: RouteContext<"/api/scripts/[id]">) {
  await connection();
  const { id } = await ctx.params;
  return respond(() => getScript(id));
}
