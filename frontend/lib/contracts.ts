// Cross-team event shapes (PLAN.md section 6.3).
//
// These are agreed with the backend teams and copied here by hand. Keep the
// field names exactly as written, including snake_case. When the shared
// contracts package exists, import from it instead of this file.

/** What the ingest step hands to a script. */
export interface ChangeEvent {
  workspace_id: string;
  /** Monotonic per source; used to drop duplicates. */
  seq: number;
  kind: "entity_added" | "value_changed" | "alert";
  url: string;
  page_text: string;
  telem_run_id: string;
  received_at: string;
}

/** What a script emits when its output matched the schema. */
export interface ProcessedResult {
  workspace_id: string;
  seq: number;
  /** Matches the script's extractionSchema. */
  extracted: Record<string, unknown>;
  /** 0..1 */
  confidence: number;
  dedupe_key: string;
  raw_ref: string;
  /** e.g. "v3" */
  pipeline_version: string;
}
