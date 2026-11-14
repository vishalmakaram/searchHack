// Small helpers shared by the lib/server modules.

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function iso(time: number | Date): string {
  return new Date(time).toISOString();
}

export function ms(timestamp: string): number {
  return Date.parse(timestamp);
}

/** Newest first by an ISO timestamp. Ties go to the item stored later. */
export function newestFirst<T>(items: readonly T[], timestamp: (item: T) => string): T[] {
  return items
    .map((item, index) => ({ item, index, time: ms(timestamp(item)) }))
    .sort((a, b) => b.time - a.time || b.index - a.index)
    .map((entry) => entry.item);
}

/** Trims, collapses inner whitespace. */
export function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** "12s ago", "4m ago", "3h ago", "2d ago", or "—" when there is nothing. */
export function ago(timestamp: string | null, at: Date): string {
  if (timestamp === null) return "—";
  const elapsed = Math.max(0, at.getTime() - ms(timestamp));
  if (elapsed < 5 * SECOND) return "just now";
  if (elapsed < MINUTE) return `${Math.floor(elapsed / SECOND)}s ago`;
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  return `${Math.floor(elapsed / DAY)}d ago`;
}
