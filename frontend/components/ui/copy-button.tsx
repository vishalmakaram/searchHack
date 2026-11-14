"use client";

import { Check, Copy } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/cn";

interface CopyButtonProps {
  value: string;
  /** What is being copied, for the accessible name: "Copy URL". */
  what: string;
  className?: string;
}

export function CopyButton({ value, what, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard access can be refused (insecure origin, permissions). Fall
      // back to the legacy command, which works from a user gesture.
      const area = document.createElement("textarea");
      area.value = value;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? `${what} copied` : `Copy ${what}`}
      title={copied ? "Copied" : `Copy ${what}`}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium transition-colors",
        copied ? "text-[var(--green-fg)]" : "text-ink-3 hover:bg-surface-2 hover:text-ink",
        className,
      )}
    >
      {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}
