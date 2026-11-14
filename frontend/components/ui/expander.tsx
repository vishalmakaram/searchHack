"use client";

import { ChevronRight } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface ExpanderRowProps {
  /** The always-visible line. Rendered inside a button, so it must not contain links or buttons. */
  summary: ReactNode;
  /** Rendered only while open. */
  children: () => ReactNode;
  /** What opening this row shows, for the accessible name: "run details". */
  what: string;
}

/** A list row that opens to show more. Keeps its own open state. */
export function ExpanderRow({ summary, children, what }: ExpanderRowProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <li className="border-t border-line first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${open ? "Hide" : "Show"} ${what}`}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-surface-2/70",
          open && "bg-surface-2/50",
        )}
      >
        <ChevronRight
          className={cn("size-4 shrink-0 text-ink-3 transition-transform duration-200", open && "rotate-90")}
          aria-hidden
        />
        <div className="min-w-0 flex-1">{summary}</div>
      </button>
      {open ? (
        <div id={panelId} className="animate-enter border-t border-line bg-surface-2/40 px-5 py-4 sm:pl-12">
          {children()}
        </div>
      ) : null}
    </li>
  );
}
