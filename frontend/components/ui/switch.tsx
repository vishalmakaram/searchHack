"use client";

import { cn } from "@/lib/cn";

interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** What a screen reader announces. */
  label: string;
  disabled?: boolean;
}

export function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors duration-200",
        "disabled:opacity-50",
        checked ? "border-transparent bg-[var(--green-dot)]" : "border-line-strong bg-surface-2",
      )}
    >
      <span
        className={cn(
          "inline-block size-4.5 rounded-full bg-white shadow-sm transition-transform duration-200",
          checked ? "translate-x-[1.125rem]" : "translate-x-0.5",
          !checked && "border border-line-strong",
        )}
      />
    </button>
  );
}
