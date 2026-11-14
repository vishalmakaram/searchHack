import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/skeleton";
import { WorkspacesView } from "./workspaces-view";

export const metadata: Metadata = { title: "Workspaces" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <WorkspacesView />
    </Suspense>
  );
}
