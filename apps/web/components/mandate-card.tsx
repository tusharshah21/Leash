"use client";

import { useEffect, useState } from "react";
import { dusdc } from "@/lib/chain";
import type { VaultData } from "@/lib/use-vault";
import { Card, Countdown } from "./ui";

export function MandateCard({ mandate, skew }: { mandate: VaultData["mandate"]; skew: number }) {
  const low = Number(mandate.lowThreshold);
  const perTx = Number(mandate.perTxMax);
  const cap = Number(mandate.dailyCap);
  const windowEnd = mandate.windowStart.toNumber() + mandate.windowSecs.toNumber();
  const expiresAt = mandate.expiresAt.toNumber();

  // Set after mount: the server and browser clocks would disagree on first render.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now() / 1000 + skew);
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, [skew]);

  // A window that has ended only resets onchain at the next action, but it no longer counts.
  const windowEnded = now !== null && now >= windowEnd;
  const spent = windowEnded ? 0 : Number(mandate.spentToday);
  const used = Math.min(100, (spent / cap) * 100);
  const expired = now !== null && now >= expiresAt;

  // The ruler runs a quarter past per_tx_max, so HIGH has room to read as a region.
  const scale = perTx * 1.25;
  const lowAt = (low / scale) * 100;
  const mediumAt = (perTx / scale) * 100;

  return (
    <Card
      title="Mandate"
      aside={
        expired ? <span className="mono text-xs font-medium text-blocked">EXPIRED</span> : undefined
      }
    >
      <div className="space-y-6 p-4">
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="eyebrow">Spent today</span>
            <span className="mono text-sm">
              <span className="text-lg font-medium">{dusdc(spent)}</span>
              <span className="text-muted"> / {dusdc(cap)} dUSDC</span>
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={Math.round(used)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Share of the daily cap spent"
            className="mt-2 h-2.5 border border-line bg-bg"
          >
            <div
              className={`gauge-fill h-full ${
                used >= 90 ? "bg-blocked" : used >= 70 ? "bg-pending" : "bg-safe"
              }`}
              style={{ width: `${used}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted">
            {windowEnded ? (
              "A fresh window starts at the agent's next action."
            ) : (
              <>
                Window resets in <Countdown until={windowEnd} skew={skew} />
              </>
            )}
          </p>
          {spent > cap && (
            <p className="mt-1 text-xs text-muted">
              Over the cap through a human approval. The agent cannot spend until the reset.
            </p>
          )}
        </div>

        <div>
          <p className="eyebrow">Tiers</p>
          <div className="mono mt-2 flex h-8 text-xs font-medium" aria-hidden="true">
            <div
              className="flex items-center justify-center bg-safe-dim text-safe"
              style={{ width: `${lowAt}%` }}
            >
              LOW
            </div>
            <div
              className="flex items-center justify-center border-x border-bg bg-pending-dim text-pending"
              style={{ width: `${mediumAt - lowAt}%` }}
            >
              MEDIUM
            </div>
            <div className="flex flex-1 items-center justify-center bg-blocked-dim text-blocked">
              HIGH
            </div>
          </div>
          <dl className="mt-3 space-y-2 text-sm">
            <Rule tier="LOW" text={`up to ${dusdc(low)}`} who="agent alone" />
            <Rule tier="MEDIUM" text={`up to ${dusdc(perTx)}`} who="agent + guard" />
            <Rule tier="HIGH" text="above, or unlisted" who="you sign" />
          </dl>
        </div>

        <div className="flex items-baseline justify-between border-t border-line pt-3 text-sm">
          <span className="eyebrow">Mandate expires</span>
          <Countdown until={expiresAt} skew={skew} done="expired" />
        </div>
      </div>
    </Card>
  );
}

function Rule({ tier, text, who }: { tier: string; text: string; who: string }) {
  return (
    <div className="grid grid-cols-[3.75rem_1fr_auto] items-baseline gap-2">
      <dt className="mono text-xs text-muted">{tier}</dt>
      <dd className="mono text-[13px]">{text}</dd>
      <dd className="text-xs text-muted">{who}</dd>
    </div>
  );
}
