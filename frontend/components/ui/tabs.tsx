import Link from "next/link";
import { cn } from "@/lib/cn";

export interface TabItem {
  label: string;
  href: string;
  active: boolean;
  /** Shown after the label, for example how many rows the tab holds. */
  count?: number;
}

/** Tabs that are links, so the selected tab lives in the URL. */
export function LinkTabs({ items, label }: { items: TabItem[]; label: string }) {
  return (
    <nav aria-label={label} className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface-2 p-1">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          replace
          scroll={false}
          aria-current={item.active ? "page" : undefined}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors",
            item.active ? "bg-surface text-ink shadow-card" : "text-ink-2 hover:text-ink",
          )}
        >
          {item.label}
          {item.count !== undefined ? (
            <span className={cn("text-xs tabular-nums", item.active ? "text-ink-2" : "text-ink-3")}>{item.count}</span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
