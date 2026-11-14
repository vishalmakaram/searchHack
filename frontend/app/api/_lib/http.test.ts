import { afterEach, describe, expect, it, vi } from "vitest";
import { DomainError } from "@/lib/server/errors";
import { readTextWithLimit } from "./body";
import { baseUrl, readJson, readQuery, respond } from "./http";
import { createWebhookBody, createWorkspaceBody, runsQuery, scriptsQuery, updateWebhookBody } from "./schemas";

function post(body: BodyInit | null, headers?: HeadersInit): Request {
  return new Request("http://localhost:3100/api/x", { method: "POST", body, headers, duplex: "half" } as RequestInit);
}

/** A body with no Content-Length, delivered in chunks. */
function chunked(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function statusOf(promise: Promise<unknown>): Promise<number | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof DomainError ? error.status : -1;
  }
}

describe("respond", () => {
  it("returns the result as JSON with the given status", async () => {
    const res = await respond(async () => ({ a: 1 }), 201);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ a: 1 });
  });

  it("maps a DomainError to { error } with its status", async () => {
    const res = await respond(() => {
      throw new DomainError(409, "Already approved.");
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Already approved." });
  });

  it("also maps an error that is only shaped like a DomainError (a second copy after a reload)", async () => {
    const res = await respond(() => {
      throw Object.assign(new Error("No script."), { name: "DomainError", status: 404 });
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "No script." });
  });

  it("hides unexpected errors behind a 500", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await respond(async () => {
      throw new Error("secret detail");
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error." });
    log.mockRestore();
  });
});

describe("readJson", () => {
  it("rejects an empty body, malformed JSON, unknown keys and wrong types with 400", async () => {
    expect(await statusOf(readJson(post(""), createWorkspaceBody))).toBe(400);
    expect(await statusOf(readJson(post("{nope"), createWorkspaceBody))).toBe(400);
    expect(await statusOf(readJson(post('{"query":"a","extra":1}'), createWorkspaceBody))).toBe(400);
    expect(await statusOf(readJson(post('{"query":["a"]}'), createWorkspaceBody))).toBe(400);
    expect(await statusOf(readJson(post('{"enabled":"yes"}'), updateWebhookBody))).toBe(400);
  });

  it("passes a well-shaped body through unchanged, leaving domain rules to lib/server", async () => {
    expect(await readJson(post('{"query":" a "}'), createWorkspaceBody)).toEqual({ query: " a " });
  });

  it("defaults webhook scriptIds to []", async () => {
    expect(await readJson(post('{"name":"x"}'), createWebhookBody)).toEqual({ name: "x", scriptIds: [] });
  });
});

describe("readQuery", () => {
  const get = (search: string) => new Request(`http://localhost:3100/api/runs${search}`);

  it("treats empty values as absent and ignores unknown keys", () => {
    expect(readQuery(get("?status=&_=123"), scriptsQuery)).toEqual({});
  });

  it("rejects an unknown status with 400", () => {
    expect(() => readQuery(get("?status=bogus"), scriptsQuery)).toThrow(DomainError);
  });

  it("turns limit into a number and rejects one that is not a number", () => {
    expect(readQuery(get("?limit=20&status=failed"), runsQuery)).toEqual({ limit: 20, status: "failed" });
    expect(() => readQuery(get("?limit=abc"), runsQuery)).toThrow(DomainError);
  });
});

describe("readTextWithLimit", () => {
  it("returns the body as text when it is within the limit", async () => {
    expect(await readTextWithLimit(post("héllo"), 16)).toBe("héllo");
  });

  it("refuses a declared Content-Length over the limit with 413", async () => {
    expect(await statusOf(readTextWithLimit(post("x", { "content-length": "17" }), 16))).toBe(413);
  });

  it("refuses a chunked body that grows past the limit with 413", async () => {
    expect(await statusOf(readTextWithLimit(post(chunked("12345678", "12345678", "9")), 16))).toBe(413);
    expect(await readTextWithLimit(post(chunked("12345678", "12345678")), 16)).toBe("1234567812345678");
  });
});

describe("baseUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers PUBLIC_BASE_URL without its trailing slash, else the request origin", () => {
    const req = new Request("http://localhost:3100/api/webhooks");
    vi.stubEnv("PUBLIC_BASE_URL", "");
    expect(baseUrl(req)).toBe("http://localhost:3100");
    vi.stubEnv("PUBLIC_BASE_URL", "https://example.trycloudflare.com/");
    expect(baseUrl(req)).toBe("https://example.trycloudflare.com");
  });
});
