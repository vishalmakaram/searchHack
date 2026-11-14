import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/skeleton";
import { ActivityView } from "./activity-view";

export const metadata: Metadata = { title: "Activity" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ActivityView />
    </Suspense>
  );
}
