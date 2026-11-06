"use client";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { type ReactNode, useMemo } from "react";
import { RPC_URL } from "@/lib/chain";
import { DevBurnerAdapter } from "@/lib/dev-burner";

// An empty list: Phantom, MetaMask and the rest arrive through Wallet Standard.
export function Providers({ children }: { children: ReactNode }) {
  const wallets = useMemo(() => {
    const key = process.env.NEXT_PUBLIC_DEV_BURNER_KEY;
    return key ? [new DevBurnerAdapter(key)] : [];
  }, []);
  return (
    <ConnectionProvider endpoint={RPC_URL} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={wallets} autoConnect>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}
