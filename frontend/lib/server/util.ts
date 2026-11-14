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

/** A deterministic random source (mulberry32), for the seed and for tests. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a: a stable 32-bit hash for picking deterministic variations. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
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
