"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowRight, Check, LoaderCircle, Pencil, Plus, Trash2, X } from "lucide-react";
import { useCallback, useId, useState } from "react";
import {
  approveWorkspace,
  deleteWorkspace,
  errorMessage,
  getScript,
  getWorkspace,
  isNotFound,
  updateWorkspace,
} from "@/lib/api";
import type { Frequency, ScriptView, WorkspaceView } from "@/lib/types";
import { cn } from "@/lib/cn";
import { formatDateTime, frequencyLabel, plural } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { usePoll } from "@/lib/use-poll";
import { PageBody, PageHeader } from "@/components/shell/page";
import { ScriptActivityBadge, ScriptStatusBadge, WorkspaceStatusBadge } from "@/components/status/badges";
import { Notice } from "@/components/status/notice";
import { Button, IconButton, LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { RenameDialog } from "@/components/ui/rename-dialog";
import { SchemaTable } from "@/components/ui/schema-table";
import { PageSkeleton } from "@/components/ui/skeleton";
import { ErrorState, NotFoundState, StaleBanner } from "@/components/ui/states";

const BACK = { href: "/workspaces", label: "Workspaces" };
const FREQUENCIES: Frequency[] = ["1h", "6h", "12h", "1d", "7d"];

export function WorkspaceDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const fetcher = useCallback(async () => {
    const workspace = await getWorkspace(id);
    // The script is a convenience here; the page still works if it can't be read.
    const script = workspace.scriptId ? await getScript(workspace.scriptId).catch(() => null) : null;
    return { workspace, script };
  }, [id]);
  const { data, error, refresh } = usePoll(fetcher);

  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (isNotFound(error)) {
    return (
      <PageBody>
        <PageHeader title="Workspace" back={BACK} />
        <NotFoundState what="workspace" backHref="/workspaces" backLabel="Back to workspaces" />
      </PageBody>
    );
  }
  if (!data) {
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

  const { workspace, script } = data;

  return (
    <PageBody>
      <PageHeader
        back={BACK}
        title={
          <span className="inline-flex items-center gap-1.5">
            {workspace.name}
            <IconButton label="Rename workspace" onClick={() => setRenaming(true)}>
              <Pencil className="size-4" aria-hidden />
            </IconButton>
          </span>
        }
        badges={<WorkspaceStatusBadge status={workspace.status} />}
        actions={
          <Button icon={<Trash2 className="size-4" aria-hidden />} onClick={() => setDeleting(true)}>
            Delete
          </Button>
        }
      />
      <StaleBanner error={error} />

      <figure className="rounded-xl border border-line bg-surface px-5 py-4 shadow-card">
        <figcaption className="text-xs text-ink-3">You asked Sentinel to watch for</figcaption>
        <blockquote className="mt-1 text-[17px] leading-snug font-medium tracking-tight text-ink">
          &ldquo;{workspace.intent}&rdquo;
        </blockquote>
      </figure>

      {workspace.status === "compiling" ? <CompilingPanel workspace={workspace} /> : null}
      {workspace.status === "awaiting_approval" ? (
        // Keyed by id so the draft belongs to this workspace and polls never overwrite it.
        <ApprovalForm key={workspace.id} workspace={workspace} onApproved={refresh} />
      ) : null}
      {workspace.status === "ready" ? <ReadyPanel workspace={workspace} script={script} /> : null}

      <RenameDialog
        open={renaming}
        onClose={() => setRenaming(false)}
        title="Rename workspace"
        initial={workspace.name}
        onSave={async (name) => {
          await updateWorkspace(workspace.id, { name });
          await refresh();
        }}
      />
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title={`Delete ${workspace.name}?`}
        description={
          workspace.scriptId
            ? "Its script and all of that script's runs are deleted too, and the script is removed from every webhook's routing. Deliveries already logged on webhooks stay. This can't be undone."
            : "The workspace and its proposed queries are deleted. This can't be undone."
        }
        confirmLabel="Delete workspace"
        danger
        onConfirm={async () => {
          await deleteWorkspace(workspace.id);
          router.push("/workspaces");
        }}
      />
    </PageBody>
  );
}

// ----------------------------------------------------------------- Compiling

const COMPILE_STEPS = ["Reading your sentence", "Proposing search queries", "Drafting the script and its output schema"];

function CompilingPanel({ workspace }: { workspace: WorkspaceView }) {
  const now = useNow();
  const started = Date.parse(workspace.createdAt);
  const total = Math.max(1000, Date.parse(workspace.compileReadyAt) - started);
  const elapsed = now === 0 ? 0 : Math.min(total, Math.max(0, now - started));
  const current = Math.min(COMPILE_STEPS.length - 1, Math.floor((elapsed / total) * COMPILE_STEPS.length));

  return (
    <Card aria-live="polite">
      <CardHeader title="Compiling" description="This takes a few seconds. The page updates by itself when the queries are ready." />
      <CardBody className="flex flex-col gap-4">
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="Compiling" aria-valuetext={COMPILE_STEPS[current]}>
          {now === 0 ? null : (
            <div
              className="h-full origin-left rounded-full bg-[var(--blue-dot)]"
              style={{ animation: `grow ${total}ms linear both`, animationDelay: `-${elapsed}ms` }}
            />
          )}
        </div>
        <ol className="flex flex-col gap-2">
          {COMPILE_STEPS.map((step, index) => (
            <li key={step} className={cn("flex items-center gap-2.5 text-sm", index > current ? "text-ink-3" : "text-ink")}>
              <span className="flex size-4 items-center justify-center" aria-hidden>
                {index < current ? (
                  <Check className="size-4 text-[var(--green-fg)]" />
                ) : index === current ? (
                  <LoaderCircle className="size-4 animate-spin text-[var(--blue-fg)]" />
                ) : (
                  <span className="size-1.5 rounded-full bg-line-strong" />
                )}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}

// ------------------------------------------------------------------ Approval

interface DraftQuery {
  key: string;
  text: string;
}

function ApprovalForm({ workspace, onApproved }: { workspace: WorkspaceView; onApproved: () => Promise<void> }) {
  const [queries, setQueries] = useState<DraftQuery[]>(() =>
    workspace.queries.map((query) => ({ key: query.id, text: query.text })),
  );
  const [frequency, setFrequency] = useState<Frequency>(workspace.frequency);
  const [added, setAdded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleaned = queries.map((query) => query.text.trim()).filter(Boolean);

  const addQuery = () => {
    const key = `new_${crypto.randomUUID()}`;
    setQueries((list) => [...list, { key, text: "" }]);
    setAdded(key);
  };

  const approve = async () => {
    if (cleaned.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      if (frequency !== workspace.frequency) await updateWorkspace(workspace.id, { frequency });
      await approveWorkspace(workspace.id, { queries: cleaned });
      await onApproved();
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  };

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card>
        <CardHeader
          title="Review the proposed queries"
          description="These are the searches Telem will run for you. Edit, remove or add until they say what you mean."
        />
        <CardBody className="flex flex-col gap-5">
          <fieldset disabled={busy} className="flex min-w-0 flex-col gap-2">
            <legend className="sr-only">Search queries</legend>
            <ol className="flex flex-col gap-2">
              {queries.map((query, index) => (
                <li key={query.key} className="flex animate-enter items-center gap-2">
                  <span className="w-5 shrink-0 text-right text-xs text-ink-3 tabular-nums" aria-hidden>
                    {index + 1}
                  </span>
                  <Input
                    value={query.text}
                    onChange={(event) =>
                      setQueries((list) =>
                        list.map((item) => (item.key === query.key ? { ...item, text: event.target.value } : item)),
                      )
                    }
                    aria-label={`Query ${index + 1}`}
                    placeholder="A search query"
                    maxLength={200}
                    autoFocus={query.key === added}
                  />
                  <IconButton
                    label={`Remove query ${index + 1}`}
                    onClick={() => setQueries((list) => list.filter((item) => item.key !== query.key))}
                  >
                    <X className="size-4" aria-hidden />
                  </IconButton>
                </li>
              ))}
            </ol>
            {queries.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line-strong px-3.5 py-3 text-[13px] text-ink-3">
                No queries. Add at least one to approve.
              </p>
            ) : null}
            <div className="pl-7">
              <Button size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={addQuery} disabled={queries.length >= 10}>
                Add query
              </Button>
            </div>
          </fieldset>

          <FrequencyPicker value={frequency} onChange={setFrequency} disabled={busy} />

          {error ? <Notice tone="red">{error}</Notice> : null}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <p className="max-w-md text-[13px] text-ink-3">
              Approving compiles the processing script. Queries and frequency can&rsquo;t be changed afterwards.
            </p>
            <Button variant="primary" onClick={approve} loading={busy} disabled={cleaned.length === 0}>
              Approve {plural(cleaned.length, "query", "queries")}
            </Button>
          </div>
        </CardBody>
      </Card>

      <SchemaCard workspace={workspace} />
    </div>
  );
}

function FrequencyPicker({
  value,
  onChange,
  disabled,
}: {
  value: Frequency;
  onChange: (next: Frequency) => void;
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 text-[13px] font-medium text-ink">How often to check</legend>
      <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl border border-line bg-surface-2 p-1">
        {FREQUENCIES.map((frequency) => (
          <label
            key={frequency}
            className={cn(
              "cursor-pointer rounded-lg px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors",
              "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
              value === frequency ? "bg-surface text-ink shadow-card" : "text-ink-2 hover:text-ink",
            )}
          >
            <input
              type="radio"
              name={name}
              value={frequency}
              checked={value === frequency}
              onChange={() => onChange(frequency)}
              className="sr-only"
            />
            {frequencyLabel(frequency)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function SchemaCard({ workspace }: { workspace: WorkspaceView }) {
  return (
    <Card>
      <CardHeader title="Output schema" description="What the script will extract from each page. Set by the compiler." />
      <CardBody className="flex flex-col gap-4">
        <SchemaTable schema={workspace.extractionSchema} />
        <div>
          <p className="mb-1.5 text-xs text-ink-3">Search engines used when something changes</p>
          <ul className="flex flex-wrap gap-1.5">
            {workspace.escalationProviders.map((provider) => (
              <li key={provider} className="rounded-md border border-line-strong px-2 py-0.5 font-mono text-xs text-ink-2">
                {provider}
              </li>
            ))}
          </ul>
        </div>
      </CardBody>
    </Card>
  );
}

// --------------------------------------------------------------------- Ready

function ReadyPanel({ workspace, script }: { workspace: WorkspaceView; script: ScriptView | null }) {
  return (
    <>
      {script?.status === "developed" ? (
        <Notice title="Next step: deploy the script">
          The script for this workspace is compiled but has never been deployed, so nothing is being processed yet.{" "}
          <Link href={`/scripts/${script.id}`} className="font-medium text-ink underline underline-offset-4">
            Open the script to deploy it
          </Link>
          .
        </Notice>
      ) : null}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Script" description="Compiled from this workspace when its queries were approved." />
            <CardBody>
              {script ? (
                <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-lg border border-line px-3.5 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <span className="text-sm font-medium text-ink">{script.name}</span>
                      <span className="font-mono text-xs text-ink-3">v{script.version}</span>
                      <ScriptStatusBadge status={script.status} />
                    </div>
                    <div className="mt-1.5">
                      <ScriptActivityBadge activity={script.activity} />
                    </div>
                  </div>
                  <LinkButton href={`/scripts/${script.id}`} size="sm">
                    Open script
                    <ArrowRight className="size-4" aria-hidden />
                  </LinkButton>
                </div>
              ) : (
                <p className="text-[13px] text-ink-3">The script for this workspace couldn&rsquo;t be loaded.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Queries"
              description={`${frequencyLabel(workspace.frequency)}. Approved ${workspace.approvedAt ? formatDateTime(workspace.approvedAt) : ""}.`}
            />
            <CardBody>
              <ol className="divide-y divide-line rounded-lg border border-line">
                {workspace.queries.map((query, index) => (
                  <li key={query.id} className="flex items-baseline gap-3 px-3.5 py-2.5 text-sm">
                    <span className="w-4 shrink-0 text-right text-xs text-ink-3 tabular-nums" aria-hidden>
                      {index + 1}
                    </span>
                    <span className="min-w-0 break-words text-ink">{query.text}</span>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </div>

        <SchemaCard workspace={workspace} />
      </div>
    </>
  );
}
