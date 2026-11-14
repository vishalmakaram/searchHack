// A small JSON client for the Python services, built on node:http.
//
// The built-in fetch gives up after five minutes without response headers.
// One page through the runtime can take longer than that (fetch, extractor,
// then a delivery agent), and a collect runs several pages in one request, so
// these calls need a timeout we choose ourselves.

import http from "node:http";
import https from "node:https";

export type ServiceName = "runtime" | "output";

/** A call to one of the Python services that failed or could not be made. */
export class BackendError extends Error {
  readonly service: ServiceName;
  /** The service's HTTP status, or 0 when it could not be reached. */
  readonly status: number;

  constructor(service: ServiceName, status: number, message: string) {
    super(message);
    this.name = "BackendError";
    this.service = service;
    this.status = status;
  }
}

const SERVICE_LABELS: Record<ServiceName, string> = {
  runtime: "The Sentinel runtime",
  output: "The output service",
};

interface CallOptions {
  method?: "GET" | "POST";
  body?: unknown;
  /** Defaults to 10 seconds. */
  timeoutMs?: number;
}

export function callJson<T>(service: ServiceName, baseUrl: string, path: string, options: CallOptions = {}): Promise<T> {
  const { method = "GET", body, timeoutMs = 10_000 } = options;
  const label = SERVICE_LABELS[service];

  return new Promise<T>((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(baseUrl + path);
    } catch {
      reject(new BackendError(service, 0, `${label} has an invalid address: ${baseUrl}`));
      return;
    }
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const transport = url.protocol === "https:" ? https : http;

    const request = transport.request(
      url,
      {
        method,
        headers: {
          Accept: "application/json",
          ...(payload ? { "Content-Type": "application/json", "Content-Length": String(payload.length) } : {}),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("error", () => reject(new BackendError(service, 0, `${label} closed the connection mid-answer.`)));
        response.on("end", () => {
          const status = response.statusCode ?? 0;
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed: unknown = null;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch {
            parsed = null;
          }
          if (status >= 200 && status < 300) {
            resolve(parsed as T);
            return;
          }
          reject(new BackendError(service, status, `${label} answered ${status}: ${describeError(parsed, text)}`));
        });
      },
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("timeout"));
    });
    request.on("error", (error: NodeJS.ErrnoException) => {
      if (error.message === "timeout") {
        reject(new BackendError(service, 0, `${label} did not answer within ${Math.round(timeoutMs / 1000)} seconds.`));
      } else if (error.code === "ECONNREFUSED") {
        reject(new BackendError(service, 0, `${label} is not running at ${baseUrl}.`));
      } else {
        reject(new BackendError(service, 0, `${label} could not be reached at ${baseUrl} (${error.code ?? error.message}).`));
      }
    });
    if (payload) request.write(payload);
    request.end();
  });
}

/** Pulls the message out of the error shapes the two services use. */
function describeError(parsed: unknown, text: string): string {
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    // The runtime answers { error, trace }; FastAPI answers { detail }.
    for (const key of ["error", "detail", "message"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return firstLines(value);
      if (value && typeof value === "object") return firstLines(JSON.stringify(value));
    }
  }
  return firstLines(text) || "no details given";
}

function firstLines(text: string): string {
  const trimmed = text.trim().split("\n").slice(0, 3).join(" ").replace(/\s+/g, " ");
  return trimmed.length > 400 ? `${trimmed.slice(0, 399)}…` : trimmed;
}
