"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { ChevronDown, LogOut, Wallet } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { addressUrl, DEMO_VAULT, PROGRAM, short } from "@/lib/chain";
import { Tour } from "./tour";

export function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <circle cx="11" cy="4" r="3" stroke="var(--color-safe)" strokeWidth="2" />
      <path d="M11 7v8" stroke="var(--color-ink)" strokeWidth="2" />
      <path d="M5 15h12v5H5z" stroke="var(--color-ink)" strokeWidth="2" />
    </svg>
  );
}

function WalletMenu() {
  const { wallets, select, publicKey, disconnect, connecting } = useWallet();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent ? e.key === "Escape" : !menu.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const available = wallets.filter(
    (w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable
  );
  const label = publicKey ? (
    short(publicKey.toBase58())
  ) : connecting ? (
    "Connecting"
  ) : (
    <>
      Connect<span className="hidden sm:inline"> wallet</span>
    </>
  );

  return (
    <div className="relative" ref={menu}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="mono flex h-10 cursor-pointer items-center gap-2 border whitespace-nowrap border-line-strong bg-surface px-3 text-sm transition-colors hover:bg-raised"
      >
        <Wallet size={16} aria-hidden="true" className="hidden sm:block" />
        {label}
        <ChevronDown size={14} aria-hidden="true" className="hidden sm:block" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-64 border border-line-strong bg-raised p-2 shadow-xl"
        >
          {publicKey ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                void disconnect();
                setOpen(false);
              }}
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm hover:bg-line"
            >
              <LogOut size={16} aria-hidden="true" />
              Disconnect
            </button>
          ) : available.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted">
              No wallet found. Install Phantom or MetaMask and set it to devnet.
            </p>
          ) : (
            available.map((w) => (
              <button
                type="button"
                role="menuitem"
                key={w.adapter.name}
                onClick={() => {
                  select(w.adapter.name);
                  setOpen(false);
                }}
                className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left text-sm hover:bg-line"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={w.adapter.icon} alt="" width={20} height={20} />
                {w.adapter.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-4 px-4 md:px-8">
        <div className="flex items-center gap-3 sm:gap-6 md:gap-8">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-wide">
            <Logo />
            <span className="mono">LEASH</span>
          </Link>
          <nav aria-label="Main" className="flex items-center gap-4 text-sm text-muted md:gap-6">
            <Link href={`/console/${DEMO_VAULT}`} className="hover:text-ink">
              Console
            </Link>
            <Link href="/create" className="hover:text-ink">
              Create
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="eyebrow hidden items-center gap-2 border border-line px-2 py-1 md:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-pending" aria-hidden="true" />
            Devnet
          </span>
          <Tour />
          <WalletMenu />
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mono mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-muted md:px-8">
        <span>Devnet only. Test tokens, no real funds.</span>
        <a href={addressUrl(PROGRAM)} target="_blank" rel="noreferrer" className="hover:text-ink">
          Program {short(PROGRAM)}
        </a>
      </div>
    </footer>
  );
}
