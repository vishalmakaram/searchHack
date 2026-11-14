import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/skeleton";
import { WebhooksView } from "./webhooks-view";

export const metadata: Metadata = { title: "Webhooks" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <WebhooksView />
    </Suspense>
  );
}
