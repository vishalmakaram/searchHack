import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { Tone } from "./tones";

interface StatusPillProps {
  tone: Tone;
  label: string;
  /** Replaces the dot. Use for states that are in motion or need a glyph. */
  icon?: ReactNode;
  /** "pill" is a filled badge. "plain" is a dot and text, for secondary states. */
  variant?: "pill" | "plain";
  /** Makes the dot pulse, for something happening right now. */
  live?: boolean;
  className?: string;
}

/**
 * A state shown as a coloured mark plus its name. The name is always there:
 * colour never carries the meaning alone.
 */
export function StatusPill({ tone, label, icon, variant = "pill", live, className }: StatusPillProps) {
  return (
    <span
      data-tone={tone}
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap",
        variant === "pill"
          ? "rounded-full border border-tone-line bg-tone-bg py-0.5 pr-2.5 pl-2 text-tone-fg"
          : "text-ink-2",
        className,
      )}
    >
      {icon ? (
        <span className="flex size-3.5 items-center justify-center text-tone-fg [&>svg]:size-3.5" aria-hidden>
          {icon}
        </span>
      ) : (
        <span className={cn("size-1.5 shrink-0 rounded-full bg-tone-dot", live && "animate-pulse-dot")} aria-hidden />
      )}
      {label}
    </span>
  );
}
