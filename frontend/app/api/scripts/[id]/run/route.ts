import { after } from "next/server";
import { readJson, respond } from "@/app/api/_lib/http";
import { runUrlBody } from "@/app/api/_lib/schemas";
import { drainRuns, startManualRun } from "@/lib/server/runs";
import { loadScriptWorkspace, toScriptView } from "@/lib/server/scripts";
import { read } from "@/lib/server/store";

/**
 * Queues one page for the script and answers 202 with the run. The runtime
 * does the work after this response; poll GET /api/runs/{id} for the outcome.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/scripts/[id]/run">) {
  const { id } = await ctx.params;
  return respond(async () => {
    const input = await readJson(req, runUrlBody);
    const raw = await loadScriptWorkspace(id);
    const run = await startManualRun(raw, toScriptView(raw, await read()).name, input);
    after(() => drainRuns());
    return run;
  }, 202);
}
