"use client";

import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { useId, useState } from "react";
import { createWorkspace, errorMessage } from "@/lib/api";
import { PageBody, PageHeader } from "@/components/shell/page";
import { Notice } from "@/components/status/notice";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/field";

const EXAMPLES = [
  "Tell me about IBM events that could move its stock price",
  "Alert me when a competitor changes the price of their Pro plan",
  "Watch for new EU rules on AI model evaluation",
  "Tell me when a new critical vulnerability is disclosed in OpenSSL",
];

const MAX_LENGTH = 500;

export function NewWorkspace() {
  const router = useRouter();
  const [intent, setIntent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const hintId = useId();
  const trimmed = intent.trim();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const workspace = await createWorkspace({ intent: trimmed });
      // This page stays mounted while hidden, so clear it for the next visit.
      setIntent("");
      setBusy(false);
      router.push(`/workspaces/${workspace.id}`);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  };

  return (
    <PageBody>
      <PageHeader
        back={{ href: "/workspaces", label: "Workspaces" }}
        title="New workspace"
        description="Say what you want watched, in one sentence. The compiler proposes search queries for you to review before anything runs."
      />
      <Card className="max-w-3xl">
        <form onSubmit={submit} className="flex flex-col gap-4 p-5">
          <label htmlFor={inputId} className="text-[15px] font-semibold tracking-tight">
            What should Sentinel watch for?
          </label>
          <Textarea
            id={inputId}
            value={intent}
            onChange={(event) => setIntent(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit(event);
            }}
            rows={4}
            maxLength={MAX_LENGTH}
            placeholder="I want to be told about…"
            aria-describedby={hintId}
            className="resize-y text-base"
            autoFocus
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p id={hintId} className="text-xs text-ink-3">
              {intent.length}/{MAX_LENGTH} characters. Press Ctrl or ⌘ + Enter to submit.
            </p>
            <Button
              type="submit"
              variant="primary"
              loading={busy}
              disabled={!trimmed}
              className="ml-auto"
            >
              Propose queries
              {busy ? null : <ArrowRight className="size-4" aria-hidden />}
            </Button>
          </div>
          {error ? <Notice tone="red">{error}</Notice> : null}
        </form>
        <div className="border-t border-line px-5 py-4">
          <p className="mb-2.5 text-xs font-medium text-ink-3">Or start from an example</p>
          <ul className="flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <li key={example}>
                <button
                  type="button"
                  onClick={() => setIntent(example)}
                  className="rounded-full border border-line-strong px-3 py-1 text-left text-[13px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
                >
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </Card>
    </PageBody>
  );
}
