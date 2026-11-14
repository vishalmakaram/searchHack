import { cn } from "@/lib/cn";
import { CopyButton } from "./copy-button";

interface CodeBlockProps {
  code: string;
  /** Shown in the bar above the code, for example a file name. */
  label?: string;
  /** What the copy button copies, for its accessible name. */
  what?: string;
  lineNumbers?: boolean;
  /** Caps the height and scrolls. */
  maxHeight?: string;
  className?: string;
}

/** Read-only code or JSON, with a copy button. */
export function CodeBlock({ code, label, what = "code", lineNumbers, maxHeight = "28rem", className }: CodeBlockProps) {
  const lines = code.replace(/\n$/, "").split("\n");
  return (
    <div className={cn("overflow-hidden rounded-lg border border-line bg-surface-2", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-line py-1 pr-1.5 pl-3.5">
        <span className="truncate font-mono text-xs text-ink-3">{label ?? ""}</span>
        <CopyButton value={code} what={what} />
      </div>
      <pre
        tabIndex={0}
        className="overflow-auto py-3 font-mono text-[12.5px] leading-[1.65] text-ink"
        style={{ maxHeight }}
      >
        <code className="block min-w-max">
          {lines.map((line, index) => (
            <span key={index} className="block px-3.5">
              {lineNumbers ? (
                <span className="mr-4 inline-block w-6 text-right text-ink-3 select-none" aria-hidden>
                  {index + 1}
                </span>
              ) : null}
              {line || " "}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
