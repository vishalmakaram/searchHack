"use client";

import { CircleCheck, Inbox, Moon } from "lucide-react";
import { useMemo } from "react";
import { getOverview, listScripts, listWebhooks } from "@/lib/api";
import { plural } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";
import { DeliveryList } from "@/components/deliveries/delivery-list";
import { healthHeadline, Pipeline } from "@/components/overview/pipeline";
import { ScriptCounts } from "@/components/overview/script-counts";
import { RunList } from "@/components/runs/run-list";
import { PageBody, PageHeader } from "@/components/shell/page";
import { HealthBadge } from "@/components/status/badges";
import { Card, CardHeader } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { PageSkeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, StaleBanner } from "@/components/ui/states";

// The overview itself, plus names for the ids it refers to.
async function fetchOverview() {
  const [overview, webhooks, scripts] = await Promise.all([getOverview(), listWebhooks(), listScripts()]);
  return { overview, webhooks, scripts };
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
              Send a test event from a webhook to watch a run pass through.
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
          <CardHeader title="Recent problems" description="The last 10 runs that failed or produced invalid output" />
          <div className="border-t border-line">
            {overview.recentProblems.length > 0 ? (
              <RunList runs={overview.recentProblems} />
            ) : (
              <EmptyState compact icon={<CircleCheck aria-hidden />} title="No problems">
                No run has failed or produced invalid output.
              </EmptyState>
            )}
          </div>
        </Card>
      </div>
    </PageBody>
  );
}
