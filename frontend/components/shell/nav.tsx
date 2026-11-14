"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, FileCode2, Gauge, Telescope, Webhook } from "lucide-react";
import { cn } from "@/lib/cn";

const ITEMS = [
  { href: "/", label: "Overview", icon: Gauge },
  { href: "/workspaces", label: "Workspaces", icon: Telescope },
  { href: "/scripts", label: "Scripts", icon: FileCode2 },
  { href: "/webhooks", label: "Webhooks", icon: Webhook },
  { href: "/activity", label: "Activity", icon: Activity },
] as const;

function isActive(href: string, pathname: string | null): boolean {
  if (pathname === null) return false;
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** The navigation links. `pathname` is null while the current route is not known yet. */
export function NavLinks({ pathname }: { pathname: string | null }) {
  return (
    <ul className="flex gap-1 md:flex-col">
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(href, pathname);
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
                active ? "bg-surface text-ink shadow-card ring-1 ring-line" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
              )}
            >
              <Icon className={cn("size-4 shrink-0", active ? "text-ink" : "text-ink-3")} aria-hidden />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** NavLinks with the current page highlighted. Must sit inside a Suspense boundary. */
export function ActiveNavLinks() {
  return <NavLinks pathname={usePathname()} />;
}
