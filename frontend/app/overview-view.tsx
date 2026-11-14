"use client";

import { CircleCheck, Inbox, Moon } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { getOverview, listScripts, listWebhooks } from "@/lib/api";
import { plural } from "@/lib/format";
import type { Overview } from "@/lib/types";
import { useEventStream } from "@/lib/use-event-stream";
import { usePoll } from "@/lib/use-poll";
import { DeliveryList } from "@/components/deliveries/delivery-list";
import { LiveFeed } from "@/components/live/live-feed";
import { healthHeadline, Pipeline } from "@/components/overview/pipeline";
import { ScriptCounts } from "@/components/overview/script-counts";
import { RunList } from "@/components/runs/run-list";
import { PageBody, PageHeader } from "@/components/shell/page";
import { HealthBadge, ServiceBadge, StreamBadge, WorkspaceStatusBadge } from "@/components/status/badges";
import { StatusPill } from "@/components/status/status-pill";
import { Card, CardHeader } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { PageSkeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, StaleBanner } from "@/components/ui/states";

// The overview itself, plus names for the ids it refers to.
async function fetchOverview() {
  const [overview, webhooks, scripts] = await Promise.all([getOverview(), listWebhooks(), listScripts()]);
  return { overview, webhooks, scripts };
}

function Stream() {
  const { status } = useEventStream();
  return <StreamBadge status={status} />;
}

/** The two Python services this app drives, and where results can be sent. */
function Services({ overview }: { overview: Overview }) {
  return (
    <section aria-labelledby="services-heading" className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)]">
      <h2 id="services-heading" className="sr-only">
        Services
      </h2>
      {overview.services.map((service) => (
        <div
          key={service.key}
          data-tone={service.up ? "green" : "red"}
          className={`flex flex-col gap-1.5 rounded-xl border bg-surface px-5 py-4 shadow-card ${service.up ? "border-line" : "border-tone-line"}`}
        >
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold tracking-tight text-ink">{service.label}</h3>
            <ServiceBadge up={service.up} />
          </div>
          <p className="truncate font-mono text-xs text-ink-3">{service.url}</p>
          {service.up ? null : (
            <p className="text-xs text-ink-2">
              Start it from the repository root:{" "}
              <code className="font-mono">{service.key === "runtime" ? "python -m sentinel.server" : "python -m output_integration.server"}</code>
            </p>
          )}
        </div>
      ))}
      <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface px-5 py-4 shadow-card">
        <h3 className="text-sm font-semibold tracking-tight text-ink">Outputs</h3>
        {overview.channels.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {overview.channels.map((channel) => (
              <li key={channel.name}>
                <StatusPill
                  tone={channel.configured ? "green" : "grey"}
                  label={`${channel.name.replace(/_/g, " ")}${channel.configured ? "" : " (not set up)"}`}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-ink-3">The output service is not reachable, so its outputs are unknown.</p>
        )}
      </div>
    </section>
  );
}

export function OverviewView() {
  const { data, error } = usePoll(fetchOverview);

  const webhookNames = useMemo(() => new Map(data?.webhooks.map((webhook) => [webhook.id, webhook.name])), [data?.webhooks]);
  const scriptNames = useMemo(() => new Map(data?.scripts.map((script) => [script.id, script.name])), [data?.scripts]);

  if (!data) {
    return error ? (
      <PageBody>
        <PageHeader title="Overview" />
        <Card>
          <ErrorState error={error} what="the pipeline state" />
        </Card>
      </PageBody>
    ) : (
      <PageSkeleton />
    );
  }

  const { overview } = data;

  return (
    <PageBody>
      <PageHeader
        title="Overview"
        badges={<HealthBadge health={overview.health} />}
        description={healthHeadline(overview.health)}
      />
      <StaleBanner error={error} />

      <Services overview={overview} />

      <section aria-labelledby="pipeline-heading" className="flex flex-col gap-3">
        <h2 id="pipeline-heading" className="sr-only">
          Pipeline
        </h2>
        <Pipeline stages={overview.stages} />
      </section>

      <section aria-labelledby="scripts-heading" className="flex flex-col gap-3">
        <h2 id="scripts-heading" className="text-[15px] font-semibold tracking-tight">
          Scripts by status
        </h2>
        <ScriptCounts counts={overview.scriptCounts} />
      </section>

      {overview.building.length > 0 ? (
        <Card>
          <CardHeader title="Building now" description="Workspaces whose script is being written." />
          <ul className="border-t border-line">
            {overview.building.map((workspace) => (
              <li key={workspace.id} className="relative flex items-center gap-4 border-t border-line px-5 py-3 first:border-t-0 hover:bg-surface-2/70">
                <WorkspaceStatusBadge status={workspace.status} />
                <Link href={`/workspaces/${workspace.id}`} className="min-w-0 flex-1 truncate text-sm font-medium text-ink after:absolute after:inset-0">
                  {workspace.name}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Live activity" description="Every step the runtime takes, as it happens." actions={<Stream />} />
        <div className="border-t border-line">
          <LiveFeed hideAgents maxHeight="16rem" limit={40} />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Runs in flight"
          description={
            overview.runsInFlight.length > 0
              ? `${plural(overview.runsInFlight.length, "run")} queued or running`
              : "Queued and running runs appear here as they happen"
          }
          actions={
            <LinkButton href="/activity" size="sm" variant="ghost">
              All activity
            </LinkButton>
          }
        />
        {overview.runsInFlight.length > 0 ? (
          <div className="border-t border-line">
            <RunList runs={overview.runsInFlight} />
          </div>
        ) : (
          <div className="border-t border-line">
            <EmptyState compact icon={<Moon aria-hidden />} title="Nothing is running right now">
              Run a page from a script, or send a test event from a webhook, to watch a run pass through.
            </EmptyState>
          </div>
        )}
      </Card>

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Recent deliveries"
            description="The last 10 requests received on any webhook"
            actions={
              <LinkButton href="/webhooks" size="sm" variant="ghost">
                Webhooks
              </LinkButton>
            }
          />
          <div className="border-t border-line">
            {overview.recentDeliveries.length > 0 ? (
              <DeliveryList deliveries={overview.recentDeliveries} scriptNames={scriptNames} webhookNames={webhookNames} />
            ) : (
              <EmptyState compact icon={<Inbox aria-hidden />} title="No deliveries yet">
                Deliveries show up here as soon as Telem, curl or the test button posts to a webhook.
              </EmptyState>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Recent problems" description="The last 10 runs that failed" />
          <div className="border-t border-line">
            {overview.recentProblems.length > 0 ? (
              <RunList runs={overview.recentProblems} />
            ) : (
              <EmptyState compact icon={<CircleCheck aria-hidden />} title="No problems">
                No run has failed.
              </EmptyState>
            )}
          </div>
        </Card>
      </div>
    </PageBody>
  );
}
