import { Cpu, Inbox, PackageCheck, Split } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import type { Health, Overview, StageKey } from "@/lib/types";
import { cn } from "@/lib/cn";
import { HealthBadge } from "@/components/status/badges";
import { HEALTH } from "@/components/status/tones";

type Stage = Overview["stages"][number];

const STAGE_ICONS: Record<StageKey, ComponentType<SVGProps<SVGSVGElement>>> = {
  ingest: Inbox,
  dispatch: Split,
  processing: Cpu,
  results: PackageCheck,
};

const STAGE_HINTS: Record<StageKey, string> = {
  ingest: "Webhooks receive deliveries from Telem",
  dispatch: "Events are routed to scripts",
  processing: "Scripts turn pages into results",
  results: "Output is checked against the schema",
};

/** The pipeline as four connected stages, left to right (top to bottom on narrow screens). */
export function Pipeline({ stages }: { stages: Stage[] }) {
  return (
    <ol className="flex flex-col lg:flex-row" aria-label="Pipeline stages">
      {stages.map((stage, index) => {
        const next = stages[index + 1];
        return (
          <li key={stage.key} className="flex min-w-0 flex-1 flex-col lg:flex-row">
            <StageCard stage={stage} />
            {next ? <Connector flowing={stage.health === "busy" || next.health === "busy"} /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function StageCard({ stage }: { stage: Stage }) {
  const Icon = STAGE_ICONS[stage.key] ?? Cpu;
  const needsAttention = stage.health === "attention";
  return (
    <div
      data-tone={HEALTH[stage.health].tone}
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-4 rounded-xl border bg-surface p-4 shadow-card transition-colors duration-300",
        needsAttention ? "border-tone-line" : "border-line",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-2">
            <Icon className="size-4" aria-hidden />
          </span>
          <h3 className="truncate text-[15px] font-semibold tracking-tight">{stage.label}</h3>
        </div>
        <HealthBadge health={stage.health} />
      </div>
      <p className="-mt-2 text-xs text-ink-3">{STAGE_HINTS[stage.key] ?? ""}</p>
      <dl className="mt-auto grid grid-cols-[repeat(auto-fit,minmax(4.5rem,1fr))] gap-x-3 gap-y-3">
        {stage.metrics.map((metric) => (
          <div key={metric.label} className="min-w-0">
            <dd className="text-xl leading-tight font-semibold tracking-tight text-ink">{metric.value}</dd>
            <dt className="mt-0.5 text-xs text-ink-3">{metric.label}</dt>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The link between two stages. Its dashes move while work is passing through. */
function Connector({ flowing }: { flowing: boolean }) {
  const stroke = flowing ? "var(--blue-dot)" : "var(--line-strong)";
  const line = {
    stroke,
    strokeWidth: 1.5,
    strokeDasharray: "3 3",
    strokeLinecap: "round" as const,
    className: flowing ? "animate-flow" : undefined,
  };
  const head = { fill: "none", stroke, strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <div className="flex shrink-0 items-center justify-center" aria-hidden>
      <svg viewBox="0 0 28 12" className="hidden h-3 w-7 lg:block">
        <line x1="1" y1="6" x2="22" y2="6" {...line} />
        <path d="M20 2.5 L24.5 6 L20 9.5" {...head} />
      </svg>
      <svg viewBox="0 0 12 24" className="h-6 w-3 lg:hidden">
        <line x1="6" y1="1" x2="6" y2="18" {...line} />
        <path d="M2.5 16 L6 20.5 L9.5 16" {...head} />
      </svg>
    </div>
  );
}

const HEADLINES: Record<Health, string> = {
  ok: "Everything is flowing. No failures in the last hour.",
  busy: "Work is passing through the pipeline right now.",
  attention: "Something failed in the last hour. See the stages marked below.",
  idle: "Nothing has arrived in the last hour.",
};

export function healthHeadline(health: Health): string {
  return HEADLINES[health];
}
