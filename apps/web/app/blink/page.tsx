import { notFound } from "next/navigation";
import { BlinkView } from "@/components/blink-view";

// Only our own Actions, so this page cannot be pointed at someone else's transaction.
const OUR_ACTION = /^\/api\/actions\/(pending\/\w+\/\d+|revoke\/\w+)$/;

export default async function BlinkPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string }>;
}) {
  const { action } = await searchParams;
  if (!action || !OUR_ACTION.test(action)) notFound();
  return <BlinkView path={action} />;
}
