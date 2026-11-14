// zod schemas for every request body and query string of the HTTP API.
//
// These check shape only: types, enum values, and no unknown keys. The domain
// rules (trimming, length limits, what counts as a web address, the limit
// default and cap, unknown script ids) live in lib/server, which owns them and
// words their messages, so they are not repeated here.
//
// Each body schema is checked against its input type in lib/types.ts with
// `satisfies`, and each enum is built from a Record keyed by its union, so a
// change to those types breaks the type check here instead of drifting.

import { z } from "zod";
import type {
  CreateWebhookInput,
  CreateWorkspaceInput,
  RunStatus,
  RunUrlInput,
  ScriptStatus,
  TestEventInput,
  UpdateWebhookInput,
} from "@/lib/types";

/** A zod enum holding exactly the members of the union `T`; the Record makes the list exhaustive. */
function enumOf<T extends string>(members: Record<T, true>) {
  return z.enum(Object.keys(members) as [T, ...T[]]);
}

const scriptStatus = enumOf<ScriptStatus>({ developed: true, active: true, inactive: true });
const runStatus = enumOf<RunStatus>({
  queued: true,
  running: true,
  delivered: true,
  dropped: true,
  unchanged: true,
  failed: true,
});

const strings = z.array(z.string());

// --------------------------------------------------------------- Bodies

export const createWorkspaceBody = z.strictObject({
  query: z.string(),
}) satisfies z.ZodType<CreateWorkspaceInput>;

export const runUrlBody = z.strictObject({
  url: z.string(),
}) satisfies z.ZodType<RunUrlInput>;

export const testEventBody = z.strictObject({
  url: z.string(),
}) satisfies z.ZodType<TestEventInput>;

export const createWebhookBody = z.strictObject({
  name: z.string(),
  /** A webhook may route to no scripts, so leaving this out means []. */
  scriptIds: strings.default([]),
  secret: z.string().nullable().optional(),
}) satisfies z.ZodType<CreateWebhookInput>;

export const updateWebhookBody = z.strictObject({
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  scriptIds: strings.optional(),
  secret: z.string().nullable().optional(),
}) satisfies z.ZodType<UpdateWebhookInput>;

// -------------------------------------------------------- Query strings
// Plain (non-strict) objects: unrecognised parameters are ignored.

/** A number from the query string. lib/server applies the default and the cap, and rejects non-positive values. */
const limit = z.coerce.number().optional();

export const scriptsQuery = z.object({
  status: scriptStatus.optional(),
});

export const runsQuery = z.object({
  scriptId: z.string().optional(),
  status: runStatus.optional(),
  deliveryId: z.string().optional(),
  limit,
});

export const deliveriesQuery = z.object({
  limit,
});
