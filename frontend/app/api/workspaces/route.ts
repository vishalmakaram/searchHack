import { connection } from "next/server";
import { readJson, respond } from "@/app/api/_lib/http";
import { createWorkspaceBody } from "@/app/api/_lib/schemas";
import { createWorkspace, listWorkspaces } from "@/lib/server/workspaces";

export async function GET() {
  await connection();
  return respond(() => listWorkspaces());
}

/** Starts a build in the runtime; the workspace reads "building" until it finishes. */
export async function POST(req: Request) {
  return respond(async () => createWorkspace(await readJson(req, createWorkspaceBody)), 202);
}
