// Display formatting. Pure functions; the current time is always passed in.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "12s ago", "5 min ago", "3 h ago", "2 d ago", or a date beyond a week. */
export function relativeTime(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return "never";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "unknown";
  const diff = nowMs - then;
  const abs = Math.abs(diff);
  const wrap = (text: string) => (diff >= 0 ? `${text} ago` : `in ${text}`);
  if (abs < 5_000) return "just now";
  if (abs < MINUTE) return wrap(`${Math.floor(abs / 1000)}s`);
  if (abs < HOUR) return wrap(`${Math.floor(abs / MINUTE)} min`);
  if (abs < DAY) return wrap(`${Math.floor(abs / HOUR)} h`);
  if (abs < 7 * DAY) return wrap(`${Math.floor(abs / DAY)} d`);
  return formatDate(iso);
}

/** "14 Nov 2026" */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** "14 Nov 2026, 13:05:09" in the viewer's time zone. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** "13:05:09" in the viewer's time zone. */
export function formatClock(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** "850 ms", "3.2 s", "2 min 5 s", "1 h 4 min" */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "—";
  const value = Math.max(0, ms);
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < MINUTE) return `${(value / 1000).toFixed(1)} s`;
  if (value < HOUR) {
    const seconds = Math.floor((value % MINUTE) / 1000);
    return seconds ? `${Math.floor(value / MINUTE)} min ${seconds} s` : `${Math.floor(value / MINUTE)} min`;
  }
  const minutes = Math.floor((value % HOUR) / MINUTE);
  return minutes ? `${Math.floor(value / HOUR)} h ${minutes} min` : `${Math.floor(value / HOUR)} h`;
}

/** "512 B", "1.4 kB", "2.0 MB" */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "—";
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** 0.25 -> "25%". null -> "—". */
export function formatPercent(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return "—";
  return `${Math.round(ratio * 100)}%`;
}

/** "1 run", "2 runs" */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

const FREQUENCY_LABELS: Record<string, string> = {
  "1h": "Every hour",
  "6h": "Every 6 hours",
  "12h": "Every 12 hours",
  "1d": "Every day",
  "7d": "Every week",
};

export function frequencyLabel(frequency: string): string {
  return FREQUENCY_LABELS[frequency] ?? frequency;
}

/** Host and path of a URL without the scheme; the input unchanged if it is not a URL. */
export function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.host.replace(/^www\./, "")}${path}`;
  } catch {
    return url;
  }
}

/** Pretty JSON for display. Strings are shown as they are. */
export function prettyJson(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
