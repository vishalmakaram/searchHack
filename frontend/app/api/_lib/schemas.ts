// zod schemas for every request body and query string in PLAN.md section 6.5.
//
// These check shape only: types, enum values, and no unknown keys. The domain
// rules (trimming, blank or repeated queries, length limits, the limit default
// and cap, unknown script ids) live in lib/server, which owns them and words
// their messages, so they are not repeated here.
//
// Each body schema is checked against its input type in lib/types.ts with
// `satisfies`, and each enum is built from a Record keyed by its union, so a
// change to those types breaks the type check here instead of drifting.

import { z } from "zod";
import type {
  ApproveWorkspaceInput,
  CreateWebhookInput,
  CreateWorkspaceInput,
  Frequency,
  RunStatus,
  ScriptStatus,
  UpdateWebhookInput,
  UpdateWorkspaceInput,
} from "@/lib/types";

/** A zod enum holding exactly the members of the union `T`; the Record makes the list exhaustive. */
function enumOf<T extends string>(members: Record<T, true>) {
  return z.enum(Object.keys(members) as [T, ...T[]]);
}

const frequency = enumOf<Frequency>({ "1h": true, "6h": true, "12h": true, "1d": true, "7d": true });
const scriptStatus = enumOf<ScriptStatus>({ developed: true, active: true, inactive: true });
const runStatus = enumOf<RunStatus>({ queued: true, running: true, succeeded: true, invalid: true, failed: true });

const strings = z.array(z.string());

// --------------------------------------------------------------- Bodies

export const createWorkspaceBody = z.strictObject({
  intent: z.string(),
}) satisfies z.ZodType<CreateWorkspaceInput>;

export const updateWorkspaceBody = z.strictObject({
  name: z.string().optional(),
  queries: strings.optional(),
  frequency: frequency.optional(),
}) satisfies z.ZodType<UpdateWorkspaceInput>;

export const approveWorkspaceBody = z.strictObject({
  queries: strings,
}) satisfies z.ZodType<ApproveWorkspaceInput>;

export const createWebhookBody = z.strictObject({
  name: z.string(),
  /** A webhook may route to no scripts, so leaving this out means []. */
  scriptIds: strings.default([]),
}) satisfies z.ZodType<CreateWebhookInput>;

export const updateWebhookBody = z.strictObject({
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  scriptIds: strings.optional(),
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
