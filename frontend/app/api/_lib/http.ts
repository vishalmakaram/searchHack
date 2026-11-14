// Shared helpers for the route handlers under app/api/.
//
// A folder whose name starts with an underscore is not routed, so nothing in
// here is reachable over HTTP. Handlers stay thin: validate the input, call
// lib/server, and hand the work to `respond`, which serialises the result and
// turns a DomainError into `{ "error": message }` with the error's status.

import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import { DomainError, isDomainError } from "@/lib/server/errors";
import type { ApiError } from "@/lib/types";

/** Body of every successful DELETE and of POST /api/dev/reset. */
export const OK = { ok: true } as const;

/**
 * Runs `work` and returns its result as JSON with `status`. Any error thrown
 * inside `work` (validation included) becomes an error response.
 *
 * Call `await connection()` and `await ctx.params` before this, outside it, so
 * Next.js's own control-flow signals are never caught here.
 */
export async function respond<T>(work: () => T | Promise<T>, status = 200): Promise<Response> {
  try {
    return Response.json(await work(), { status });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Maps a thrown value to an `ApiError` response. Unknown errors are a 500. */
export function errorResponse(error: unknown): Response {
  unstable_rethrow(error);
  // isDomainError, not instanceof: a dev-server reload can leave two copies of the class loaded.
  if (isDomainError(error)) return fail(error.status, error.message);
  console.error("[api] unhandled error:", error);
  return fail(500, "Internal server error.");
}

export function fail(status: number, message: string): Response {
  return Response.json({ error: message } satisfies ApiError, { status });
}

/** Parses `data` with `schema`, or throws a 400 that names every problem. */
export function validate<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) throw new DomainError(400, describeIssues(result.error));
  return result.data;
}

/** Reads the request body as JSON and validates it. Empty or malformed JSON is a 400. */
export async function readJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.output<S>> {
  const text = await req.text();
  if (text.trim() === "") throw new DomainError(400, "The request body is empty; expected a JSON object.");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new DomainError(400, "The request body is not valid JSON.");
  }
  return validate(schema, data);
}

/**
 * Validates the query string. Empty values (`?status=`) count as absent, a
 * repeated key uses its first value, and keys the schema does not name are
 * ignored, so a cache-busting parameter never causes a 400.
 */
export function readQuery<S extends z.ZodType>(req: Request, schema: S): z.output<S> {
  const params: Record<string, string> = {};
  for (const [key, value] of new URL(req.url).searchParams) {
    if (value !== "" && !(key in params)) params[key] = value;
  }
  return validate(schema, params);
}

/**
 * The address Telem should post to, without a trailing slash:
 * `PUBLIC_BASE_URL` when set (the tunnel), otherwise the request's origin.
 */
export function baseUrl(req: Request): string {
  const configured = process.env.PUBLIC_BASE_URL?.trim();
  return (configured || new URL(req.url).origin).replace(/\/+$/, "");
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => (issue.path.length > 0 ? `${issue.path.map(String).join(".")}: ${issue.message}` : issue.message))
    .join("; ");
}
