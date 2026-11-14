import { connection } from "next/server";
import { readQuery, respond } from "@/app/api/_lib/http";
import { runsQuery } from "@/app/api/_lib/schemas";
import { listRuns } from "@/lib/server/runs";

/** `?scriptId=&status=&deliveryId=&limit=`, newest first; limit defaults to 50 and is capped at 200. */
export async function GET(req: Request) {
  await connection();
  return respond(() => listRuns(readQuery(req, runsQuery)));
}
