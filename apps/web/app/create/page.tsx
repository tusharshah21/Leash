"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui";

const CreateWizard = dynamic(
  () => import("@/components/create-wizard").then((m) => m.CreateWizard),
  {
    ssr: false,
    loading: () => (
      <div className="mx-auto max-w-[1000px] px-4 py-12 md:px-8">
        <Skeleton className="h-96 w-full" />
      </div>
    ),
  }
);

export default function CreatePage() {
  return <CreateWizard />;
}
