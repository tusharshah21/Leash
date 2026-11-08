import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { AttackReplay, LayerDiagram, LiveStats } from "@/components/landing";
import { OutcomeBadge } from "@/components/ui";
import type { Outcome } from "@/lib/timeline";
import { DEMO_VAULT } from "@/lib/chain";

const SCENARIOS: { attack: string; result: string; tag: Outcome }[] = [
  {
    attack: "A hidden line in an invoice tells the agent to send 150 dUSDC to an attacker.",
    result: "The agent falls for it. The payment sits pending, and no money moves.",
    tag: "PENDING",
  },
  {
    attack: "A stolen agent key calls the program directly, skipping everything else.",
    result: "The program rejects it onchain: the recipient is not on the allowlist.",
    tag: "BLOCKED BY CHAIN",
  },
  {
    attack: "The injection names a real vendor, with an inflated amount the mandate would allow.",
    result: "The guard refuses to co-sign, because the amount does not match the task.",
    tag: "BLOCKED BY GUARD",
  },
];

export default function Home() {
  return (
    <div className="mx-auto max-w-[1600px] px-4 md:px-8">
      <section className="grid items-center gap-10 py-12 md:py-20 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:gap-16">
        <div>
          <p className="eyebrow">Onchain firewall for AI agents</p>
          <h1 className="mt-4 text-4xl leading-[1.08] font-semibold tracking-tight text-balance md:text-6xl">
            AI agents are about to hold real money.
            <span className="mt-2 block text-muted">
              Leash makes sure they only do what you meant.
            </span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
            A Solana program holds the agent&apos;s funds and checks every payment against limits
            you signed, a guard&apos;s co-signature, and your approval. A fooled agent cannot talk
            its way past code.
          </p>
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
        </div>
        <AttackReplay />
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
              <p className="md:text-right">
                <OutcomeBadge outcome={s.tag} />
              </p>
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
