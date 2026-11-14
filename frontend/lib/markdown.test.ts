import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "./markdown";

describe("parseInline", () => {
  it("handles bold, italic, code and links", () => {
    expect(parseInline("a **b** *c* `d` [e](https://x.test/y)")).toEqual([
      { kind: "text", text: "a " },
      { kind: "strong", children: [{ kind: "text", text: "b" }] },
      { kind: "text", text: " " },
      { kind: "em", children: [{ kind: "text", text: "c" }] },
      { kind: "text", text: " " },
      { kind: "code", text: "d" },
      { kind: "text", text: " " },
      { kind: "link", href: "https://x.test/y", children: [{ kind: "text", text: "e" }] },
    ]);
  });

  it("refuses script links and keeps their text", () => {
    expect(parseInline("[click](javascript:alert(1))")).toEqual([
      { kind: "text", text: "click" },
      { kind: "text", text: ")" },
    ]);
  });

  it("links bare addresses without trailing punctuation", () => {
    expect(parseInline("see https://example.com/a.")).toEqual([
      { kind: "text", text: "see " },
      { kind: "link", href: "https://example.com/a", children: [{ kind: "text", text: "https://example.com/a" }] },
      { kind: "text", text: "." },
    ]);
  });
});

describe("parseMarkdown", () => {
  it("parses the shape of a memory.md", () => {
    const blocks = parseMarkdown("# Memory: q\n\n## 2026-11-14 — Title\n- one\n- two https://x.test\n");
    expect(blocks.map((block) => block.kind)).toEqual(["heading", "heading", "list"]);
    expect(blocks[2]).toMatchObject({ kind: "list", ordered: false });
    expect((blocks[2] as { items: unknown[] }).items).toHaveLength(2);
  });

  it("parses the research document's table and quote", () => {
    const doc = [
      "> **Target Intent:** watch IBM  ",
      "> **Status:** Active",
      "",
      "---",
      "",
      "| Timestamp | Impact | Source |",
      "| :--- | :--- | :--- |",
      "| `2026-11-14` | 🔴 **HIGH** | [Open](https://sec.gov/x) |",
    ].join("\n");
    const blocks = parseMarkdown(doc);
    expect(blocks.map((block) => block.kind)).toEqual(["quote", "rule", "table"]);
    const table = blocks[2] as Extract<(typeof blocks)[number], { kind: "table" }>;
    expect(table.header).toHaveLength(3);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0][2][0]).toMatchObject({ kind: "link", href: "https://sec.gov/x" });
  });

  it("keeps fenced code verbatim", () => {
    expect(parseMarkdown("```\n**not bold**\n```")).toEqual([{ kind: "code", text: "**not bold**" }]);
  });
});
