"use client";

// A vault's live state. Chain data comes from RPC. A log notification on the vault triggers a
// refresh, which also catches failed transactions, and a slow poll covers a dropped websocket.
import { type ActivityEntry, type HistoryItem, LeashClient } from "@leash/sdk";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { providerFor, readOnlyWallet } from "./chain";
import { backoffMs, settledOr } from "./retry";

const POLL_MS = 15_000;
const ACTIVITY_POLL_MS = 3_000;
const HISTORY_LIMIT = 40;
const NOT_FOUND = /does not exist|has no data|Invalid account discriminator/i;
const NO_VAULT = "There is no Leash vault at this address.";
const isNotFound = (err: unknown) => NOT_FOUND.test(String((err as Error)?.message ?? err));

type Account<K extends "fetchVault" | "fetchMandate"> = Awaited<ReturnType<LeashClient[K]>>;

export interface VaultData {
  vault: Account<"fetchVault">;
  mandate: Account<"fetchMandate">;
  balance: string;
  allowlist: Awaited<ReturnType<LeashClient["fetchAllowlist"]>>;
  pending: Awaited<ReturnType<LeashClient["fetchPending"]>>;
  history: HistoryItem[];
  /** The cluster's clock minus this machine's, in seconds. */
  clockSkew: number;
}

export type VaultState =
  | { status: "loading" }
  | { status: "missing"; reason: string }
  | { status: "ready"; client: LeashClient; data: VaultData };

export function useVault(address: string) {
  const { connection } = useConnection();
  const [state, setState] = useState<VaultState>({ status: "loading" });
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [offline, setOffline] = useState(false);
  const cache = useRef(new Map<string, HistoryItem>());
  const clientRef = useRef<LeashClient | null>(null);
  const running = useRef(false);
  const again = useRef(false);
  const last = useRef<VaultData | null>(null);
  const failures = useRef(0);
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const refresh = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    // One at a time. A notification during a refresh schedules exactly one more.
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    clearTimeout(retry.current);
    const prev = last.current;
    let failed = false;
    // Each part falls back to its last good value, so one rate-limited request never blanks the page.
    const pick = <T>(result: PromiseSettledResult<T>, previous: T | undefined) => {
      failed ||= result.status === "rejected";
      return settledOr(result, previous, isNotFound);
    };
    const show = (data: VaultData) => {
      last.current = data;
      setState({ status: "ready", client, data });
    };
    try {
      const [vault, mandate, balance, allowlist, pending, clock] = await Promise.allSettled([
        client.fetchVault(),
        client.fetchMandate(),
        connection
          .getTokenAccountBalance(client.vaultToken, "confirmed")
          .then((b) => b.value.amount),
        client.fetchAllowlist(),
        client.fetchPending(),
        connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY, "confirmed"),
      ]);
      const time = clock.status === "fulfilled" ? clock.value : null;
      const chainNow = time ? Number(time.data.readBigInt64LE(32)) : Date.now() / 1000;
      const data: VaultData = {
        vault: pick(vault, prev?.vault),
        mandate: pick(mandate, prev?.mandate),
        balance: pick(balance, prev?.balance),
        allowlist: pick(allowlist, prev?.allowlist),
        pending: pick(pending, prev?.pending),
        history: prev?.history ?? [],
        clockSkew: time ? chainNow - Date.now() / 1000 : prev?.clockSkew ?? 0,
      };
      // The vault shows now; history, up to 40 transaction fetches, follows.
      if (!prev) show(data);
      const [history] = await Promise.allSettled([
        client.fetchHistory(HISTORY_LIMIT, cache.current),
      ]);
      show({ ...data, history: pick(history, data.history) });
    } catch (err) {
      failed = true;
      if (isNotFound(err)) {
        last.current = null;
        setState({ status: "missing", reason: NO_VAULT });
        failed = false;
      }
    } finally {
      setOffline(failed);
      failures.current = failed ? failures.current + 1 : 0;
      // Retry sooner than the poll after a failure, backing off while the RPC keeps refusing.
      if (failed) retry.current = setTimeout(() => void refresh(), backoffMs(failures.current - 1));
      running.current = false;
      if (again.current) {
        again.current = false;
        void refresh();
      }
    }
  }, [connection]);

  useEffect(() => {
    let key: PublicKey;
    try {
      key = new PublicKey(address);
    } catch {
      setState({ status: "missing", reason: "That is not a valid address." });
      return;
    }

    let stopped = false;
    let unsubscribe = () => {};
    let attempt = 0;
    const start = async () => {
      try {
        const client = await LeashClient.forVault(providerFor(connection, readOnlyWallet), key);
        if (stopped) return;
        clientRef.current = client;
        await refresh();
        const id = connection.onLogs(key, () => void refresh(), "confirmed");
        unsubscribe = () => void connection.removeOnLogsListener(id);
      } catch (err) {
        if (stopped) return;
        if (isNotFound(err)) {
          setState({ status: "missing", reason: NO_VAULT });
        } else {
          setOffline(true);
          setTimeout(() => !stopped && void start(), backoffMs(attempt++));
        }
      }
    };
    void start();
    const poll = setInterval(() => void refresh(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(poll);
      clearTimeout(retry.current);
      unsubscribe();
    };
  }, [address, connection, refresh]);

  // Guard denials never reach the chain, so the log is polled rather than notified.
  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/activity?vault=${encodeURIComponent(address)}`);
        if (!res.ok) return;
        const entries = (await res.json()) as ActivityEntry[];
        if (!stopped) setActivity(entries.filter((e) => e.vault === address));
      } catch {
        // The chain data still stands. Reasoning fills in once the log is reachable.
      }
    };
    void load();
    const poll = setInterval(load, ACTIVITY_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(poll);
    };
  }, [address]);

  return { state, activity, offline, refresh };
}

/** A client that signs as the connected wallet, or null with none connected. */
export function useSigner(owner: PublicKey | undefined) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  return useMemo(
    () => (wallet && owner ? new LeashClient(providerFor(connection, wallet), owner) : null),
    [connection, wallet, owner]
  );
}
