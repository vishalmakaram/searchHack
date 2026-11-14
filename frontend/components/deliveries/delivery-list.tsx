"use client";

import Link from "next/link";
import { useCallback } from "react";
import { listRuns } from "@/lib/api";
import type { Delivery } from "@/lib/types";
import { formatBytes, formatDateTime, plural, prettyJson } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";
import { RunStatusBadge, SignatureBadge } from "@/components/status/badges";
import { Notice } from "@/components/status/notice";
import { CodeBlock } from "@/components/ui/code-block";
import { DetailList } from "@/components/ui/detail-list";
import { ExpanderRow } from "@/components/ui/expander";
import { Mono } from "@/components/ui/mono";
import { RelativeTime } from "@/components/ui/relative-time";
import { Skeleton } from "@/components/ui/skeleton";

const SKIP_REASONS: Record<string, string> = {
  script_not_active: "the script is not active",
};

interface DeliveryListProps {
  deliveries: Delivery[];
  /** Script id -> name, to name the scripts a delivery skipped. */
  scriptNames: Map<string, string>;
  /** Webhook id -> name. When given, each row names its webhook. */
  webhookNames?: Map<string, string>;
}

/** Deliveries, one per row. A row opens to show what the delivery contained and what happened to it. */
export function DeliveryList({ deliveries, scriptNames, webhookNames }: DeliveryListProps) {
  return (
    <ul>
      {deliveries.map((delivery) => {
        const webhookName = webhookNames?.get(delivery.webhookId);
        return (
          <ExpanderRow
            key={delivery.id}
            summary={
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                {webhookNames ? (
                  <span className="max-w-48 truncate text-sm font-medium text-ink">{webhookName ?? "Deleted webhook"}</span>
                ) : null}
                <Mono>{delivery.webhookType}</Mono>
                {delivery.isTest ? (
                  <span className="rounded-md border border-line-strong px-1.5 py-px text-[11px] font-medium text-ink-2">Test</span>
                ) : null}
                <span className="text-[13px] text-ink-2">
                  {plural(delivery.eventCount, "event")}, {plural(delivery.runIds.length, "run")}
                  {delivery.duplicateCount > 0 ? `, ${plural(delivery.duplicateCount, "duplicate")}` : ""}
                </span>
                {delivery.skipped.length > 0 ? (
                  <span data-tone="amber" className="text-[13px] font-medium text-tone-fg">
                    {delivery.skipped.length} skipped
                  </span>
                ) : null}
                <span className="ml-auto shrink-0 text-xs text-ink-3 tabular-nums">
                  <RelativeTime iso={delivery.receivedAt} />
                </span>
              </div>
            }
          >
            {() => <DeliveryDetail delivery={delivery} scriptNames={scriptNames} />}
          </ExpanderRow>
        );
      })}
    </ul>
  );
}

function DeliveryDetail({ delivery, scriptNames }: { delivery: Delivery; scriptNames: Map<string, string> }) {
  return (
    <div className="flex flex-col gap-4">
      <DetailList
        items={[
          { label: "Received", value: formatDateTime(delivery.receivedAt) },
          { label: "Type", value: <Mono className="text-ink">{delivery.webhookType}</Mono> },
          { label: "Signature", value: <SignatureBadge signature={delivery.signature} /> },
          { label: "Size", value: formatBytes(delivery.bodyBytes) },
          { label: "Events", value: delivery.eventCount },
          { label: "Duplicates dropped", value: delivery.duplicateCount },
          { label: "Runs created", value: delivery.runIds.length },
          { label: "Source", value: delivery.isTest ? "Test button" : "HTTP request" },
        ]}
      />

      {delivery.skipped.length > 0 ? (
        <Notice tone="amber" title={`${plural(delivery.skipped.length, "event")} skipped`}>
          <ul className="mt-0.5 flex flex-col gap-0.5">
            {summariseSkips(delivery.skipped).map((skip) => (
              <li key={`${skip.scriptId}:${skip.reason}`}>
                <Link href={`/scripts/${skip.scriptId}`} className="font-medium text-ink underline decoration-line-strong underline-offset-4">
                  {scriptNames.get(skip.scriptId) ?? "A deleted script"}
                </Link>{" "}
                did not receive {plural(skip.count, "event")} because {SKIP_REASONS[skip.reason] ?? skip.reason}.
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {delivery.runIds.length > 0 ? <DeliveryRuns deliveryId={delivery.id} expected={delivery.runIds.length} /> : null}

      {delivery.eventCount > 0 && delivery.runIds.length === 0 && delivery.skipped.length === 0 ? (
        <p className="text-[13px] text-ink-3">
          {delivery.duplicateCount >= delivery.eventCount
            ? "Every event in this delivery had already been received, so nothing ran."
            : "This webhook had no target scripts when the delivery arrived, so nothing ran."}
        </p>
      ) : null}

      <div>
        <h3 className="mb-2 text-xs font-medium text-ink-3">Body</h3>
        <CodeBlock code={prettyJson(delivery.body)} label={formatBytes(delivery.bodyBytes)} what="body" maxHeight="18rem" />
      </div>
    </div>
  );
}

function summariseSkips(skipped: Delivery["skipped"]) {
  const groups = new Map<string, { scriptId: string; reason: string; count: number }>();
  for (const skip of skipped) {
    const key = `${skip.scriptId}:${skip.reason}`;
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { scriptId: skip.scriptId, reason: skip.reason, count: 1 });
  }
  return [...groups.values()];
}

/** The runs one delivery created, kept live while the row is open. */
function DeliveryRuns({ deliveryId, expected }: { deliveryId: string; expected: number }) {
  const fetcher = useCallback(() => listRuns({ deliveryId, limit: 200 }), [deliveryId]);
  const { data, error } = usePoll(fetcher);
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium text-ink-3">Runs</h3>
      {data ? (
        data.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {data.map((run) => (
              <li key={run.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="w-[6.75rem] shrink-0">
                  <RunStatusBadge status={run.status} />
                </span>
                <Link href={`/scripts/${run.scriptId}`} className="text-sm font-medium text-ink underline decoration-line-strong underline-offset-4">
                  {run.scriptName}
                </Link>
                <Mono>seq {run.event.seq}</Mono>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-ink-3">These runs are no longer stored.</p>
        )
      ) : error ? (
        <p className="text-[13px] text-ink-3">Couldn&rsquo;t load the runs for this delivery.</p>
      ) : (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading runs">
          {Array.from({ length: Math.min(expected, 3) }, (_, index) => (
            <Skeleton key={index} className="h-5 w-64" />
          ))}
        </div>
      )}
    </div>
  );
}
