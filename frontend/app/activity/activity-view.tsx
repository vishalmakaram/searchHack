"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ListX } from "lucide-react";
import { useCallback } from "react";
import { listRuns, listScripts } from "@/lib/api";
import type { RunStatus } from "@/lib/types";
import { usePoll } from "@/lib/use-poll";
import { RunList } from "@/components/runs/run-list";
import { PageBody, PageHeader } from "@/components/shell/page";
import { RUN_STATUS, SCRIPT_STATUS } from "@/components/status/tones";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { ListSkeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, StaleBanner } from "@/components/ui/states";

const STATUSES = Object.keys(RUN_STATUS) as RunStatus[];
const LIMIT = 100;

const fetchScripts = () => listScripts();

export function ActivityView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const scriptId = params.get("scriptId") ?? "";
  const requestedStatus = params.get("status");
  const status = STATUSES.find((item) => item === requestedStatus) ?? "";

  const fetchRuns = useCallback(
    () => listRuns({ scriptId: scriptId || undefined, status: status || undefined, limit: LIMIT }),
    [scriptId, status],
  );
  const runs = usePoll(fetchRuns);
  // Only feeds the script picker, so it can refresh slowly.
  const scripts = usePoll(fetchScripts, 10_000);

  const setFilter = (key: "scriptId" | "status", value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    const text = next.toString();
    router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
  };

  const filtered = scriptId !== "" || status !== "";
  const knownScript = scripts.data?.some((script) => script.id === scriptId);

  return (
    <PageBody>
      <PageHeader title="Activity" description="Every run, newest first. A run is one event being processed by one script." />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-48 flex-col gap-1.5 text-[13px] font-medium text-ink">
          Script
          <Select value={scriptId} onChange={(event) => setFilter("scriptId", event.target.value)}>
            <option value="">All scripts</option>
            {scripts.data?.map((script) => (
              <option key={script.id} value={script.id}>
                {script.name} ({SCRIPT_STATUS[script.status].label.toLowerCase()})
              </option>
            ))}
            {scriptId && scripts.data && !knownScript ? <option value={scriptId}>Unknown script</option> : null}
          </Select>
        </label>
        <label className="flex min-w-40 flex-col gap-1.5 text-[13px] font-medium text-ink">
          Status
          <Select value={status} onChange={(event) => setFilter("status", event.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((item) => (
              <option key={item} value={item}>
                {RUN_STATUS[item].label}
              </option>
            ))}
          </Select>
        </label>
        {filtered ? (
          <Button variant="ghost" onClick={() => router.replace(pathname, { scroll: false })}>
            Clear filters
          </Button>
        ) : null}
      </div>

      <StaleBanner error={runs.data ? runs.error : null} />

      <Card>
        {!runs.data ? (
          runs.error ? (
            <ErrorState error={runs.error} what="runs" />
          ) : (
            <ListSkeleton rows={6} />
          )
        ) : runs.data.length === 0 ? (
          <EmptyState icon={<ListX aria-hidden />} title={filtered ? "No runs match these filters" : "No runs yet"}>
            {filtered
              ? "Try another script or status."
              : "A run starts when a webhook receives an event and routes it to an active script."}
          </EmptyState>
        ) : (
          <>
            <RunList runs={runs.data} />
            {runs.data.length >= LIMIT ? (
              <p className="border-t border-line px-5 py-3 text-xs text-ink-3">Showing the newest {LIMIT} runs.</p>
            ) : null}
          </>
        )}
      </Card>
    </PageBody>
  );
}
