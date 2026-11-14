import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/** A table that scrolls sideways inside its container instead of widening the page. */
export function Table({ className, children, ...rest }: ComponentProps<"table">) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full border-collapse text-left text-sm", className)} {...rest}>
        {children}
      </table>
    </div>
  );
}

export function Th({ className, scope = "col", ...rest }: ComponentProps<"th">) {
  return (
    <th
      scope={scope}
      className={cn(
        "border-b border-line px-4 py-2.5 text-xs font-medium whitespace-nowrap text-ink-3 first:pl-5 last:pr-5",
        className,
      )}
      {...rest}
    />
  );
}

export function Td({ className, ...rest }: ComponentProps<"td">) {
  return <td className={cn("px-4 py-3 align-middle first:pl-5 last:pr-5", className)} {...rest} />;
}

/** A body row. Rows below the first get a hairline above them. */
export function Tr({ className, ...rest }: ComponentProps<"tr">) {
  return <tr className={cn("border-t border-line first:border-t-0", className)} {...rest} />;
}
