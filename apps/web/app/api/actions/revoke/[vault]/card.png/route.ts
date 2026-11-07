import { actionCard } from "@/lib/action-card";

export const GET = () =>
  actionCard({
    banner: "EMERGENCY STOP",
    tone: "blocked",
    headline: "Revoke",
    lines: ["Stops the agent, onchain, at once.", "Pending approvals keep working."],
  });
