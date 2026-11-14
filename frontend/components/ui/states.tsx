import { CircleAlert, SearchX, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  /** Less padding, for an empty list inside a card that has other content. */
  compact?: boolean;
}

export function EmptyState({ icon, title, children, action, compact }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center px-6 text-center", compact ? "py-8" : "py-14")}>
      {icon ? (
        <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-surface-2 text-ink-3 [&>svg]:size-5">
          {icon}
        </div>
      ) : null}
      <p className="text-sm font-medium text-ink">{title}</p>
      {children ? <p className="mt-1 max-w-sm text-[13px] text-ink-3">{children}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** Shown instead of content when the first load failed and there is nothing to show. */
export function ErrorState({ error, what }: { error: unknown; what: string }) {
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-surface-2 text-[var(--red-fg)]">
        <CircleAlert className="size-5" aria-hidden />
      </div>
      <p className="text-sm font-medium text-ink">Couldn&rsquo;t load {what}</p>
      <p className="mt-1 max-w-sm text-[13px] text-ink-3">{errorMessage(error)} Trying again every few seconds.</p>
    </div>
  );
}

/** Shown above content that is still on screen when a later refresh fails. */
export function StaleBanner({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div
      role="status"
      data-tone="amber"
      className="flex animate-enter items-center gap-2 rounded-lg border border-tone-line bg-tone-bg px-3 py-2 text-[13px] text-tone-fg"
    >
      <WifiOff className="size-4 shrink-0" aria-hidden />
      <span>Live updates paused: {errorMessage(error)} Showing the last data received.</span>
    </div>
  );
}

/** A detail page whose id does not exist (or no longer exists). */
export function NotFoundState({ what, backHref, backLabel }: { what: string; backHref: string; backLabel: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface">
      <EmptyState
        icon={<SearchX aria-hidden />}
        title={`This ${what} doesn't exist`}
        action={
          <a href={backHref} className="text-sm font-medium text-ink underline underline-offset-4">
            {backLabel}
          </a>
        }
      >
        It may have been deleted, or the demo data was reset.
      </EmptyState>
    </div>
  );
}
