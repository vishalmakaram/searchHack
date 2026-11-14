"use client";

import { formatDateTime, relativeTime } from "@/lib/format";
import { useNow } from "@/lib/use-now";

/** "5 min ago", with the exact time on hover. Ticks once a second. */
export function RelativeTime({ iso, className }: { iso: string | null | undefined; className?: string }) {
  const now = useNow();
  if (!iso) return <span className={className}>Never</span>;
  return (
    <time dateTime={iso} title={formatDateTime(iso)} className={className}>
      {now === 0 ? "" : relativeTime(iso, now)}
    </time>
  );
}
