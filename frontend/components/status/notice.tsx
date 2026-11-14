import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { Tone } from "./tones";

const ICONS: Partial<Record<Tone, ReactNode>> = {
  amber: <TriangleAlert className="size-4" aria-hidden />,
  red: <CircleAlert className="size-4" aria-hidden />,
};

interface NoticeProps {
  tone?: Tone;
  title?: string;
  children: ReactNode;
  className?: string;
}

/** An inline message: a note (blue or grey), a warning (amber) or an error (red). */
export function Notice({ tone = "blue", title, children, className }: NoticeProps) {
  return (
    <div
      data-tone={tone}
      role={tone === "red" ? "alert" : "note"}
      className={cn(
        "flex gap-2.5 rounded-lg border border-tone-line bg-tone-bg px-3.5 py-2.5 text-[13px] text-ink",
        className,
      )}
    >
      <span className="mt-0.5 shrink-0 text-tone-fg">{ICONS[tone] ?? <Info className="size-4" aria-hidden />}</span>
      <div className="min-w-0">
        {title ? <p className="font-medium text-tone-fg">{title}</p> : null}
        <div className="text-ink-2">{children}</div>
      </div>
    </div>
  );
}
