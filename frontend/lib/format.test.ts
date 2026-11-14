import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration, formatPercent, plural, relativeTime, shortUrl } from "./format";

const NOW = Date.parse("2026-11-14T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("relativeTime", () => {
  it("covers each range", () => {
    expect(relativeTime(ago(2_000), NOW)).toBe("just now");
    expect(relativeTime(ago(42_000), NOW)).toBe("42s ago");
    expect(relativeTime(ago(5 * 60_000), NOW)).toBe("5 min ago");
    expect(relativeTime(ago(3 * 3_600_000), NOW)).toBe("3 h ago");
    expect(relativeTime(ago(2 * 86_400_000), NOW)).toBe("2 d ago");
  });
  it("handles the future and missing values", () => {
    expect(relativeTime(ago(-90_000), NOW)).toBe("in 1 min");
    expect(relativeTime(null, NOW)).toBe("never");
    expect(relativeTime("not a date", NOW)).toBe("unknown");
  });
});

describe("formatDuration", () => {
  it("picks a sensible unit", () => {
    expect(formatDuration(850)).toBe("850 ms");
    expect(formatDuration(3_200)).toBe("3.2 s");
    expect(formatDuration(125_000)).toBe("2 min 5 s");
    expect(formatDuration(3_840_000)).toBe("1 h 4 min");
    expect(formatDuration(null)).toBe("—");
  });
});

describe("small formatters", () => {
  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1_400)).toBe("1.4 kB");
    expect(formatBytes(2_000_000)).toBe("2.0 MB");
  });
  it("formats percentages", () => {
    expect(formatPercent(0.25)).toBe("25%");
    expect(formatPercent(null)).toBe("—");
  });
  it("pluralises", () => {
    expect(plural(1, "run")).toBe("1 run");
    expect(plural(0, "run")).toBe("0 runs");
    expect(plural(2, "delivery", "deliveries")).toBe("2 deliveries");
  });
  it("shortens URLs", () => {
    expect(shortUrl("https://www.sec.gov/filings/ibm-8k")).toBe("sec.gov/filings/ibm-8k");
    expect(shortUrl("not a url")).toBe("not a url");
  });
});
