import { connection } from "next/server";
import { readJson, respond } from "@/app/api/_lib/http";
import { createWorkspaceBody } from "@/app/api/_lib/schemas";
import { createWorkspace, listWorkspaces } from "@/lib/server/workspaces";

export async function GET() {
  await connection();
  return respond(() => listWorkspaces());
}

/** Starts compiling; the workspace reads "compiling" until `compileReadyAt`. */
export async function POST(req: Request) {
  return respond(async () => createWorkspace(await readJson(req, createWorkspaceBody)), 201);
}
