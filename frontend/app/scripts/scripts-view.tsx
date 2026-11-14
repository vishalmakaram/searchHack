"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FileCode2, Plus } from "lucide-react";
import { listScripts } from "@/lib/api";
import type { ScriptStatus, ScriptView } from "@/lib/types";
import { formatPercent } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";
import { PageBody, PageHeader } from "@/components/shell/page";
import { ScriptActivityBadge, ScriptStatusBadge } from "@/components/status/badges";
import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RelativeTime } from "@/components/ui/relative-time";
import { ListSkeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, StaleBanner } from "@/components/ui/states";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { LinkTabs } from "@/components/ui/tabs";

const FILTERS: { status: ScriptStatus | null; label: string }[] = [
  { status: null, label: "All" },
  { status: "active", label: "Active" },
  { status: "inactive", label: "Inactive" },
  { status: "developed", label: "Developed" },
];

// Every script is fetched once and filtered here, so switching tabs is instant
// and each tab can show its count.
const fetchScripts = () => listScripts();

export function ScriptsView() {
  const params = useSearchParams();
  const requested = params.get("status");
  const filter = FILTERS.find((item) => item.status === requested)?.status ?? null;

  const { data, error } = usePoll(fetchScripts);
  const visible = data?.filter((script) => filter === null || script.status === filter);

  return (
    <PageBody>
      <PageHeader
        title="Scripts"
        description="Each workspace compiles to one processing script. A script only receives events while it is active."
      />
      <LinkTabs
        label="Filter scripts by status"
        items={FILTERS.map((item) => ({
          label: item.label,
          href: item.status ? `/scripts?status=${item.status}` : "/scripts",
          active: item.status === filter,
          count: data ? data.filter((script) => item.status === null || script.status === item.status).length : undefined,
        }))}
      />
      <StaleBanner error={data ? error : null} />
      <Card>
        {!visible ? (
          error ? (
            <ErrorState error={error} what="scripts" />
          ) : (
            <ListSkeleton />
          )
        ) : visible.length === 0 ? (
          filter === null ? (
            <EmptyState
              icon={<FileCode2 aria-hidden />}
              title="No scripts yet"
              action={
                <LinkButton href="/workspaces/new" variant="primary" icon={<Plus className="size-4" aria-hidden />}>
                  New workspace
                </LinkButton>
              }
            >
              A script is written when a workspace finishes building.
            </EmptyState>
          ) : (
            <EmptyState icon={<FileCode2 aria-hidden />} title={`No ${filter} scripts`}>
              {filter === "developed"
                ? "Every script has been deployed at least once."
                : filter === "active"
                  ? "Deploy a developed script, or reactivate an inactive one, to start processing events."
                  : "No script has been switched off."}
            </EmptyState>
          )
        ) : (
          <ScriptsTable scripts={visible} />
        )}
      </Card>
    </PageBody>
  );
}

function ScriptsTable({ scripts }: { scripts: ScriptView[] }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Script</Th>
          <Th>Workspace</Th>
          <Th>Status</Th>
          <Th>Activity</Th>
          <Th className="text-right">Runs, 24 h</Th>
          <Th className="text-right">Failure rate</Th>
          <Th className="text-right">Last run</Th>
        </tr>
      </thead>
      <tbody>
        {scripts.map((script) => (
          <Tr key={script.id} className="relative transition-colors hover:bg-surface-2/70">
            <Td>
              {/* The link stretches over the whole row, so the row is one click target. */}
              <Link href={`/scripts/${script.id}`} className="font-medium text-ink after:absolute after:inset-0">
                {script.name}
              </Link>
            </Td>
            <Td>
              <Link
                href={`/workspaces/${script.workspaceId}`}
                className="relative z-10 text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink"
              >
                {script.workspaceId}
              </Link>
            </Td>
            <Td>
              <ScriptStatusBadge status={script.status} />
            </Td>
            <Td>
              <ScriptActivityBadge activity={script.activity} />
            </Td>
            <Td className="text-right tabular-nums">{script.runsLast24h}</Td>
            <Td className="text-right tabular-nums">
              <span
                data-tone={script.failureRate !== null && script.failureRate >= 0.5 ? "red" : undefined}
                className={script.failureRate !== null && script.failureRate >= 0.5 ? "font-medium text-tone-fg" : undefined}
              >
                {formatPercent(script.failureRate)}
              </span>
            </Td>
            <Td className="text-right whitespace-nowrap text-ink-2">
              <RelativeTime iso={script.lastRunAt} />
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
