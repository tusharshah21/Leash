import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { LayerDiagram, LiveStats } from "@/components/landing";
import { DEMO_VAULT } from "@/lib/chain";

const SCENARIOS = [
  {
    attack: "A hidden line in an invoice tells the agent to send 150 dUSDC to an attacker.",
    result: "The agent falls for it. The payment sits pending, and no money moves.",
    tag: "PENDING",
    className: "text-pending",
  },
  {
    attack: "A stolen agent key calls the program directly, skipping everything else.",
    result: "The program rejects it onchain: the recipient is not on the allowlist.",
    tag: "BLOCKED BY CHAIN",
    className: "text-blocked",
  },
  {
    attack: "The injection names a real vendor, with an inflated amount the mandate would allow.",
    result: "The guard refuses to co-sign, because the amount does not match the task.",
    tag: "BLOCKED BY GUARD",
    className: "text-blocked",
  },
];

export default function Home() {
  return (
    <div className="mx-auto max-w-[1600px] px-4 md:px-8">
      <section className="py-14 md:py-24">
        <p className="eyebrow">Onchain firewall for AI agents</p>
        <h1 className="mt-4 max-w-4xl text-4xl leading-[1.1] font-semibold tracking-tight md:text-6xl">
          AI agents are about to hold real money.
          <span className="block text-muted">Leash makes sure they only do what you meant.</span>
        </h1>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href={`/console/${DEMO_VAULT}`}
            className="inline-flex min-h-12 items-center gap-2 bg-safe px-5 font-medium text-bg transition-[filter] hover:brightness-110"
          >
            Open console <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <Link
            href="/create"
            className="inline-flex min-h-12 items-center border border-line-strong px-5 font-medium transition-colors hover:bg-raised"
          >
            Create your vault
          </Link>
        </div>
      </section>

      <section aria-labelledby="layers" className="pb-14">
        <h2 id="layers" className="eyebrow mb-4">
          Every action passes three layers
        </h2>
        <LayerDiagram />
      </section>

      <section aria-labelledby="fooled" className="pb-14">
        <h2 id="fooled" className="eyebrow mb-4">
          When the agent gets fooled
        </h2>
        <ul className="divide-y divide-line border border-line bg-surface">
          {SCENARIOS.map((s) => (
            <li key={s.tag} className="grid gap-2 p-5 md:grid-cols-[1fr_1fr_11rem] md:gap-6">
              <p className="text-sm leading-relaxed">{s.attack}</p>
              <p className="text-sm leading-relaxed text-muted">{s.result}</p>
              <p className={`mono text-xs font-medium md:text-right ${s.className}`}>{s.tag}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="live" className="pb-20">
        <h2 id="live" className="eyebrow mb-4">
          Live from devnet
        </h2>
        <LiveStats />
      </section>
    </div>
  );
}
