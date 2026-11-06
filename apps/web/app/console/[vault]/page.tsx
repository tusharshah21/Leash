"use client";

import dynamic from "next/dynamic";
import { use } from "react";
import { Skeleton } from "@/components/ui";

// Client only: it reads the wallet and the chain, and has nothing useful to prerender.
const Console = dynamic(() => import("@/components/console").then((m) => m.Console), {
  ssr: false,
  loading: () => (
    <div className="mx-auto max-w-[1600px] space-y-4 px-4 py-6 md:px-8">
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  ),
});

export default function ConsolePage({ params }: { params: Promise<{ vault: string }> }) {
  const { vault } = use(params);
  return <Console address={vault} />;
}
