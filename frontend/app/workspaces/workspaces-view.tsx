"use client";

import Link from "next/link";
import { Plus, Telescope } from "lucide-react";
import { listWorkspaces } from "@/lib/api";
import type { WorkspaceView } from "@/lib/types";
import { usePoll } from "@/lib/use-poll";
import { PageBody, PageHeader } from "@/components/shell/page";
import { ScriptStatusBadge, WorkspaceStatusBadge } from "@/components/status/badges";
import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RelativeTime } from "@/components/ui/relative-time";
import { ListSkeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, StaleBanner } from "@/components/ui/states";
import { Table, Td, Th, Tr } from "@/components/ui/table";

export function WorkspacesView() {
  const { data, error } = usePoll(listWorkspaces);

  const newButton = (
    <LinkButton href="/workspaces/new" variant="primary" icon={<Plus className="size-4" aria-hidden />}>
      New workspace
    </LinkButton>
  );

  return (
    <PageBody>
      <PageHeader
        title="Workspaces"
        description="A workspace is one thing you want watched: your sentence, the script an agent wrote to read pages about it, and what it has found so far."
        actions={newButton}
      />
      <StaleBanner error={data ? error : null} />
      <Card>
        {!data ? (
          error ? (
            <ErrorState error={error} what="workspaces" />
          ) : (
            <ListSkeleton />
          )
        ) : data.length === 0 ? (
          <EmptyState icon={<Telescope aria-hidden />} title="Nothing is being watched yet" action={newButton}>
            Describe what you want to be told about, in one sentence.
          </EmptyState>
        ) : (
          <WorkspacesTable workspaces={data} />
        )}
      </Card>
    </PageBody>
  );
}

function WorkspacesTable({ workspaces }: { workspaces: WorkspaceView[] }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Workspace</Th>
          <Th>Status</Th>
          <Th>Script</Th>
          <Th className="text-right">Pages run</Th>
          <Th className="text-right">Created</Th>
        </tr>
      </thead>
      <tbody>
        {workspaces.map((workspace) => (
          <Tr key={workspace.id} className="relative transition-colors hover:bg-surface-2/70">
            <Td className="max-w-md">
              <Link href={`/workspaces/${workspace.id}`} className="font-medium text-ink after:absolute after:inset-0">
                {workspace.name}
              </Link>
              <p className="mt-0.5 truncate font-mono text-xs text-ink-3">{workspace.id}</p>
            </Td>
            <Td>
              <WorkspaceStatusBadge status={workspace.status} />
            </Td>
            <Td>{workspace.scriptStatus ? <ScriptStatusBadge status={workspace.scriptStatus} /> : <span className="text-ink-3">—</span>}</Td>
            <Td className="text-right tabular-nums">{workspace.pagesSeen}</Td>
            <Td className="text-right whitespace-nowrap text-ink-2">
              {workspace.createdAt ? <RelativeTime iso={workspace.createdAt} /> : "—"}
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
