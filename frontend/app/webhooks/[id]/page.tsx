import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/skeleton";
import { WebhookDetail } from "./webhook-detail";

export const metadata: Metadata = { title: "Webhook" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <WebhookDetail />
    </Suspense>
  );
}
