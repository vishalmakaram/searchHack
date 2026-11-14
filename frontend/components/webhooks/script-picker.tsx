"use client";

import type { ScriptView } from "@/lib/types";
import { cn } from "@/lib/cn";
import { ScriptStatusBadge } from "@/components/status/badges";

interface ScriptPickerProps {
  scripts: ScriptView[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Names the group for screen readers. */
  label: string;
  disabled?: boolean;
}

/**
 * Choose which scripts a webhook feeds. Each script shows its status, and a
 * chosen script that is not active says its events will be skipped.
 */
export function ScriptPicker({ scripts, selected, onChange, label, disabled }: ScriptPickerProps) {
  if (scripts.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line-strong px-3.5 py-3 text-[13px] text-ink-3">
        There are no scripts yet. Approve a workspace&rsquo;s queries to compile one, then come back to route it.
      </p>
    );
  }

  const toggle = (scriptId: string) =>
    onChange(selected.includes(scriptId) ? selected.filter((item) => item !== scriptId) : [...selected, scriptId]);

  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="sr-only">{label}</legend>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {scripts.map((script) => {
          const checked = selected.includes(script.id);
          return (
            <li key={script.id}>
              <label
                className={cn(
                  "flex cursor-pointer items-start gap-3 px-3.5 py-2.5 transition-colors hover:bg-surface-2/70",
                  checked && "bg-surface-2/50",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(script.id)}
                  className="mt-0.5 size-4 shrink-0 accent-[var(--ink)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span className="text-sm font-medium text-ink">{script.name}</span>
                    <ScriptStatusBadge status={script.status} />
                  </span>
                  <span className="mt-0.5 block font-mono text-xs text-ink-3">{script.id}</span>
                  {checked && script.status !== "active" ? (
                    <span data-tone="amber" className="mt-1 block text-xs font-medium text-tone-fg">
                      Not active: events routed here are skipped until it is{" "}
                      {script.status === "developed" ? "deployed" : "reactivated"}.
                    </span>
                  ) : null}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
