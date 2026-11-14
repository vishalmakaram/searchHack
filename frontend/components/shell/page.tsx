import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** A link back to the list this page belongs to. */
  back?: { href: string; label: string };
  /** Badges shown beside the title. */
  badges?: ReactNode;
  /** Buttons at the right. */
  actions?: ReactNode;
}

export function PageHeader({ title, description, back, badges, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-3">
      {back ? (
        <Link
          href={back.href}
          className="inline-flex w-fit items-center gap-1.5 rounded-md text-[13px] font-medium text-ink-3 transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-ink">{title}</h1>
            {badges}
          </div>
          {description ? <p className="mt-1 max-w-2xl text-sm text-ink-2">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

/** The vertical rhythm every page shares. */
export function PageBody({ children }: { children: ReactNode }) {
  return <div className="flex animate-enter flex-col gap-6">{children}</div>;
}
