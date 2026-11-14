import { connection } from "next/server";
import { baseUrl, readJson, respond } from "@/app/api/_lib/http";
import { createWebhookBody } from "@/app/api/_lib/schemas";
import { createWebhook, listWebhooks } from "@/lib/server/webhooks";

export async function GET(req: Request) {
  await connection();
  return respond(() => listWebhooks(baseUrl(req)));
}

/** Generates the secret. An unknown id in `scriptIds` is a 400. */
export async function POST(req: Request) {
  return respond(async () => createWebhook(await readJson(req, createWebhookBody), baseUrl(req)), 201);
}
