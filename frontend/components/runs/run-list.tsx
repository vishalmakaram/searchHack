"use client";

import Link from "next/link";
import type { PageResult, RunSource, RunView } from "@/lib/types";
import { formatClock, formatDuration, prettyJson, shortUrl } from "@/lib/format";
import { RunStatusBadge } from "@/components/status/badges";
import { Notice } from "@/components/status/notice";
import { CodeBlock } from "@/components/ui/code-block";
import { DetailList } from "@/components/ui/detail-list";
import { ExpanderRow } from "@/components/ui/expander";
import { Mono } from "@/components/ui/mono";
import { RelativeTime } from "@/components/ui/relative-time";

const SOURCE_LABELS: Record<RunSource, string> = {
  webhook: "Webhook",
  manual: "Run by hand",
  collect: "Collect",
};

const link = "underline decoration-line-strong underline-offset-4 hover:decoration-ink";

interface RunListProps {
  runs: RunView[];
  /** Hide the script name, for a list that belongs to one script. */
  hideScript?: boolean;
}

/** Runs, one per row. A row opens to show the timings and what the pipeline made of each page. */
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
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-3">
                {run.url ? shortUrl(run.url) : "Collect: ask Telem what is new"}
              </span>
              <span className="ml-auto flex shrink-0 items-center gap-3 text-xs text-ink-3 tabular-nums">
                <span className="w-16 text-right">{run.durationMs !== null ? formatDuration(run.durationMs) : ""}</span>
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
  const finished = run.finishedAt !== null;
  return (
    <div className="flex flex-col gap-4">
      <DetailList
        items={[
          { label: "Queued", value: formatClock(run.queuedAt) },
          { label: "Started", value: run.startedAt ? formatClock(run.startedAt) : "Not yet" },
          { label: "Finished", value: run.finishedAt ? formatClock(run.finishedAt) : "Not yet" },
          { label: "Duration", value: formatDuration(run.durationMs) },
          {
            label: "Script",
            value: (
              <Link href={`/scripts/${run.scriptId}`} className={link}>
                {run.scriptName}
              </Link>
            ),
          },
          { label: "Started by", value: SOURCE_LABELS[run.source] },
          {
            label: "Webhook",
            value: run.webhookId ? (
              <Link href={`/webhooks/${run.webhookId}`} className={link}>
                <Mono className="text-ink">{run.webhookId}</Mono>
              </Link>
            ) : (
              "—"
            ),
          },
          { label: "Run", value: <Mono>{run.id}</Mono> },
        ]}
      />
      {run.url ? <p className="font-mono text-xs break-all text-ink-2">{run.url}</p> : null}

      {!finished ? (
        <p className="text-[13px] text-ink-3">
          {run.status === "queued"
            ? "Waiting for the runs ahead of it. Runs go through the runtime one at a time."
            : "The runtime is working on it: fetching the page, running the script, then the delivery agent. This can take a minute or more."}
        </p>
      ) : null}

      {run.status === "failed" ? (
        <Notice tone="red" title="This run failed">
          {run.error ?? "No error message was recorded."}
        </Notice>
      ) : finished && run.summary ? (
        <p className="text-[13px] text-ink-2">{run.summary}</p>
      ) : null}

      {run.pages.length > 0 ? (
        <div className="flex flex-col gap-3">
          {run.pages.map((page, index) => (
            <PageBlock key={`${page.url}-${index}`} page={page} showHeader={run.source === "collect"} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PageBlock({ page, showHeader }: { page: PageResult; showHeader: boolean }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface px-3.5 py-3">
      {showHeader ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <RunStatusBadge status={page.outcome} />
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-3">{shortUrl(page.url)}</span>
        </div>
      ) : null}
      {page.title ? <p className="text-sm font-medium text-ink">{page.title}</p> : null}
      {page.processed ? (
        <p className="border-l-2 border-line-strong pl-3 text-[13px] text-ink-2">{page.processed}</p>
      ) : null}
      {page.reason && page.outcome !== "failed" ? <p className="text-[13px] text-ink-3">{page.reason}</p> : null}
      {page.reason && page.outcome === "failed" && showHeader ? <p className="text-[13px] text-[var(--red-fg)]">{page.reason}</p> : null}
      {page.data && Object.keys(page.data).length > 0 ? (
        <CodeBlock code={prettyJson(page.data)} label="extracted" what="extracted fields" maxHeight="14rem" />
      ) : null}
      {page.agentReply ? (
        <div>
          <p className="mb-1 text-xs font-medium text-ink-3">Delivery agent</p>
          <p className="text-[13px] whitespace-pre-wrap text-ink-2">{page.agentReply}</p>
        </div>
      ) : null}
      {!page.title && !page.processed && !page.reason && !page.data && !page.agentReply ? (
        <p className="text-[13px] text-ink-3">The runtime reported nothing more about this page.</p>
      ) : null}
    </div>
  );
}
