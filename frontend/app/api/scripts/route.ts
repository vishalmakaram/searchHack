import { connection } from "next/server";
import { readQuery, respond } from "@/app/api/_lib/http";
import { scriptsQuery } from "@/app/api/_lib/schemas";
import { listScripts } from "@/lib/server/scripts";

/** `?status=developed|active|inactive`; any other value is a 400. */
export async function GET(req: Request) {
  await connection();
  return respond(() => listScripts(readQuery(req, scriptsQuery)));
}
