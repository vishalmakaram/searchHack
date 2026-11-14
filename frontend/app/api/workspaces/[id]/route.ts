import { connection } from "next/server";
import { respond } from "@/app/api/_lib/http";
import { getWorkspace } from "@/lib/server/workspaces";

/** The workspace with its memory and the result of its build check. */
export async function GET(_req: Request, ctx: RouteContext<"/api/workspaces/[id]">) {
  await connection();
  const { id } = await ctx.params;
  return respond(() => getWorkspace(id));
}
