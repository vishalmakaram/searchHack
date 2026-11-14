"use client";

import { useParams, useRouter } from "next/navigation";
import { Inbox, Send, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import {
  deleteWebhook,
  errorMessage,
  getWebhook,
  isNotFound,
  listDeliveries,
  listScripts,
  sendTestEvent,
  updateWebhook,
} from "@/lib/api";
import type { Delivery, ScriptView, WebhookView } from "@/lib/types";
import { plural } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";
import { DeliveryList } from "@/components/deliveries/delivery-list";
import { PageBody, PageHeader } from "@/components/shell/page";
import { EnabledBadge } from "@/components/status/badges";
import { Notice } from "@/components/status/notice";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
import { CopyButton } from "@/components/ui/copy-button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { PageSkeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, NotFoundState, StaleBanner } from "@/components/ui/states";
import { Switch } from "@/components/ui/switch";
import { ScriptPicker } from "@/components/webhooks/script-picker";

const BACK = { href: "/webhooks", label: "Webhooks" };

export function WebhookDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const fetcher = useCallback(async () => {
    const webhook = await getWebhook(id);
    const [deliveries, scripts] = await Promise.all([listDeliveries(id, 50), listScripts()]);
    return { webhook, deliveries, scripts };
  }, [id]);
  const { data, error, refresh } = usePoll(fetcher);

  const [deleting, setDeleting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ delivery: Delivery } | { error: string } | null>(null);

  const scriptNames = useMemo(() => new Map(data?.scripts.map((script) => [script.id, script.name])), [data?.scripts]);

  if (isNotFound(error)) {
    return (
      <PageBody>
        <PageHeader title="Webhook" back={BACK} />
        <NotFoundState what="webhook" backHref="/webhooks" backLabel="Back to webhooks" />
      </PageBody>
    );
  }
  if (!data) {
    return error ? (
      <PageBody>
        <PageHeader title="Webhook" back={BACK} />
        <Card>
          <ErrorState error={error} what="this webhook" />
        </Card>
      </PageBody>
    ) : (
      <PageSkeleton />
    );
  }

  const { webhook, deliveries, scripts } = data;

  const sendTest = async () => {
    // The test event names one page; the routed scripts run on it for real.
    const url = window.prompt("Which page should the test event name?", "https://example.com/");
    if (url === null || url.trim() === "") return;
    setTesting(true);
    setTestResult(null);
    try {
      const delivery = await sendTestEvent(webhook.id, url.trim());
      setTestResult({ delivery });
      await refresh();
    } catch (caught) {
      setTestResult({ error: errorMessage(caught) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <PageBody>
      <PageHeader
        back={BACK}
        title={webhook.name}
        badges={<EnabledBadge enabled={webhook.enabled} />}
        actions={
          <>
            <Button icon={<Trash2 className="size-4" aria-hidden />} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button
              variant="primary"
              icon={<Send className="size-4" aria-hidden />}
              onClick={sendTest}
              loading={testing}
              disabled={!webhook.enabled}
              title={webhook.enabled ? undefined : "Enable the webhook to send a test event"}
            >
              Send test event
            </Button>
          </>
        }
      />
      <StaleBanner error={error} />
      <TestResult result={testResult} />

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <EndpointCard webhook={webhook} onChanged={refresh} />
        {/* Keyed by the saved routing, so the editor starts over from it after a save. */}
        <RoutingCard key={webhook.scriptIds.join(",")} webhook={webhook} scripts={scripts} onSaved={refresh} />
      </div>

      <Card>
        <CardHeader title="Deliveries" description="Every request this webhook has received, newest first." />
        <div className="border-t border-line">
          {deliveries.length > 0 ? (
            <DeliveryList deliveries={deliveries} scriptNames={scriptNames} />
          ) : (
            <EmptyState compact icon={<Inbox aria-hidden />} title="Nothing received yet">
              Send a test event, or post to the URL above with curl.
            </EmptyState>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title={`Delete ${webhook.name}?`}
        description="Its address stops working straight away and its delivery log is deleted. Runs it already produced stay in Activity."
        confirmLabel="Delete webhook"
        danger
        onConfirm={async () => {
          await deleteWebhook(webhook.id);
          router.push("/webhooks");
        }}
      />
    </PageBody>
  );
}

function TestResult({ result }: { result: { delivery: Delivery } | { error: string } | null }) {
  if (!result) return null;
  if ("error" in result) {
    return (
      <Notice tone="red" title="The test event was not sent" className="animate-enter">
        {result.error}
      </Notice>
    );
  }
  const { delivery } = result;
  const skipped = delivery.skipped.length;
  const runs = delivery.runIds.length;
  return (
    <Notice
      tone={skipped > 0 || runs === 0 ? "amber" : "green"}
      title="Test event received"
      className="animate-enter"
    >
      {plural(delivery.eventCount, "event")} arrived and started {plural(runs, "run")}.
      {skipped > 0 ? ` ${skipped} skipped because the target script is not active.` : ""}
      {runs === 0 && skipped === 0 ? " This webhook has no target scripts, so nothing ran." : ""} Open the delivery below
      for details.
    </Notice>
  );
}

function EndpointCard({ webhook, onChanged }: { webhook: WebhookView; onChanged: () => Promise<void> }) {
  const [secretDraft, setSecretDraft] = useState("");
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setEnabled = async (enabled: boolean) => {
    setToggling(true);
    setError(null);
    try {
      await updateWebhook(webhook.id, { enabled });
      await onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setToggling(false);
    }
  };

  const saveSecret = async (secret: string | null) => {
    setToggling(true);
    setError(null);
    try {
      await updateWebhook(webhook.id, { secret });
      setSecretDraft("");
      await onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setToggling(false);
    }
  };

  const local = /\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/)/.test(webhook.url);
  const curl = [
    `curl -X POST '${webhook.url}' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -H 'Telem-Webhook-Type: agent.changes' \\`,
    `  -d '{"type":"agent.changes","monitor_id":"mon_demo","changes":[{"seq":9001,"kind":"entity_added","url":"https://example.com/news/1"}],"next_cursor":9002,"watermark":9001}'`,
  ].join("\n");

  return (
    <Card>
      <CardHeader title="Endpoint" description="Give this address and secret to Telem as the monitor's webhook." />
      <CardBody className="flex flex-col gap-4">
        <div>
          <p className="mb-1.5 text-xs text-ink-3">URL</p>
          <div className="flex items-center gap-1 rounded-lg border border-line bg-surface-2 py-0.5 pr-1 pl-3">
            <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink" title={webhook.url}>
              {webhook.url}
            </span>
            <CopyButton value={webhook.url} what="URL" />
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs text-ink-3">Signing secret</p>
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (secretDraft.trim() !== "") void saveSecret(secretDraft.trim());
            }}
          >
            <Input
              type="password"
              autoComplete="off"
              value={secretDraft}
              onChange={(event) => setSecretDraft(event.target.value)}
              placeholder={webhook.secretSet ? "Saved. Paste a new one to replace it" : "Paste the secret Telem issued"}
              aria-label="Signing secret"
              className="min-w-0 flex-1"
            />
            <Button type="submit" disabled={toggling || secretDraft.trim() === ""}>
              Save
            </Button>
            {webhook.secretSet ? (
              <Button type="button" disabled={toggling} onClick={() => void saveSecret(null)}>
                Remove
              </Button>
            ) : null}
          </form>
          <p className="mt-1.5 text-xs text-ink-3">
            {webhook.secretSet
              ? "Deliveries with a Telem-Signature header are checked against it and marked Valid or Invalid."
              : "No secret saved, so signatures are not checked and deliveries are marked “Not checked”."}
          </p>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-lg border border-line px-3.5 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">Accept deliveries</p>
            <p className="text-xs text-ink-3">
              {webhook.enabled ? "Requests to the URL are received and routed." : "Requests to the URL are refused with 403."}
            </p>
          </div>
          <Switch checked={webhook.enabled} onChange={setEnabled} disabled={toggling} label="Accept deliveries" />
        </div>
        {error ? <Notice tone="red">{error}</Notice> : null}

        {local ? (
          <Notice tone="grey" title="Only reachable from this machine">
            To let Telem reach it, start a tunnel (for example <span className="font-mono text-xs">cloudflared tunnel --url http://localhost:3000</span>)
            and put its address in <span className="font-mono text-xs">PUBLIC_BASE_URL</span> in{" "}
            <span className="font-mono text-xs">.env.local</span>.
          </Notice>
        ) : null}

        <div>
          <p className="mb-1.5 text-xs text-ink-3">Try it from a terminal</p>
          <CodeBlock code={curl} label="curl" what="curl command" maxHeight="12rem" />
        </div>
      </CardBody>
    </Card>
  );
}

function RoutingCard({
  webhook,
  scripts,
  onSaved,
}: {
  webhook: WebhookView;
  scripts: ScriptView[];
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(webhook.scriptIds);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = draft.length !== webhook.scriptIds.length || draft.some((scriptId) => !webhook.scriptIds.includes(scriptId));
  const inactiveTargets = scripts.filter((script) => draft.includes(script.id) && script.status !== "active").length;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateWebhook(webhook.id, { scriptIds: draft });
      await onSaved();
    } catch (caught) {
      setError(errorMessage(caught));
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Routing"
        description="Every event this webhook receives is sent to each script ticked here."
      />
      <CardBody className="flex flex-col gap-4">
        <ScriptPicker scripts={scripts} selected={draft} onChange={setDraft} label="Scripts this webhook feeds" disabled={saving} />

        {draft.length === 0 && scripts.length > 0 ? (
          <p className="text-[13px] text-ink-3">No script is ticked, so deliveries are logged but nothing runs.</p>
        ) : null}
        {inactiveTargets > 0 ? (
          <Notice tone="amber" title={`${plural(inactiveTargets, "target")} not active`}>
            Events routed to a script that is not active are skipped, and the delivery log says why. Deploy or reactivate
            the script to process them.
          </Notice>
        ) : null}
        {error ? <Notice tone="red">{error}</Notice> : null}

        {dirty ? (
          <div className="flex animate-enter flex-wrap items-center justify-end gap-2">
            <span className="mr-auto text-[13px] text-ink-3">Unsaved changes</span>
            <Button onClick={() => setDraft(webhook.scriptIds)} disabled={saving}>
              Discard
            </Button>
            <Button variant="primary" onClick={save} loading={saving}>
              Save routing
            </Button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
