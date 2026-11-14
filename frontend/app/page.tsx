import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/skeleton";
import { OverviewView } from "./overview-view";

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <OverviewView />
    </Suspense>
  );
}
