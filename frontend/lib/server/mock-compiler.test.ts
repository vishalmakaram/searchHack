import { describe, expect, it } from "vitest";
import { buildScript, deriveName, mainSubject, proposeFrequency, proposeQueries, proposeSchema } from "./mock-compiler";
import { makeWorkspace } from "./test-helpers";

const INTENTS = [
  "Tell me when a European regulator announces an enforcement action or fine under the EU AI Act.",
  "Watch the public pricing pages of Acme Cloud and Northwind Hosting and tell me when a plan price changes.",
  "new staff engineer jobs at Northwind",
  "I want to know when OpenAI releases a new model",
  "x",
];

describe("mock compiler", () => {
  it.each(INTENTS)("proposes 3 to 5 distinct queries for %j", (intent) => {
    const queries = proposeQueries(intent, 2026);
    expect(queries.length).toBeGreaterThanOrEqual(3);
    expect(queries.length).toBeLessThanOrEqual(5);
    expect(new Set(queries.map((q) => q.toLowerCase())).size).toBe(queries.length);
    expect(queries.every((q) => q.trim() !== "")).toBe(true);
  });

  it("is deterministic", () => {
    expect(proposeQueries(INTENTS[0], 2026)).toEqual(proposeQueries(INTENTS[0], 2026));
  });

  it("builds queries around the main subject", () => {
    expect(mainSubject(INTENTS[0])).toBe(
      "European regulator announces an enforcement action or fine under the EU AI Act",
    );
    expect(mainSubject(INTENTS[1])).toBe("public pricing pages of Acme Cloud and Northwind Hosting");
    const queries = proposeQueries(INTENTS[0], 2026);
    expect(queries[0]).toContain("enforcement");
    expect(queries.some((q) => q.includes("EU AI Act"))).toBe(true);
  });

  it("derives a short name", () => {
    expect(deriveName("Tell me when Acme Cloud changes its pricing.")).toBe("Acme Cloud changes its pricing");
    expect(deriveName(INTENTS[1])).toBe("Public pricing pages of Acme Cloud");
  });

  it("proposes a schema with topic fields", () => {
    expect(proposeSchema(INTENTS[1])).toHaveProperty("new_price");
    expect(proposeSchema(INTENTS[0])).toHaveProperty("authority");
    expect(proposeSchema("x")).toEqual(expect.objectContaining({ title: expect.any(String), summary: expect.any(String) }));
  });

  it("proposes a frequency", () => {
    expect(proposeFrequency("price changes")).toBe("6h");
    expect(proposeFrequency("breaking news about X")).toBe("1h");
    expect(proposeFrequency("anything else")).toBe("1d");
  });

  it("builds a developed script with the workspace's schema", () => {
    const ws = makeWorkspace();
    const script = buildScript(ws);
    expect(script).toMatchObject({
      workspaceId: ws.id,
      status: "developed",
      deployedAt: null,
      version: 1,
      extractionSchema: ws.extractionSchema,
    });
    expect(script.id).toMatch(/^scr_/);
    expect(script.source).toContain('"vendor"');
    expect(script.source).toContain("Acme Cloud pricing");
  });
});
