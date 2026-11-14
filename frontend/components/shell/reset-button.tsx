"use client";

import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { resetData } from "@/lib/api";
import { ConfirmDialog } from "@/components/ui/dialog";

/** Wipes the local mock database and reseeds it. For demos. */
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
        Reset demo data
      </button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Reset demo data?"
        description="Every workspace, script, webhook, delivery and run is replaced with the starting sample data. Webhook URLs you gave to Telem will stop working."
        confirmLabel="Reset data"
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
