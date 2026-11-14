import { connection } from "next/server";
import { respond } from "@/app/api/_lib/http";
import { getWorkspaceOutput } from "@/lib/server/workspaces";

/** What the output service holds for the workspace: counts, alerts and the research document. */
export async function GET(_req: Request, ctx: RouteContext<"/api/workspaces/[id]/output">) {
  await connection();
  const { id } = await ctx.params;
  return respond(() => getWorkspaceOutput(id));
}
