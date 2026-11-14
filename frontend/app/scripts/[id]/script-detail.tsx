"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ListX, Play, Power, Radar, Rocket } from "lucide-react";
import { useCallback, useId, useState } from "react";
import {
  activateScript,
  collectScript,
  deactivateScript,
  deployScript,
  errorMessage,
  getScript,
  isNotFound,
  listRuns,
  listWebhooks,
  runScriptUrl,
} from "@/lib/api";
import type { ScriptDetail as Script, ScriptView } from "@/lib/types";
import { formatDateTime, formatPercent } from "@/lib/format";
import { useEventStream } from "@/lib/use-event-stream";
import { usePoll } from "@/lib/use-poll";
import { LiveFeed } from "@/components/live/live-feed";
import { RunList } from "@/components/runs/run-list";
import { PageBody, PageHeader } from "@/components/shell/page";
import { EnabledBadge, ScriptActivityBadge, ScriptStatusBadge, StreamBadge } from "@/components/status/badges";
import { Notice } from "@/components/status/notice";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
import { DetailList } from "@/components/ui/detail-list";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { RelativeTime } from "@/components/ui/relative-time";
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
      "It becomes active: every event from a webhook routed to it runs for real, which uses Telem and model credits. You can deactivate it afterwards, but it never returns to Developed.",
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
            <ScriptStatusBadge status={script.status} />
          </>
        }
        description={script.query}
        actions={
          <Button variant={action.variant} icon={action.icon} onClick={() => setConfirming(true)}>
            {action.label}
          </Button>
        }
      />
      <StaleBanner error={error} />

      {script.status === "developed" ? (
        <Notice title="Never deployed">
          This script has been written but not deployed, so it receives nothing. You can still try it on a page below. Events sent to it are skipped. Deploy it to
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

      <RunPanel script={script} onStarted={refresh} />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader title="Source" description="process.py, written by the builder agent. Read-only." />
          <CardBody>
            {script.source !== null ? (
              <CodeBlock code={script.source} label={`${script.name} · process.py`} what="script source" lineNumbers />
            ) : (
              <p className="text-[13px] text-ink-3">process.py could not be read from the workspace folder.</p>
            )}
          </CardBody>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Build check" description="The new script run once against a real sample page." />
            <CardBody>
              {script.buildCheck ? (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-ink">
                    {script.buildCheck.ok ? "Passed" : "Failed"}
                    {script.buildCheck.durationMs !== null ? ` in ${(script.buildCheck.durationMs / 1000).toFixed(1)} s` : ""}
                    {script.buildCheck.error ? `: ${script.buildCheck.error}` : ""}
                  </p>
                  {script.sampleUrl ? (
                    <a
                      href={script.sampleUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate text-[13px] text-ink-2 underline decoration-line-strong underline-offset-4"
                    >
                      {script.sampleUrl}
                    </a>
                  ) : null}
                  {script.buildCheck.output !== null && script.buildCheck.output !== undefined ? (
                    <CodeBlock
                      code={JSON.stringify(script.buildCheck.output, null, 2)}
                      label="Output on the sample page"
                      what="build check output"
                    />
                  ) : null}
                </div>
              ) : (
                <p className="text-[13px] text-ink-3">No build check was recorded for this script.</p>
              )}
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
        <CardHeader title="Live activity" description="Each step the runtime takes for this script, as it happens." actions={<Stream />} />
        <div className="border-t border-line">
          <LiveFeed workspaceId={script.id} maxHeight="18rem" empty="Run a page to see each step here." />
        </div>
      </Card>

      <Card>
        <CardHeader title="Recent runs" description="The last 25 runs of this script. Open one to see what it made of the page." />
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

function Stream() {
  const { status } = useEventStream();
  return <StreamBadge status={status} />;
}

/** Run one page now, or ask Telem what is new. Both are real work in the runtime. */
function RunPanel({ script, onStarted }: { script: Script; onStarted: () => Promise<void> }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<"run" | "collect" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const hintId = useId();

  const start = async (kind: "run" | "collect") => {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      if (kind === "run") {
        await runScriptUrl(script.id, url.trim());
        setUrl("");
      } else {
        await collectScript(script.id);
      }
      await onStarted();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Run it now"
        description="Take one page through the whole pipeline: fetch it, run the script, and let the delivery agent act on the result."
      />
      <CardBody className="flex flex-col gap-3">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (url.trim()) void start("run");
          }}
        >
          <div className="flex min-w-64 flex-1 flex-col gap-1.5">
            <label htmlFor={inputId} className="text-[13px] font-medium text-ink">
              Page address
            </label>
            <Input
              id={inputId}
              type="url"
              inputMode="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder={script.sampleUrl ?? "https://example.com/news/article"}
              aria-describedby={hintId}
            />
          </div>
          <Button type="submit" variant="primary" icon={<Play className="size-4" aria-hidden />} loading={busy === "run"} disabled={!url.trim()}>
            Run page
          </Button>
          <Button
            icon={<Radar className="size-4" aria-hidden />}
            loading={busy === "collect"}
            disabled={script.status !== "active"}
            title={script.status === "active" ? undefined : "Only an active script collects"}
            onClick={() => void start("collect")}
          >
            Collect now
          </Button>
        </form>
        <p id={hintId} className="text-xs text-ink-3">
          A run takes a minute or more and uses Telem and model credits. Collect asks the Telem monitor what is new for this
          workspace and runs up to three new pages{script.status === "active" ? "" : "; it is available once the script is active"}.
        </p>
        {error ? <Notice tone="red">{error}</Notice> : null}
      </CardBody>
    </Card>
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
          {script.workspaceId}
        </Link>
      ),
    },
    { label: "Built", value: script.builtAt ? formatDateTime(script.builtAt) : "—" },
    { label: "First deployed", value: script.deployedAt ? formatDateTime(script.deployedAt) : "Never" },
  ];
}
