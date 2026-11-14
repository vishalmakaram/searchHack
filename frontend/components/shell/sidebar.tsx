import Link from "next/link";
import { Suspense } from "react";
import { ActiveNavLinks, NavLinks } from "./nav";
import { ResetButton } from "./reset-button";

function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2.5 rounded-lg" aria-label="Sentinel, go to overview">
      <svg viewBox="0 0 24 24" className="size-6 shrink-0" aria-hidden>
        <rect width="24" height="24" rx="6.5" fill="var(--ink)" />
        <circle cx="12" cy="12" r="6.25" fill="none" stroke="var(--surface)" strokeWidth="1.5" opacity="0.45" />
        <circle cx="12" cy="12" r="2.25" fill="var(--surface)" />
        <path d="M12 12 L17.2 6.8" stroke="var(--surface)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight">Sentinel</span>
    </Link>
  );
}

/**
 * The app's navigation: a column on the left on wide screens, a bar across the
 * top on narrow ones.
 */
export function Sidebar() {
  return (
    <header className="sticky top-0 z-20 flex shrink-0 flex-col gap-2 border-b border-line bg-plane/90 px-4 pt-3 pb-2 backdrop-blur md:h-dvh md:w-56 md:gap-6 md:border-r md:border-b-0 md:px-3 md:pt-5 md:pb-4">
      <div className="px-1.5">
        <Wordmark />
      </div>
      <nav aria-label="Main" className="-mx-1 overflow-x-auto px-1 pb-1 md:mx-0 md:overflow-visible md:px-0 md:pb-0">
        {/* The current path is unknown while a dynamic route prerenders, so the links render unhighlighted first. */}
        <Suspense fallback={<NavLinks pathname={null} />}>
          <ActiveNavLinks />
        </Suspense>
      </nav>
      {/* The bottom padding keeps this clear of the Next.js dev indicator in the corner. */}
      <div className="mt-auto hidden flex-col gap-2 px-2.5 pb-12 md:flex">
        <p className="text-xs leading-relaxed text-ink-3">
          Connected to the Sentinel runtime. Webhooks and the run log are stored on this machine.
        </p>
        <ResetButton />
      </div>
    </header>
  );
}
