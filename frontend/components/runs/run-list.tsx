"use client";

import Link from "next/link";
import type { RunView } from "@/lib/types";
import { formatClock, formatDuration, formatPercent, prettyJson, shortUrl } from "@/lib/format";
import { RunStatusBadge } from "@/components/status/badges";
import { Notice } from "@/components/status/notice";
import { CodeBlock } from "@/components/ui/code-block";
import { DetailList } from "@/components/ui/detail-list";
import { ExpanderRow } from "@/components/ui/expander";
import { Mono } from "@/components/ui/mono";
import { RelativeTime } from "@/components/ui/relative-time";

const KIND_LABELS: Record<string, string> = {
  entity_added: "New page",
  value_changed: "Changed page",
  alert: "Alert",
};

interface RunListProps {
  runs: RunView[];
  /** Hide the script name, for a list that belongs to one script. */
  hideScript?: boolean;
}

/** Runs, one per row. A row opens to show the event, the timings, and the result or error. */
export function RunList({ runs, hideScript }: RunListProps) {
  return (
    <ul>
      {runs.map((run) => (
        <ExpanderRow
          key={run.id}
          summary={
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <span className="w-[6.75rem] shrink-0">
                <RunStatusBadge status={run.status} />
              </span>
              {hideScript ? null : (
                <span className="w-60 max-w-full truncate text-sm font-medium text-ink">{run.scriptName}</span>
              )}
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-3">{shortUrl(run.event.url)}</span>
              <span className="ml-auto flex shrink-0 items-center gap-3 text-xs text-ink-3 tabular-nums">
                <span className="w-12 text-right">{run.durationMs !== null ? formatDuration(run.durationMs) : ""}</span>
                <RelativeTime iso={run.queuedAt} className="w-[4.5rem] text-right" />
              </span>
            </div>
          }
        >
          {() => <RunDetail run={run} />}
        </ExpanderRow>
      ))}
    </ul>
  );
}

function RunDetail({ run }: { run: RunView }) {
  const started = run.status !== "queued";
  const finished = run.status === "succeeded" || run.status === "invalid" || run.status === "failed";
  return (
    <div className="flex flex-col gap-4">
      <DetailList
        items={[
          { label: "Queued", value: formatClock(run.queuedAt) },
          { label: "Started", value: started ? formatClock(run.startsAt) : "Not yet" },
          { label: "Finished", value: finished ? formatClock(run.finishesAt) : "Not yet" },
          { label: "Duration", value: formatDuration(run.durationMs) },
        ]}
      />

      <div>
        <h3 className="mb-2 text-xs font-medium text-ink-3">Event</h3>
        <DetailList
          items={[
            { label: "Kind", value: KIND_LABELS[run.event.kind] ?? run.event.kind },
            { label: "Sequence", value: <Mono>{run.event.seq}</Mono> },
            {
              label: "Script",
              value: (
                <Link href={`/scripts/${run.scriptId}`} className="underline decoration-line-strong underline-offset-4 hover:decoration-ink">
                  {run.scriptName}
                </Link>
              ),
            },
            {
              label: "Webhook",
              value: (
                <Link href={`/webhooks/${run.webhookId}`} className="underline decoration-line-strong underline-offset-4 hover:decoration-ink">
                  <Mono className="text-ink">{run.webhookId}</Mono>
                </Link>
              ),
            },
          ]}
        />
        <p className="mt-3 font-mono text-xs break-all text-ink-2">{run.event.url}</p>
        {run.event.page_text ? (
          <p className="mt-2 line-clamp-3 border-l-2 border-line-strong pl-3 text-[13px] text-ink-2">{run.event.page_text}</p>
        ) : null}
      </div>

      {run.status === "succeeded" && run.result ? (
        <div>
          <h3 className="mb-2 text-xs font-medium text-ink-3">
            Result · confidence {formatPercent(run.result.confidence)} · pipeline {run.result.pipeline_version}
          </h3>
          <CodeBlock code={prettyJson(run.result.extracted)} label="extracted" what="result" maxHeight="16rem" />
        </div>
      ) : null}

      {run.status === "invalid" ? (
        <Notice tone="amber" title="Output did not match the schema">
          {run.error ?? "The script ran, but what it produced was not the shape the schema requires. Nothing was emitted."}
        </Notice>
      ) : null}

      {run.status === "failed" ? (
        <Notice tone="red" title="The script errored">
          {run.error ?? "No error message was recorded."}
        </Notice>
      ) : null}

      {!finished ? (
        <p className="text-[13px] text-ink-3">
          {run.status === "queued" ? "Waiting to start." : "Running now."} The result appears here when the run finishes.
        </p>
      ) : null}
    </div>
  );
}
