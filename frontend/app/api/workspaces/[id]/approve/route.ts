import { readJson, respond } from "@/app/api/_lib/http";
import { approveWorkspaceBody } from "@/app/api/_lib/schemas";
import { approveWorkspace } from "@/lib/server/workspaces";

/** Saves the final queries and creates the workspace's `developed` script. */
export async function POST(req: Request, ctx: RouteContext<"/api/workspaces/[id]/approve">) {
  const { id } = await ctx.params;
  return respond(async () => approveWorkspace(id, await readJson(req, approveWorkspaceBody)));
}
