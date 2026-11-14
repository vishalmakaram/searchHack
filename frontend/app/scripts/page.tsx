import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/skeleton";
import { ScriptsView } from "./scripts-view";

export const metadata: Metadata = { title: "Scripts" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ScriptsView />
    </Suspense>
  );
}
