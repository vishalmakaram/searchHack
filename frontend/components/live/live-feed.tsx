"use client";

import Link from "next/link";
import { Radio } from "lucide-react";
import { useMemo } from "react";
import type { RuntimeEvent } from "@/lib/events";
import { cn } from "@/lib/cn";
import { useEventStream, type StreamEvent } from "@/lib/use-event-stream";
import { EmptyState } from "@/components/ui/states";
import { describeEvent } from "./describe";

const clock = (at: number) =>
  new Date(at * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

interface LiveFeedProps {
  /** Only events for this workspace. */
  workspaceId?: string;
  /** Leave out what the agents say and do; keep the pipeline's own steps. */
  hideAgents?: boolean;
  /** Newest rows kept on screen. */
  limit?: number;
  /** Caps the height and scrolls. */
  maxHeight?: string;
  /** Shown when there is nothing yet. */
  empty?: string;
}

/** Filters a stream to one workspace and, optionally, without agent chatter. Newest first. */
export function selectEvents(events: StreamEvent[], options: { workspaceId?: string; hideAgents?: boolean; limit: number }): StreamEvent[] {
  const out: StreamEvent[] = [];
  for (let index = events.length - 1; index >= 0 && out.length < options.limit; index--) {
    const { event } = events[index];
    if (options.workspaceId && event.workspace !== options.workspaceId) continue;
    if (options.hideAgents && event.type === "agent") continue;
    out.push(events[index]);
  }
  return out;
}

/** What the runtime is doing, as it happens, newest first. */
export function LiveFeed({ workspaceId, hideAgents, limit = 60, maxHeight = "24rem", empty }: LiveFeedProps) {
  const { events, status } = useEventStream();
  const rows = useMemo(() => selectEvents(events, { workspaceId, hideAgents, limit }), [events, workspaceId, hideAgents, limit]);

  if (rows.length === 0) {
    return (
      <EmptyState icon={<Radio aria-hidden />} title={status === "offline" ? "The live stream is not connected" : "Nothing has happened yet"} compact>
        {status === "offline"
          ? "The Sentinel runtime's event stream cannot be reached. It reconnects by itself when the runtime is back."
          : (empty ?? "Steps appear here while the runtime builds a script or runs a page.")}
      </EmptyState>
    );
  }

  return (
    <ol className="overflow-y-auto" style={{ maxHeight }} aria-label="Live events, newest first">
      {rows.map(({ key, event }) => (
        <EventRow key={key} event={event} showWorkspace={!workspaceId} />
      ))}
    </ol>
  );
}

function EventRow({ event, showWorkspace }: { event: RuntimeEvent; showWorkspace: boolean }) {
  const line = describeEvent(event);
  return (
    <li
      data-tone={line.tone}
      className="flex animate-enter items-baseline gap-3 border-t border-line px-5 py-2 text-[13px] first:border-t-0"
    >
      <time className="w-16 shrink-0 font-mono text-xs text-ink-3 tabular-nums">{clock(event.at)}</time>
      <span className="flex w-28 shrink-0 items-center gap-1.5 text-xs font-medium text-ink-2">
        <span className="size-1.5 shrink-0 rounded-full bg-tone-dot" aria-hidden />
        <span className="truncate">{line.label}</span>
      </span>
      <span className={cn("min-w-0 flex-1 break-words", line.quiet ? "font-mono text-xs text-ink-3" : "text-ink")}>{line.text}</span>
      {showWorkspace && event.workspace ? (
        <Link
          href={`/workspaces/${event.workspace}`}
          className="hidden shrink-0 font-mono text-xs text-ink-3 underline decoration-line-strong underline-offset-4 hover:text-ink sm:inline"
        >
          {event.workspace}
        </Link>
      ) : null}
    </li>
  );
}
