import { connection } from "next/server";
import { respond } from "@/app/api/_lib/http";
import { getOverview } from "@/lib/server/overview";

export async function GET() {
  await connection();
  return respond(() => getOverview());
}
