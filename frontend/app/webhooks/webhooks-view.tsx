"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Webhook } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { createWebhook, errorMessage, listScripts, listWebhooks } from "@/lib/api";
import type { ScriptView, WebhookView } from "@/lib/types";
import { usePoll } from "@/lib/use-poll";
import { PageBody, PageHeader } from "@/components/shell/page";
import { EnabledBadge } from "@/components/status/badges";
import { Notice } from "@/components/status/notice";
import { StatusPill } from "@/components/status/status-pill";
import { SCRIPT_STATUS } from "@/components/status/tones";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { RelativeTime } from "@/components/ui/relative-time";
import { ListSkeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, StaleBanner } from "@/components/ui/states";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { ScriptPicker } from "@/components/webhooks/script-picker";

async function fetchWebhooks() {
  const [webhooks, scripts] = await Promise.all([listWebhooks(), listScripts()]);
  return { webhooks, scripts };
}

export function WebhooksView() {
  const { data, error } = usePoll(fetchWebhooks);
  const [creating, setCreating] = useState(false);

  const newButton = (
    <Button variant="primary" icon={<Plus className="size-4" aria-hidden />} onClick={() => setCreating(true)} disabled={!data}>
      New webhook
    </Button>
  );

  return (
    <PageBody>
      <PageHeader
        title="Webhooks"
        description="A webhook is an address Telem posts new results to. Each one routes its events to the scripts you choose."
        actions={newButton}
      />
      <StaleBanner error={data ? error : null} />
      <Card>
        {!data ? (
          error ? (
            <ErrorState error={error} what="webhooks" />
          ) : (
            <ListSkeleton />
          )
        ) : data.webhooks.length === 0 ? (
          <EmptyState icon={<Webhook aria-hidden />} title="No webhooks yet" action={newButton}>
            Create one to get an address you can give to Telem, or post to with curl.
          </EmptyState>
        ) : (
          <WebhooksTable webhooks={data.webhooks} scripts={data.scripts} />
        )}
      </Card>
      {creating && data ? <NewWebhookDialog scripts={data.scripts} onClose={() => setCreating(false)} /> : null}
    </PageBody>
  );
}

function WebhooksTable({ webhooks, scripts }: { webhooks: WebhookView[]; scripts: ScriptView[] }) {
  const byId = useMemo(() => new Map(scripts.map((script) => [script.id, script])), [scripts]);
  return (
    <Table>
      <thead>
        <tr>
          <Th>Webhook</Th>
          <Th>State</Th>
          <Th>Routes to</Th>
          <Th className="text-right">Deliveries</Th>
          <Th className="text-right">Last received</Th>
        </tr>
      </thead>
      <tbody>
        {webhooks.map((webhook) => (
          <Tr key={webhook.id} className="relative transition-colors hover:bg-surface-2/70">
            <Td>
              <Link href={`/webhooks/${webhook.id}`} className="font-medium text-ink after:absolute after:inset-0">
                {webhook.name}
              </Link>
            </Td>
            <Td>
              <EnabledBadge enabled={webhook.enabled} />
            </Td>
            <Td>
              {webhook.scriptIds.length === 0 ? (
                <span className="text-ink-3">No scripts</span>
              ) : (
                <ul className="flex flex-col gap-1">
                  {webhook.scriptIds.map((scriptId) => {
                    const script = byId.get(scriptId);
                    return (
                      <li key={scriptId} className="flex flex-wrap items-center gap-x-2.5">
                        <span className="text-ink">{script?.name ?? "Deleted script"}</span>
                        {script ? (
                          <StatusPill variant="plain" tone={SCRIPT_STATUS[script.status].tone} label={SCRIPT_STATUS[script.status].label} />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Td>
            <Td className="text-right tabular-nums">{webhook.deliveryCount}</Td>
            <Td className="text-right whitespace-nowrap text-ink-2">
              <RelativeTime iso={webhook.lastDeliveryAt} />
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

function NewWebhookDialog({ scripts, onClose }: { scripts: ScriptView[]; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [scriptIds, setScriptIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();
  const nameId = useId();
  const trimmed = name.trim();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const webhook = await createWebhook({ name: trimmed, scriptIds });
      onClose();
      router.push(`/webhooks/${webhook.id}`);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={busy ? () => {} : onClose}
      title="New webhook"
      description="You get the address and its secret on the next screen."
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={busy} disabled={!trimmed}>
            Create webhook
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Name" htmlFor={nameId}>
          <Input
            id={nameId}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="IBM monitor"
            maxLength={80}
            autoFocus
          />
        </Field>
        <div className="flex flex-col gap-1.5">
          <p className="text-[13px] font-medium text-ink">Route events to</p>
          <div className="max-h-64 overflow-y-auto">
            <ScriptPicker scripts={scripts} selected={scriptIds} onChange={setScriptIds} label="Route events to" disabled={busy} />
          </div>
          <p className="text-xs text-ink-3">Optional. You can change this at any time.</p>
        </div>
        {error ? <Notice tone="red">{error}</Notice> : null}
      </form>
    </Dialog>
  );
}
