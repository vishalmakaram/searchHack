import { connection } from "next/server";
import { respond } from "@/app/api/_lib/http";
import { getRun } from "@/lib/server/runtime";

export async function GET(_req: Request, ctx: RouteContext<"/api/runs/[id]">) {
  await connection();
  const { id } = await ctx.params;
  return respond(() => getRun(id));
}
