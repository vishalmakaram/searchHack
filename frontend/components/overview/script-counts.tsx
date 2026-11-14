import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ScriptStatus } from "@/lib/types";
import { ScriptStatusBadge } from "@/components/status/badges";

const ORDER: ScriptStatus[] = ["active", "inactive", "developed"];

const MEANINGS: Record<ScriptStatus, string> = {
  active: "Deployed and receiving events",
  inactive: "Switched off, receiving nothing",
  developed: "Compiled, never deployed",
};

/** How many scripts are in each status. Each tile opens the Scripts list filtered to it. */
export function ScriptCounts({ counts }: { counts: Record<ScriptStatus, number> }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-3">
      {ORDER.map((status) => (
        <li key={status}>
          <Link
            href={`/scripts?status=${status}`}
            className="group flex h-full items-center gap-4 rounded-xl border border-line bg-surface p-4 shadow-card transition-colors hover:border-line-strong"
          >
            <span className="text-[28px] leading-none font-semibold tracking-tight text-ink">{counts[status] ?? 0}</span>
            <span className="min-w-0 flex-1">
              <ScriptStatusBadge status={status} />
              <span className="mt-1 block text-xs text-ink-3">{MEANINGS[status]}</span>
            </span>
            <ArrowRight
              className="size-4 shrink-0 text-ink-3 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-ink"
              aria-hidden
            />
            <span className="sr-only">View {status} scripts</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
