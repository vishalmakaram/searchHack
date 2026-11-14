import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/skeleton";
import { WorkspaceDetail } from "./workspace-detail";

export const metadata: Metadata = { title: "Workspace" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <WorkspaceDetail />
    </Suspense>
  );
}
