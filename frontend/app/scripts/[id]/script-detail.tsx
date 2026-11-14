"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ListX, Power, Rocket } from "lucide-react";
import { useCallback, useState } from "react";
import { activateScript, deactivateScript, deployScript, getScript, isNotFound, listRuns, listWebhooks } from "@/lib/api";
import type { ScriptView } from "@/lib/types";
import { formatDateTime, formatPercent } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";
import { RunList } from "@/components/runs/run-list";
import { PageBody, PageHeader } from "@/components/shell/page";
import { EnabledBadge, ScriptActivityBadge, ScriptStatusBadge } from "@/components/status/badges";
import { Notice } from "@/components/status/notice";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
import { DetailList } from "@/components/ui/detail-list";
import { ConfirmDialog } from "@/components/ui/dialog";
import { RelativeTime } from "@/components/ui/relative-time";
import { SchemaTable } from "@/components/ui/schema-table";
import { PageSkeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, NotFoundState, StaleBanner } from "@/components/ui/states";

const BACK = { href: "/scripts", label: "Scripts" };

/** The one status change that is legal from each status, and how to explain it. */
const ACTIONS = {
  developed: {
    label: "Deploy",
    icon: <Rocket className="size-4" aria-hidden />,
    variant: "primary",
    title: "Deploy this script?",
    description:
      "It becomes active and starts receiving events from every webhook routed to it. You can deactivate it afterwards, but it never returns to Developed.",
    confirmLabel: "Deploy",
    run: deployScript,
  },
  active: {
    label: "Deactivate",
    icon: <Power className="size-4" aria-hidden />,
    variant: "secondary",
    title: "Deactivate this script?",
    description:
      "It stops receiving events. Events sent to it while it is inactive are skipped, not saved for later. Runs already in flight finish normally.",
    confirmLabel: "Deactivate",
    run: deactivateScript,
  },
  inactive: {
    label: "Reactivate",
    icon: <Power className="size-4" aria-hidden />,
    variant: "primary",
    title: "Reactivate this script?",
    description: "It starts receiving events again from every webhook routed to it.",
    confirmLabel: "Reactivate",
    run: activateScript,
  },
} as const;

export function ScriptDetail() {
  const { id } = useParams<{ id: string }>();

  const fetcher = useCallback(async () => {
    const script = await getScript(id);
    const [runs, webhooks] = await Promise.all([listRuns({ scriptId: id, limit: 25 }), listWebhooks()]);
    return { script, runs, webhooks: webhooks.filter((webhook) => script.webhookIds.includes(webhook.id)) };
  }, [id]);
  const { data, error, refresh } = usePoll(fetcher);
  const [confirming, setConfirming] = useState(false);

  if (isNotFound(error)) {
    return (
      <PageBody>
        <PageHeader title="Script" back={BACK} />
        <NotFoundState what="script" backHref="/scripts" backLabel="Back to scripts" />
      </PageBody>
    );
  }
  if (!data) {
    return error ? (
      <PageBody>
        <PageHeader title="Script" back={BACK} />
        <Card>
          <ErrorState error={error} what="this script" />
        </Card>
      </PageBody>
    ) : (
      <PageSkeleton />
    );
  }

  const { script, runs, webhooks } = data;
  const action = ACTIONS[script.status];

  return (
    <PageBody>
      <PageHeader
        back={BACK}
        title={script.name}
        badges={
          <>
            <span className="rounded-md border border-line-strong px-1.5 py-px font-mono text-xs text-ink-2">v{script.version}</span>
            <ScriptStatusBadge status={script.status} />
          </>
        }
        description={script.description}
        actions={
          <Button variant={action.variant} icon={action.icon} onClick={() => setConfirming(true)}>
            {action.label}
          </Button>
        }
      />
      <StaleBanner error={error} />

      {script.status === "developed" ? (
        <Notice title="Never deployed">
          This script has been compiled but not deployed, so it receives nothing. Events sent to it are skipped. Deploy it to
          start processing.
        </Notice>
      ) : null}
      {script.status === "inactive" ? (
        <Notice tone="grey" title="Switched off">
          This script is inactive and receives nothing. Events sent to it are skipped until you reactivate it.
        </Notice>
      ) : null}
      {script.status === "active" && webhooks.length === 0 ? (
        <Notice tone="amber" title="Nothing routes here">
          This script is active, but no webhook sends events to it.{" "}
          <Link href="/webhooks" className="font-medium text-ink underline underline-offset-4">
            Route a webhook to it
          </Link>{" "}
          to give it work.
        </Notice>
      ) : null}

      <Card>
        <CardBody className="pt-5">
          <DetailList items={stateItems(script)} />
        </CardBody>
      </Card>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader title="Source" description="Compiled by the agent. Read-only." />
          <CardBody>
            <CodeBlock code={script.source} label={`${script.name} · v${script.version}`} what="script source" lineNumbers />
          </CardBody>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Output schema" description="A run only succeeds if its output has this shape." />
            <CardBody>
              <SchemaTable schema={script.extractionSchema} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Webhooks" description="Where this script's events come from." />
            <CardBody>
              {webhooks.length > 0 ? (
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {webhooks.map((webhook) => (
                    <li key={webhook.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                      <Link
                        href={`/webhooks/${webhook.id}`}
                        className="min-w-0 truncate text-sm font-medium text-ink underline decoration-line-strong underline-offset-4"
                      >
                        {webhook.name}
                      </Link>
                      <EnabledBadge enabled={webhook.enabled} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-ink-3">
                  No webhook routes to this script. Add it as a target on the{" "}
                  <Link href="/webhooks" className="font-medium text-ink underline underline-offset-4">
                    Webhooks
                  </Link>{" "}
                  page.
                </p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader title="Recent runs" description="The last 25 events this script processed." />
        <div className="border-t border-line">
          {runs.length > 0 ? (
            <RunList runs={runs} hideScript />
          ) : (
            <EmptyState compact icon={<ListX aria-hidden />} title="No runs yet">
              {script.status === "active"
                ? "Runs appear here when a webhook routed to this script receives an event."
                : "This script has not processed anything."}
            </EmptyState>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={action.title}
        description={action.description}
        confirmLabel={action.confirmLabel}
        onConfirm={async () => {
          await action.run(script.id);
          // Close first: once the new status lands, this dialog would describe the next action.
          setConfirming(false);
          await refresh();
        }}
      />
    </PageBody>
  );
}

function stateItems(script: ScriptView) {
  return [
    { label: "Activity", value: <ScriptActivityBadge activity={script.activity} /> },
    { label: "Runs in flight", value: script.runsInFlight },
    { label: "Runs, last 24 h", value: script.runsLast24h },
    { label: "Failure rate, last 10 runs", value: formatPercent(script.failureRate) },
    { label: "Last run", value: <RelativeTime iso={script.lastRunAt} /> },
    {
      label: "Workspace",
      value: (
        <Link href={`/workspaces/${script.workspaceId}`} className="underline decoration-line-strong underline-offset-4 hover:decoration-ink">
          {script.workspaceName}
        </Link>
      ),
    },
    { label: "Compiled", value: formatDateTime(script.createdAt) },
    { label: "First deployed", value: script.deployedAt ? formatDateTime(script.deployedAt) : "Never" },
  ];
}
