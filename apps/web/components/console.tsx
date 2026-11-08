"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { Power, ShieldAlert, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { revokePath } from "@/lib/actions";
import { DEMO_VAULT, dusdc, VENDORS, WALLET_BY_TOKEN_ACCOUNT } from "@/lib/chain";
import { buildTimeline } from "@/lib/timeline";
import { useSigner, useVault, type VaultData } from "@/lib/use-vault";
import { MandateCard } from "./mandate-card";
import { PendingQueue } from "./pending";
import { PhoneLink } from "./phone-link";
import { Timeline } from "./timeline";
import { Address, Button, Card, Confirm, ErrorText, humanError, Skeleton } from "./ui";

export function Console({ address }: { address: string }) {
  const { state, activity, offline, refresh } = useVault(address);

  if (state.status === "loading") return <Loading offline={offline} />;
  if (state.status === "missing") return <Missing address={address} reason={state.reason} />;
  return (
    <Ready
      address={address}
      data={state.data}
      activity={activity}
      offline={offline}
      refresh={refresh}
    />
  );
}

function Loading({ offline }: { offline: boolean }) {
  return (
    <div className="mx-auto max-w-[1600px] space-y-4 px-4 py-6 md:px-8" aria-busy="true">
      {offline && <Offline />}
      <Skeleton className="h-28 w-full" />
      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <Skeleton className="h-96" />
        <Skeleton className="h-96" />
      </div>
      <span className="sr-only">Loading the vault</span>
    </div>
  );
}

function Missing({ address, reason }: { address: string; reason: string }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center md:px-8">
      <p className="eyebrow">Vault not found</p>
      <h1 className="mt-3 text-2xl font-semibold">{reason}</h1>
      <p className="mono mt-3 text-sm break-all text-muted">{address}</p>
      <p className="mt-2 text-sm text-muted">This console reads devnet only.</p>
      <div className="mt-8 flex justify-center gap-3">
        <Link
          href={`/console/${DEMO_VAULT}`}
          className="border border-line-strong px-4 py-2.5 text-sm hover:bg-raised"
        >
          Open the demo vault
        </Link>
        <Link href="/create" className="bg-safe px-4 py-2.5 text-sm font-medium text-bg">
          Create your vault
        </Link>
      </div>
    </div>
  );
}

function Offline() {
  return (
    <p
      role="status"
      className="border border-pending/40 bg-pending-dim px-4 py-2 text-sm text-pending"
    >
      Cannot reach devnet right now. Showing the last known state, and retrying.
    </p>
  );
}

function Ready({
  address,
  data,
  activity,
  offline,
  refresh,
}: {
  address: string;
  data: VaultData;
  activity: Parameters<typeof buildTimeline>[0]["activity"];
  offline: boolean;
  refresh(): Promise<void>;
}) {
  const { vault, mandate, pending, history, allowlist, clockSkew } = data;
  const { publicKey } = useWallet();
  const signer = useSigner(vault.owner);
  const isOwner = !!publicKey && publicKey.equals(vault.owner);
  const owner = vault.owner.toBase58();

  const labels = useMemo(() => {
    const map = new Map(allowlist.map((e) => [e.recipient.toBase58(), e.label]));
    for (const v of VENDORS) if (!map.has(v.address)) map.set(v.address, v.name);
    return map;
  }, [allowlist]);
  const listed = useMemo(() => new Set(allowlist.map((e) => e.recipient.toBase58())), [allowlist]);

  const open = pending.filter((p) => "pending" in p.status);
  const ttl = mandate.pendingTtlSecs.toNumber();
  const chainNow = Date.now() / 1000 + clockSkew;
  const rows = useMemo(() => {
    const expiredNonces = new Set(
      open.filter((p) => p.createdAt.toNumber() + ttl < chainNow).map((p) => p.nonce.toString())
    );
    return buildTimeline({
      history,
      activity,
      expiredNonces,
      walletByTokenAccount: WALLET_BY_TOKEN_ACCOUNT,
    });
    // chainNow moves every render. Expiry only needs re-checking when the data does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, activity, pending, ttl]);

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 px-4 py-6 md:px-8">
      {offline && <Offline />}

      <Card tour="vault">
        <div className="grid gap-6 p-4 md:grid-cols-[auto_1fr] md:gap-10 md:p-6">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="eyebrow">Vault</h1>
              {vault.paused ? (
                <span className="mono inline-flex items-center gap-1.5 border border-blocked/40 bg-blocked-dim px-2 py-0.5 text-xs font-medium text-blocked">
                  <ShieldAlert size={13} aria-hidden="true" /> PAUSED
                </span>
              ) : (
                <span className="mono inline-flex items-center gap-1.5 border border-safe/40 bg-safe-dim px-2 py-0.5 text-xs font-medium text-safe">
                  <ShieldCheck size={13} aria-hidden="true" /> ACTIVE
                </span>
              )}
            </div>
            <p className="mono mt-2 text-4xl font-medium tracking-tight md:text-5xl">
              {dusdc(data.balance)}
              <span className="ml-2 text-base text-muted">dUSDC</span>
            </p>
            <div className="mt-2">
              <Address address={address} />
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 self-end md:grid-cols-4">
            {[
              ["Owner", owner],
              ["Agent", vault.agent.toBase58()],
              ["Guard", vault.guard?.toBase58()],
              ["Device", vault.device?.toBase58()],
            ].map(([name, key]) => (
              <div key={name}>
                <dt className="eyebrow">{name}</dt>
                <dd className="mt-1">
                  {key ? <Address address={key} /> : <span className="mono text-sm">not set</span>}
                  {name === "Owner" && isOwner && (
                    <span className="ml-2 text-xs text-safe">you</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,5fr)_minmax(0,6fr)]">
        <div className="order-3 space-y-4 lg:order-none lg:row-span-2 xl:row-span-1">
          <div data-tour="mandate">
            <MandateCard mandate={mandate} skew={clockSkew} />
          </div>
          <div data-tour="kill">
            <KillSwitch
              address={address}
              paused={vault.paused}
              isOwner={isOwner}
              device={vault.device?.toBase58()}
              signer={signer}
              refresh={refresh}
            />
          </div>
          {isOwner && <DangerZone paused={vault.paused} balance={data.balance} signer={signer} />}
        </div>
        <div data-tour="pending" className="order-1 min-w-0 lg:order-none">
          <PendingQueue
            pending={open}
            activity={activity}
            address={address}
            labels={labels}
            listed={listed}
            ttl={ttl}
            skew={clockSkew}
            isOwner={isOwner}
            device={vault.device?.toBase58()}
            signer={signer}
            refresh={refresh}
          />
        </div>
        <div data-tour="timeline" className="order-2 min-w-0 lg:order-none">
          <Timeline
            rows={rows}
            labels={labels}
            address={address}
            offline={offline}
            loading={!data.historyLoaded}
          />
        </div>
      </div>
    </div>
  );
}

function KillSwitch({
  address,
  paused,
  isOwner,
  device,
  signer,
  refresh,
}: {
  address: string;
  paused: boolean;
  isOwner: boolean;
  device?: string;
  signer: ReturnType<typeof useSigner>;
  refresh(): Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: "revoke" | "unpause") => {
    if (!signer) return;
    setConfirming(false);
    setBusy(true);
    setError(null);
    try {
      await (action === "revoke" ? signer.revoke() : signer.unpause());
      await refresh();
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Kill switch">
      <div className="space-y-3 p-4">
        {paused ? (
          <>
            <p className="text-sm leading-relaxed">
              <strong className="font-semibold text-blocked">The agent is stopped.</strong> It
              cannot pay or propose. Approvals and rejections of what is already pending still work
              while paused.
            </p>
            <Button
              onClick={() => void run("unpause")}
              busy={busy}
              disabled={!isOwner}
              className="w-full"
            >
              Unpause
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm leading-relaxed text-muted">
              Stops the agent immediately, onchain. Pending approvals keep working, and you can
              withdraw at any time.
            </p>
            <Button
              variant="dangerOutline"
              onClick={() => setConfirming(true)}
              busy={busy}
              disabled={!isOwner}
              className="w-full"
            >
              <Power size={15} aria-hidden="true" /> Revoke agent
            </Button>
            <div className="[&>button]:w-full">
              <PhoneLink
                path={revokePath(address)}
                label="Revoke from phone"
                title="Revoke the agent from your phone"
              />
            </div>
          </>
        )}
        {!isOwner && (
          <p className="text-xs text-muted">
            Connect the owner wallet to use this. {device ? "The device key can also revoke." : ""}
          </p>
        )}
        <ErrorText error={error} />
      </div>
      <Confirm
        open={confirming}
        title="Revoke the agent?"
        body="The agent stops at once. Only the owner can unpause it. Pending items can still be approved or rejected."
        action="Revoke agent"
        onConfirm={() => void run("revoke")}
        onClose={() => setConfirming(false)}
      />
    </Card>
  );
}

const CLOSE_WORD = "CLOSE";

function DangerZone({
  paused,
  balance,
  signer,
}: {
  paused: boolean;
  balance: string;
  signer: ReturnType<typeof useSigner>;
}) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = async () => {
    if (!signer) return;
    setBusy(true);
    setError(null);
    try {
      await signer.closeVault();
      router.replace("/create");
    } catch (err) {
      setError(humanError(err));
      setBusy(false);
    }
  };

  return (
    <Card title="Danger zone" className="border-blocked/40">
      <div className="space-y-3 p-4">
        <p className="text-sm leading-relaxed text-muted">
          Closes this vault for good. <span className="mono">{dusdc(balance)} dUSDC</span> and the
          rent return to your wallet, and the allowlist and mandate are deleted. Anything still
          pending can never be approved. You can create a new vault afterwards.
        </p>
        {paused ? (
          <>
            <label className="block text-sm">
              Type <span className="mono font-medium">{CLOSE_WORD}</span> to confirm
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                className="mono mt-2 block min-h-11 w-full border border-line-strong bg-bg px-3 text-sm"
              />
            </label>
            <Button
              variant="danger"
              onClick={() => void close()}
              busy={busy}
              disabled={typed !== CLOSE_WORD}
              className="w-full"
            >
              Close vault
            </Button>
          </>
        ) : (
          <p className="text-sm text-pending">
            Revoke the agent first. Only a paused vault closes.
          </p>
        )}
        <ErrorText error={error} />
      </div>
    </Card>
  );
}
