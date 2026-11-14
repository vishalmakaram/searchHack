"use client";

import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { resetData } from "@/lib/api";
import { ConfirmDialog } from "@/components/ui/dialog";

/** Empties the local store: script switches, webhooks, deliveries and the run log. */
export function ResetButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md text-xs font-medium text-ink-3 transition-colors hover:text-ink"
      >
        <RotateCcw className="size-3.5" aria-hidden />
        Clear local data
      </button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Clear local data?"
        description="Every webhook, delivery and run in the log is removed, and every script goes back to Developed. Workspaces, their scripts and their results in the runtime are not touched. Webhook URLs you gave to Telem will stop working."
        confirmLabel="Clear data"
        danger
        onConfirm={async () => {
          await resetData();
          // Detail pages point at ids that no longer exist; go back to the top.
          router.push("/");
        }}
      />
    </>
  );
}
