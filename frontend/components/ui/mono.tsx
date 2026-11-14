import { cn } from "@/lib/cn";

/** An identifier or other literal value, in the monospace face. */
export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("font-mono text-[12.5px] text-ink-2", className)}>{children}</span>;
}
