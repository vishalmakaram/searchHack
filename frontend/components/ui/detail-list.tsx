import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface DetailItem {
  label: string;
  value: ReactNode;
}

/** Label and value pairs, laid out as a grid that reflows on narrow screens. */
export function DetailList({ items, columns = 4, className }: { items: DetailItem[]; columns?: 2 | 3 | 4; className?: string }) {
  const grid =
    columns === 4
      ? "grid-cols-2 lg:grid-cols-4"
      : columns === 3
        ? "grid-cols-2 lg:grid-cols-3"
        : "grid-cols-1 sm:grid-cols-2";
  return (
    <dl className={cn("grid gap-x-6 gap-y-4", grid, className)}>
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs text-ink-3">{item.label}</dt>
          <dd className="mt-0.5 min-w-0 text-sm break-words text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
