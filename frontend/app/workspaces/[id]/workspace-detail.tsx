"use client";

import { useParams } from "next/navigation";
import { ArrowRight, Check, FileText, LoaderCircle, Inbox } from "lucide-react";
import { useCallback, useMemo } from "react";
import { getWorkspace, getWorkspaceOutput, isNotFound } from "@/lib/api";
import { BUILD_ORDER, type BuildPhase } from "@/lib/events";
import type { Alert, WorkspaceDetail as Workspace, WorkspaceOutput } from "@/lib/types";
import { cn } from "@/lib/cn";
import { formatDateTime, formatPercent, shortUrl } from "@/lib/format";
import { useEventStream } from "@/lib/use-event-stream";
import { usePoll } from "@/lib/use-poll";
import { LiveFeed } from "@/components/live/live-feed";
import { PageBody, PageHeader } from "@/components/shell/page";
import { ImpactBadge, ScriptStatusBadge, StreamBadge, WorkspaceStatusBadge } from "@/components/status/badges";
import { Notice } from "@/components/status/notice";
import { StatusPill } from "@/components/status/status-pill";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DetailList } from "@/components/ui/detail-list";
import { ExpanderRow } from "@/components/ui/expander";
import { Markdown } from "@/components/ui/markdown";
import { Mono } from "@/components/ui/mono";
import { RelativeTime } from "@/components/ui/relative-time";
import { ListSkeleton, PageSkeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, NotFoundState, StaleBanner } from "@/components/ui/states";

const BACK = { href: "/workspaces", label: "Workspaces" };
const link = "underline decoration-line-strong underline-offset-4 hover:decoration-ink";

export function WorkspaceDetail() {
  const { id } = useParams<{ id: string }>();
  const fetcher = useCallback(() => getWorkspace(id), [id]);
  const { data: workspace, error } = usePoll(fetcher);

  if (isNotFound(error)) {
    return (
      <PageBody>
        <PageHeader title="Workspace" back={BACK} />
        <NotFoundState what="workspace" backHref="/workspaces" backLabel="Back to workspaces" />
      </PageBody>
    );
  }
  if (!workspace) {
    return error ? (
      <PageBody>
        <PageHeader title="Workspace" back={BACK} />
        <Card>
          <ErrorState error={error} what="this workspace" />
        </Card>
      </PageBody>
    ) : (
      <PageSkeleton />
    );
  }

  const hasBuild = workspace.status !== "output_only";

  return (
    <PageBody>
      <PageHeader
        back={BACK}
        title={workspace.name}
        badges={<WorkspaceStatusBadge status={workspace.status} />}
        description={workspace.query && workspace.query !== workspace.name ? workspace.query : undefined}
        actions={
          workspace.status === "ready" ? (
            <LinkButton href={`/scripts/${workspace.id}`} variant="primary">
              Open script
              <ArrowRight className="size-4" aria-hidden />
            </LinkButton>
          ) : null
        }
      />
      <StaleBanner error={error} />

      {workspace.status === "building" ? <BuildPanel workspaceId={workspace.id} /> : null}
      {workspace.status === "failed" ? (
        <Notice tone="red" title="The build failed">
          {workspace.error ?? "The runtime did not record why."} Create a new workspace to try again.
        </Notice>
      ) : null}
      {workspace.status === "interrupted" ? (
        <Notice tone="amber" title="The build was interrupted">
          The runtime restarted while it was building this workspace, so it has no script. Create a new workspace to try again.
        </Notice>
      ) : null}
      {workspace.status === "output_only" ? (
        <Notice tone="grey">
          This folder only holds results the output service received. The runtime did not build it, so it has no script and nothing runs for it.
        </Notice>
      ) : null}

      {hasBuild ? <Summary workspace={workspace} /> : null}
      <OutputSection workspaceId={workspace.id} />
      {hasBuild && workspace.status !== "building" ? <MemoryCard workspace={workspace} /> : null}
      {workspace.status === "ready" ? (
        <Card>
          <CardHeader title="Live activity" description="Steps the runtime takes for this workspace, as they happen." actions={<Stream />} />
          <div className="border-t border-line">
            <LiveFeed workspaceId={workspace.id} empty="Run a page from the script to see each step here." />
          </div>
        </Card>
      ) : null}
    </PageBody>
  );
}

function Stream() {
  const { status } = useEventStream();
  return <StreamBadge status={status} />;
}

// --------------------------------------------------------------------- Build

const STEPS: { phase: BuildPhase; label: string; detail: string }[] = [
  { phase: "search", label: "Search", detail: "Find real pages about the sentence" },
  { phase: "fetch", label: "Fetch", detail: "Read candidates and keep one as the sample" },
  { phase: "write", label: "Write", detail: "A builder agent writes process.py" },
  { phase: "verify", label: "Check", detail: "Run the script on the sample page" },
];

/** How far the build has got, from the newest build event for the workspace. */
function useBuildProgress(workspaceId: string): { index: number; repairing: boolean } {
  const { events } = useEventStream();
  return useMemo(() => {
    let furthest = -1;
    let repairing = false;
    for (const { event } of events) {
      if (event.workspace !== workspaceId || event.type !== "build") continue;
      furthest = Math.max(furthest, BUILD_ORDER.indexOf(event.phase));
      if (event.phase === "repair") repairing = true;
    }
    // BUILD_ORDER: search, searched, fetch, write, verify, repair, ready.
    const index = furthest < 0 ? 0 : furthest <= 1 ? (furthest === 1 ? 1 : 0) : furthest === 2 ? 1 : furthest === 3 ? 2 : 3;
    return { index, repairing };
  }, [events, workspaceId]);
}

function BuildPanel({ workspaceId }: { workspaceId: string }) {
  const { index, repairing } = useBuildProgress(workspaceId);
  return (
    <Card>
      <CardHeader
        title="Building the script"
        description="This usually takes one to three minutes. You can leave the page; the build carries on."
        actions={<Stream />}
      />
      <ol className="grid gap-px border-y border-line bg-line sm:grid-cols-4">
        {STEPS.map((step, position) => {
          const state = position < index ? "done" : position === index ? "now" : "next";
          return (
            <li key={step.phase} data-tone={state === "next" ? "grey" : state === "done" ? "green" : "blue"} className="flex gap-3 bg-surface px-5 py-3.5">
              <span
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-tone-fg [&>svg]:size-3",
                  state === "next" ? "border-line-strong" : "border-tone-line bg-tone-bg",
                )}
                aria-hidden
              >
                {state === "done" ? <Check /> : state === "now" ? <LoaderCircle className="animate-spin" /> : null}
              </span>
              <div className="min-w-0">
                <p className={cn("text-sm font-medium", state === "next" ? "text-ink-3" : "text-ink")}>
                  {step.label}
                  <span className="sr-only">{state === "done" ? " (done)" : state === "now" ? " (in progress)" : " (not started)"}</span>
                </p>
                <p className="text-xs text-ink-3">
                  {step.phase === "verify" && repairing ? "The check failed once; the agent is repairing the script" : step.detail}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      <LiveFeed workspaceId={workspaceId} maxHeight="20rem" empty="Waiting for the runtime's first step." />
    </Card>
  );
}

// ------------------------------------------------------------------- Summary

function Summary({ workspace }: { workspace: Workspace }) {
  const check = workspace.buildCheck;
  return (
    <Card>
      <CardHeader title="Workspace" />
      <CardBody>
        <DetailList
          items={[
            { label: "Id", value: <Mono>{workspace.id}</Mono> },
            { label: "Created", value: workspace.createdAt ? formatDateTime(workspace.createdAt) : "—" },
            { label: "Built", value: workspace.builtAt ? formatDateTime(workspace.builtAt) : "Not yet" },
            {
              label: "Script",
              value: workspace.scriptStatus ? <ScriptStatusBadge status={workspace.scriptStatus} /> : "None",
            },
            {
              label: "Sample page",
              value: workspace.sampleUrl ? (
                <a href={workspace.sampleUrl} target="_blank" rel="noreferrer noopener" className={link}>
                  {shortUrl(workspace.sampleUrl)}
                </a>
              ) : (
                "—"
              ),
            },
            {
              label: "Build check",
              value: check ? (
                <StatusPill variant="plain" tone={check.ok ? "green" : "red"} label={check.ok ? "Passed" : "Failed"} />
              ) : (
                "—"
              ),
            },
            { label: "Telem monitor", value: workspace.monitorId ? <Mono>{workspace.monitorId}</Mono> : "None yet" },
            { label: "Pages run / results recorded", value: `${workspace.pagesSeen} / ${workspace.resultsHandled}` },
          ]}
        />
      </CardBody>
    </Card>
  );
}

// -------------------------------------------------------------------- Output

function OutputSection({ workspaceId }: { workspaceId: string }) {
  const fetcher = useCallback(() => getWorkspaceOutput(workspaceId), [workspaceId]);
  const { data, error } = usePoll(fetcher, 5000);

  if (!data) {
    return <Card>{error ? <ErrorState error={error} what="this workspace's results" /> : <ListSkeleton rows={3} />}</Card>;
  }
  if (!data.available) {
    return (
      <Notice tone="amber" title="The output service is not reachable">
        Alerts and the research document live there, so they cannot be shown. Start it with{" "}
        <code className="font-mono text-xs">python -m output_integration.server</code>.
      </Notice>
    );
  }
  return (
    <>
      <StatsRow output={data} />
      <AlertsCard alerts={data.alerts} />
      <Card>
        <CardHeader title="Research document" description="The living document the output service keeps for this workspace." />
        {data.doc.trim() ? (
          <CardBody>
            <Markdown source={data.doc} />
          </CardBody>
        ) : (
          <div className="border-t border-line">
            <EmptyState icon={<FileText aria-hidden />} title="Nothing written yet" compact>
              Entries are added as results are delivered.
            </EmptyState>
          </div>
        )}
      </Card>
    </>
  );
}

function StatsRow({ output }: { output: WorkspaceOutput }) {
  const stats = output.stats;
  if (!stats) return null;
  const tiles = [
    { label: "Results received", value: stats.received },
    { label: "Alerts sent", value: stats.delivered },
    { label: "Held back", value: stats.suppressed },
    { label: "Document entries", value: stats.docEntries },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded-xl border border-line bg-surface px-5 py-4 shadow-card">
          <dt className="text-xs text-ink-3">{tile.label}</dt>
          <dd className="mt-1 text-2xl font-semibold tracking-tight text-ink tabular-nums">{tile.value.toLocaleString("en-US")}</dd>
        </div>
      ))}
    </dl>
  );
}

function AlertsCard({ alerts }: { alerts: Alert[] }) {
  return (
    <Card>
      <CardHeader
        title="Alerts"
        description="Every result the output service received, newest first. Some are held back: duplicates, low impact, low confidence."
      />
      <div className="border-t border-line">
        {alerts.length === 0 ? (
          <EmptyState icon={<Inbox aria-hidden />} title="No results yet" compact>
            Results appear here once the script has run a page and the delivery agent has sent it on.
          </EmptyState>
        ) : (
          <ul className="max-h-[34rem] overflow-y-auto">
            {alerts.map((alert) => (
              <ExpanderRow
                key={alert.seq}
                summary={
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                    <span className="w-[5.5rem] shrink-0">
                      <StatusPill tone={alert.delivered ? "green" : "grey"} label={alert.delivered ? "Sent" : "Held back"} />
                    </span>
                    <span className="w-20 shrink-0">
                      <ImpactBadge impact={alert.impact} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">
                      {alert.eventType ? <span className="font-medium">{alert.eventType}: </span> : null}
                      <span className="text-ink-2">{alert.summary}</span>
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-ink-3 tabular-nums">
                      {alert.at ? <RelativeTime iso={alert.at} /> : `#${alert.seq}`}
                    </span>
                  </div>
                }
              >
                {() => (
                  <div className="flex flex-col gap-3">
                    <p className="text-sm text-ink">{alert.summary}</p>
                    {!alert.delivered && alert.reason ? <p className="text-[13px] text-ink-3">Held back: {alert.reason}</p> : null}
                    <DetailList
                      items={[
                        { label: "Sequence", value: <Mono>{alert.seq}</Mono> },
                        { label: "Received", value: alert.at ? formatDateTime(alert.at) : "—" },
                        { label: "Confidence", value: formatPercent(alert.confidence) },
                        {
                          label: "Source",
                          value: alert.sourceUrl ? (
                            <a href={alert.sourceUrl} target="_blank" rel="noreferrer noopener" className={link}>
                              {shortUrl(alert.sourceUrl)}
                            </a>
                          ) : (
                            "—"
                          ),
                        },
                      ]}
                    />
                  </div>
                )}
              </ExpanderRow>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

// -------------------------------------------------------------------- Memory

function MemoryCard({ workspace }: { workspace: Workspace }) {
  // A fresh memory.md holds only its title line.
  const hasNotes = workspace.memory.split("\n").filter((line) => line.trim()).length > 1;
  return (
    <Card>
      <CardHeader title="Memory" description="What the delivery agent has written down about this workspace (memory.md)." />
      {hasNotes ? (
        <CardBody>
          <Markdown source={workspace.memory} />
        </CardBody>
      ) : (
        <div className="border-t border-line">
          <EmptyState icon={<FileText aria-hidden />} title="Nothing recorded yet" compact>
            The delivery agent adds a note each time it handles a result.
          </EmptyState>
        </div>
      )}
    </Card>
  );
}
