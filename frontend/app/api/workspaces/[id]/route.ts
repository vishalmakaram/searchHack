import { connection } from "next/server";
import { OK, readJson, respond } from "@/app/api/_lib/http";
import { updateWorkspaceBody } from "@/app/api/_lib/schemas";
import { deleteWorkspace, getWorkspace, updateWorkspace } from "@/lib/server/workspaces";

type Ctx = RouteContext<"/api/workspaces/[id]">;

export async function GET(_req: Request, ctx: Ctx) {
  await connection();
  const { id } = await ctx.params;
  return respond(() => getWorkspace(id));
}

/** Edits name, queries or frequency. Queries and frequency are frozen once approved (409). */
export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return respond(async () => updateWorkspace(id, await readJson(req, updateWorkspaceBody)));
}

/** Cascades to the workspace's script and runs, and to webhook routing. */
export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return respond(async () => {
    await deleteWorkspace(id);
    return OK;
  });
}
