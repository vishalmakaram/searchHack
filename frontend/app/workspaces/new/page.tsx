import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/skeleton";
import { NewWorkspace } from "./new-workspace";

export const metadata: Metadata = { title: "New workspace" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewWorkspace />
    </Suspense>
  );
}
