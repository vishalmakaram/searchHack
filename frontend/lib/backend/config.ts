// Where the Python services live. Read at call time so tests and .env.local can change them.

import path from "node:path";

const trim = (value: string) => value.trim().replace(/\/+$/, "");

/** The Sentinel runtime (sentinel/server.py). */
export function runtimeUrl(): string {
  return trim(process.env.SENTINEL_URL || "http://127.0.0.1:8000");
}

/** The output integration service (output_integration/server.py). */
export function outputUrl(): string {
  return trim(process.env.SENTINEL_OUTPUT_URL || "http://127.0.0.1:4096");
}

/**
 * The runtime's workspaces folder on this machine. The runtime has no endpoint
 * for a workspace's process.py, so it is read from disk. Defaults to the
 * repository's workspaces/ beside frontend/.
 */
export function workspacesDir(): string {
  // turbopackIgnore: a runtime path, so `next build` must not trace the whole project from it.
  return path.resolve(
    /* turbopackIgnore: true */ process.env.SENTINEL_WORKSPACES_DIR || path.join(process.cwd(), "..", "workspaces"),
  );
}
