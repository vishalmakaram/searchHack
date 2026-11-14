import { OK, respond } from "@/app/api/_lib/http";
import { reset } from "@/lib/server/store";

/** Wipes .data/db.json and reseeds it. */
export async function POST() {
  return respond(async () => {
    await reset();
    return OK;
  });
}
