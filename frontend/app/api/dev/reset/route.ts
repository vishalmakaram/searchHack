import { OK, respond } from "@/app/api/_lib/http";
import { reset } from "@/lib/server/store";

/** Empties .data/db.json: script switches, webhooks, deliveries and the run log. Workspaces stay. */
export async function POST() {
  return respond(async () => {
    await reset();
    return OK;
  });
}
