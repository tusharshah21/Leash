"use client";

import { allowPda, LeashClient } from "@leash/sdk";
import { BN } from "@anchor-lang/core";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { Buffer } from "buffer";
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { dusdc, KEYS, MINT, providerFor, VENDORS } from "@/lib/chain";
import { Button, Card, ErrorText, humanError, Skeleton } from "./ui";

const STEPS = ["Mandate", "Allowlist", "Deposit", "Review"];
const ONE = 1_000_000;
const DAY = 86_400;
// Vault, mandate, token account and three allowlist entries, plus fees.
const MIN_SOL = 0.012;

const base = (n: number) => new BN(Math.round(n * ONE).toString());

function fits(ixs: TransactionInstruction[], payer: PublicKey) {
  try {
    const tx = new Transaction({ feePayer: payer, recentBlockhash: PublicKey.default.toBase58() });
    tx.add(...ixs);
    tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    return true;
  } catch {
    return false;
  }
}

export function CreateWizard() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [low, setLow] = useState(25);
  const [perTx, setPerTx] = useState(200);
  const [cap, setCap] = useState(500);
  const [days, setDays] = useState(7);
  const [vendors, setVendors] = useState(() => new Set(VENDORS.map((v) => v.address)));
  const [deposit, setDeposit] = useState(0);
  const [balance, setBalance] = useState<number | null>(null);
  const [sol, setSol] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const owner = wallet?.publicKey;

  // A wallet that already has a vault goes to it: one owner, one vault.
  useEffect(() => {
    if (!wallet) return;
    let stopped = false;
    setChecking(true);
    const client = new LeashClient(providerFor(connection, wallet), wallet.publicKey);
    void (async () => {
      try {
        const existing = await client.program.account.vault.fetchNullable(client.vault);
        if (stopped) return;
        if (existing) {
          router.replace(`/console/${client.vault.toBase58()}`);
          return;
        }
        const [lamports, tokens] = await Promise.all([
          connection.getBalance(wallet.publicKey, "confirmed"),
          connection
            .getTokenAccountBalance(
              getAssociatedTokenAddressSync(MINT, wallet.publicKey),
              "confirmed"
            )
            .then((r) => Number(r.value.amount) / ONE)
            .catch(() => 0),
        ]);
        if (stopped) return;
        setSol(lamports / LAMPORTS_PER_SOL);
        setBalance(tokens);
        setDeposit(Math.min(tokens, 2000));
      } catch (err) {
        if (!stopped) setError(humanError(err));
      } finally {
        if (!stopped) setChecking(false);
      }
    })();
    return () => {
      stopped = true;
    };
  }, [connection, wallet, router]);

  const create = async () => {
    if (!wallet || !owner) return;
    setError(null);
    setStatus("Waiting for your wallet");
    try {
      const client = new LeashClient(providerFor(connection, wallet), owner);
      const { program, vault, mandate, vaultToken } = client;
      const ixs = [
        await program.methods
          .initVault(KEYS.agent, KEYS.guard, KEYS.device)
          .accountsPartial({ owner, vault, mint: MINT, vaultTokenAccount: vaultToken })
          .instruction(),
        await program.methods
          .setMandate({
            lowThreshold: base(low),
            perTxMax: base(perTx),
            dailyCap: base(cap),
            expiresAt: new BN(Math.floor(Date.now() / 1000) + days * DAY),
            windowSecs: new BN(DAY),
            pendingTtlSecs: new BN(DAY),
          })
          .accountsPartial({ owner, vault, mandate })
          .instruction(),
      ];
      for (const v of VENDORS.filter((x) => vendors.has(x.address))) {
        const recipient = new PublicKey(v.address);
        ixs.push(
          await program.methods
            .addRecipient(
              recipient,
              Array.from(Buffer.concat([Buffer.from(v.name)], 32)),
              base(perTx)
            )
            .accountsPartial({ owner, vault, allowEntry: allowPda(vault, recipient) })
            .instruction()
        );
      }
      if (deposit > 0) {
        ixs.push(
          await program.methods
            .deposit(base(deposit))
            .accountsPartial({
              owner,
              vault,
              mint: MINT,
              ownerTokenAccount: getAssociatedTokenAddressSync(MINT, owner),
              vaultTokenAccount: vaultToken,
            })
            .instruction()
        );
      }
      // One atomic transaction, so one popup and no half-made vault. Splits only if it cannot fit.
      const batches = fits(ixs, owner) ? [ixs] : [ixs.slice(0, 2), ixs.slice(2)];
      for (const batch of batches) {
        await client.sendTx(new Transaction().add(...batch));
        setStatus("Confirming");
      }
      setStatus("Opening your console");
      router.push(`/console/${vault.toBase58()}`);
    } catch (err) {
      setError(humanError(err));
      setStatus(null);
    }
  };

  const lowSol = sol !== null && sol < MIN_SOL;

  return (
    <div className="mx-auto max-w-[1000px] px-4 py-8 md:px-8 md:py-12">
      <p className="eyebrow">New vault</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Put your agent on a leash</h1>
      <p className="mt-2 max-w-2xl text-muted">
        You set the limits and sign once. The demo agent, guard and device keys are filled in for
        you, and your wallet stays the only owner.
      </p>

      {!wallet ? (
        <Card className="mt-8">
          <div className="p-6">
            <p className="font-medium">Connect a wallet to begin.</p>
            <p className="mt-1 text-sm text-muted">
              Use the button at the top right, with your wallet set to devnet.
            </p>
          </div>
        </Card>
      ) : checking || balance === null ? (
        <div className="mt-8 space-y-3" aria-busy="true">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-72 w-full" />
          <span className="sr-only">Checking your wallet</span>
        </div>
      ) : (
        <div className="mt-8 grid gap-6 md:grid-cols-[12rem_1fr]">
          <ol className="flex gap-2 md:block md:space-y-1">
            {STEPS.map((name, i) => (
              <li key={name} className="flex-1">
                <button
                  type="button"
                  onClick={() => i < step && setStep(i)}
                  disabled={i > step}
                  aria-current={i === step ? "step" : undefined}
                  className={`mono flex min-h-11 w-full items-center gap-2 border-l-2 px-3 text-left text-sm ${
                    i === step
                      ? "border-safe bg-surface text-ink"
                      : i < step
                      ? "cursor-pointer border-line-strong text-ink hover:bg-surface"
                      : "border-line text-muted"
                  }`}
                >
                  {i < step ? (
                    <Check size={14} className="text-safe" aria-hidden="true" />
                  ) : (
                    <span className="hidden md:inline">{i + 1}</span>
                  )}
                  <span className="hidden sm:inline">{name}</span>
                </button>
              </li>
            ))}
          </ol>

          <Card>
            <div className="p-5 md:p-6">
              {step === 0 && (
                <div className="space-y-6">
                  <Slider
                    label="LOW threshold"
                    hint="Up to here the agent can pay alone."
                    value={low}
                    min={1}
                    max={perTx}
                    onChange={setLow}
                  />
                  <Slider
                    label="Per-transaction limit"
                    hint="Up to here the guard must co-sign. Above it, you approve."
                    value={perTx}
                    min={low}
                    max={cap}
                    onChange={setPerTx}
                  />
                  <Slider
                    label="Daily cap"
                    hint="The most the agent can spend per 24-hour window."
                    value={cap}
                    min={perTx}
                    max={2000}
                    onChange={setCap}
                  />
                  <Slider
                    label="Mandate lasts"
                    hint="After this the agent cannot pay until you renew it."
                    value={days}
                    min={1}
                    max={30}
                    unit="days"
                    onChange={setDays}
                  />
                </div>
              )}

              {step === 1 && (
                <fieldset className="space-y-2">
                  <legend className="mb-4 text-sm text-muted">
                    The agent can pay these without asking you, within your limits. Anyone else
                    becomes a pending item.
                  </legend>
                  {VENDORS.map((v) => (
                    <label
                      key={v.address}
                      className="flex min-h-11 cursor-pointer items-center gap-3 border border-line px-3 py-2 hover:bg-raised"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[var(--color-safe)]"
                        checked={vendors.has(v.address)}
                        onChange={(e) => {
                          const next = new Set(vendors);
                          if (e.target.checked) next.add(v.address);
                          else next.delete(v.address);
                          setVendors(next);
                        }}
                      />
                      <span className="font-medium">{v.name}</span>
                      <span className="mono ml-auto hidden text-xs text-muted sm:inline">
                        {v.address}
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}

              {step === 2 && (
                <div>
                  {balance === 0 ? (
                    <div className="border border-pending/40 bg-pending-dim p-4 text-sm">
                      <p className="font-medium text-pending">This wallet has no dUSDC yet.</p>
                      <p className="mt-1 text-muted">
                        You can still create the vault and deposit later. To get test tokens, run
                        this from the repo:
                      </p>
                      <p className="mono mt-2 break-all text-xs">
                        pnpm demo:faucet {owner?.toBase58()} 2000
                      </p>
                    </div>
                  ) : (
                    <Slider
                      label="Deposit"
                      hint={`You hold ${dusdc(
                        balance * ONE
                      )} dUSDC. The demo pays out 243, and 340 more if you approve DataLabs.`}
                      value={deposit}
                      min={0}
                      max={Math.floor(balance)}
                      onChange={setDeposit}
                    />
                  )}
                </div>
              )}

              {step === 3 && (
                <div>
                  <dl className="mono divide-y divide-line text-sm">
                    {[
                      ["LOW up to", `${low} dUSDC`],
                      ["Guard co-signs up to", `${perTx} dUSDC`],
                      ["Daily cap", `${cap} dUSDC`],
                      ["Lasts", `${days} days`],
                      ["Allowlist", `${vendors.size} of ${VENDORS.length} vendors`],
                      ["Deposit", `${deposit} dUSDC`],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-4 py-2">
                        <dt className="text-muted">{k}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-4 text-sm text-muted">
                    One signature. It costs about {MIN_SOL} SOL in rent and fees on devnet, and
                    either all of this happens or none of it does.
                  </p>
                  {lowSol && (
                    <p role="alert" className="mt-3 text-sm text-pending">
                      This wallet has {sol?.toFixed(4)} SOL, which may not be enough.
                    </p>
                  )}
                </div>
              )}

              <div className="mt-8 flex items-center justify-between gap-3">
                {step > 0 ? (
                  <Button onClick={() => setStep(step - 1)} disabled={!!status}>
                    Back
                  </Button>
                ) : (
                  <span />
                )}
                {step < STEPS.length - 1 ? (
                  <Button variant="primary" onClick={() => setStep(step + 1)}>
                    Continue
                  </Button>
                ) : (
                  <Button variant="primary" busy={!!status} onClick={() => void create()}>
                    {status ?? "Create vault"}
                  </Button>
                )}
              </div>
              <div className="mt-3 empty:hidden">
                <ErrorText error={error} />
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function Slider({
  label,
  hint,
  value,
  min,
  max,
  unit = "dUSDC",
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  onChange(value: number): void;
}) {
  const id = label.toLowerCase().replace(/[^a-z]+/g, "-");
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <span className="mono text-lg font-medium">
          {value} <span className="text-xs text-muted">{unit}</span>
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 h-6 w-full cursor-pointer"
      />
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </div>
  );
}
