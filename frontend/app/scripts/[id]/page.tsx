import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/skeleton";
import { ScriptDetail } from "./script-detail";

export const metadata: Metadata = { title: "Script" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ScriptDetail />
    </Suspense>
  );
}
