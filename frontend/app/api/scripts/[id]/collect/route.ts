import { after } from "next/server";
import { respond } from "@/app/api/_lib/http";
import { drainRuns, startCollect } from "@/lib/server/runs";
import { loadScriptWorkspace, toScriptView } from "@/lib/server/scripts";
import { read } from "@/lib/server/store";

/**
 * Queues a collect: the runtime asks Telem what is new for the workspace's
 * query and runs each new page. 409 unless the script is active, or when a
 * collect is already pending. Answers 202 with the run.
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/scripts/[id]/collect">) {
  const { id } = await ctx.params;
  return respond(async () => {
    const raw = await loadScriptWorkspace(id);
    const run = await startCollect(raw, toScriptView(raw, await read()).name);
    after(() => drainRuns());
    return run;
  }, 202);
}
