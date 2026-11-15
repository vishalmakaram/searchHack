// The live events the Sentinel runtime streams over its WebSocket
// (sentinel/events.py, described in the repository README).
//
// One JSON object per frame. The runtime replays its last 80 events to a new
// connection, so a page opened mid-build still sees how it got there.

interface Base {
  /** Seconds since the epoch, to the millisecond. */
  at: number;
  workspace?: string | null;
}

export type BuildPhase = "search" | "searched" | "fetch" | "write" | "verify" | "repair" | "ready" | "failed";

export type RuntimeEvent =
  | (Base & { type: "workspace"; phase: "created"; query?: string })
  | (Base & {
      type: "build";
      phase: BuildPhase;
      query?: string;
      tier?: string;
      /** A count after "searched", the candidate URLs during "fetch". */
      urls?: number | string[];
      sample?: string;
      content_length?: number;
      seconds?: number;
      error?: string | null;
    })
  | (Base & {
      type: "agent";
      agent?: "builder" | "worker";
      /** Something the agent said. */
      line?: string;
      /** A tool the agent started, with its arguments. */
      tool?: string;
      args?: string;
      phase?: "end";
    })
  | (Base & {
      type: "run";
      phase: "fetch" | "fetched" | "processed" | "dropped" | "unchanged";
      url?: string;
      title?: string;
      content_length?: number;
      /** Characters the fetch returned, and what process.py emitted from them. */
      chars_in?: number;
      chars_out?: number;
      /** chars_in / chars_out, and the share of characters the extractor dropped. */
      ratio?: number;
      saved_pct?: number;
      ok?: boolean;
      duration_ms?: number;
      keep?: boolean;
      processed?: string;
      reason?: string;
      fingerprint?: string;
    })
  | (Base & {
      type: "delivery";
      phase: "start" | "done";
      url?: string;
      integrations?: boolean;
      service?: string | null;
      ok?: boolean;
      seconds?: number;
      reply?: string;
    })
  | (Base & {
      type: "collect";
      phase: "changes" | "polled" | "new_items";
      monitor_id?: string;
      source?: string;
      count?: number;
      urls?: string[];
    })
  | (Base & { type: "ws"; phase: "connected"; clients?: number });

const KNOWN_TYPES = new Set(["workspace", "build", "agent", "run", "delivery", "collect", "ws"]);

/** Parses one frame. Returns null for anything that is not a known event. */
export function parseEvent(frame: string): RuntimeEvent | null {
  try {
    const value: unknown = JSON.parse(frame);
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    if (typeof record.type !== "string" || !KNOWN_TYPES.has(record.type)) return null;
    if (typeof record.at !== "number") return null;
    return record as unknown as RuntimeEvent;
  } catch {
    return null;
  }
}

/** The order build phases happen in. "repair" only occurs when verification fails. */
export const BUILD_ORDER: BuildPhase[] = ["search", "searched", "fetch", "write", "verify", "repair", "ready"];
