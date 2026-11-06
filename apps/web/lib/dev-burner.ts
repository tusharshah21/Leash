// A throwaway devnet wallet for testing the flows without a browser extension. Only loaded when
// NEXT_PUBLIC_DEV_BURNER_KEY is set, in a local .env.local. Never set that on a deployed site.
import {
  BaseSignerWalletAdapter,
  type WalletName,
  WalletReadyState,
} from "@solana/wallet-adapter-base";
import { Keypair, type Transaction, type VersionedTransaction } from "@solana/web3.js";

export class DevBurnerAdapter extends BaseSignerWalletAdapter {
  name = "Dev burner" as WalletName<"Dev burner">;
  url = "https://github.com/tusharshah21/Leash";
  icon =
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCI+PHJlY3Qgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0IiBmaWxsPSIjRkZCMDIwIi8+PC9zdmc+";
  readyState = WalletReadyState.Loadable;
  supportedTransactionVersions = null;
  private keypair: Keypair | null = null;
  private secret: string;

  constructor(secret: string) {
    super();
    this.secret = secret;
  }

  get publicKey() {
    return this.keypair?.publicKey ?? null;
  }
  get connecting() {
    return false;
  }

  async connect() {
    this.keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(this.secret)));
    this.emit("connect", this.keypair.publicKey);
  }

  async disconnect() {
    this.keypair = null;
    this.emit("disconnect");
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if (!this.keypair) throw new Error("Not connected");
    (tx as Transaction).partialSign(this.keypair);
    return tx;
  }
}
