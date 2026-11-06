import * as anchor from "@anchor-lang/core";
import { BN, BorshCoder, EventParser, Program } from "@anchor-lang/core";
import { createAssociatedTokenAccount, createMint, getAccount, mintTo } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction } from "@solana/web3.js";
import { expect } from "chai";
import { Leash } from "../target/types/leash";

const USDC = (n: number) => new BN(n * 1_000_000);
const FAR_FUTURE = () => new BN(Math.floor(Date.now() / 1000) + 86_400);
// Set both: rpc options replace the provider defaults, and with no preflightCommitment
// the simulation runs against a bank too old to know the fresh blockhash.
const CONFIRMED = { commitment: "confirmed", preflightCommitment: "confirmed" } as const;

describe("leash", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.leash as Program<Leash>;
  const connection = provider.connection;
  const payer = (provider.wallet as anchor.Wallet).payer;
  const parser = new EventParser(program.programId, new BorshCoder(program.idl));
  let mint: PublicKey;

  const pda = (...seeds: (string | PublicKey)[]) =>
    PublicKey.findProgramAddressSync(
      seeds.map((s) => (typeof s === "string" ? Buffer.from(s) : s.toBuffer())),
      program.programId
    )[0];

  async function funded(): Promise<Keypair> {
    const kp = Keypair.generate();
    const sig = await connection.requestAirdrop(kp.publicKey, 10 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
    return kp;
  }

  /** A fresh owner holding 1000 dUSDC, with an initialized vault. */
  async function newVault(withDevice = true) {
    const owner = await funded();
    const agent = Keypair.generate();
    const guard = Keypair.generate();
    const device = withDevice ? await funded() : null;
    const vault = pda("vault", owner.publicKey);
    const vaultToken = pda("vault_token", vault);
    const ownerToken = await createAssociatedTokenAccount(
      connection,
      payer,
      mint,
      owner.publicKey,
      CONFIRMED
    );
    await mintTo(connection, payer, mint, ownerToken, payer, 1000 * 1_000_000, [], CONFIRMED);
    const initSig = await program.methods
      .initVault(agent.publicKey, guard.publicKey, device?.publicKey ?? null)
      .accountsPartial({ owner: owner.publicKey, vault, mint, vaultTokenAccount: vaultToken })
      .signers([owner])
      .rpc(CONFIRMED);
    return { owner, agent, guard, device, vault, vaultToken, ownerToken, initSig };
  }

  type Ctx = Awaited<ReturnType<typeof newVault>>;

  const deposit = (v: Ctx, amount: BN) =>
    program.methods
      .deposit(amount)
      .accountsPartial({
        owner: v.owner.publicKey,
        vault: v.vault,
        mint,
        ownerTokenAccount: v.ownerToken,
        vaultTokenAccount: v.vaultToken,
      })
      .signers([v.owner])
      .rpc(CONFIRMED);

  const setMandate = (v: Ctx, low: BN, perTx: BN, daily: BN, expiresAt: BN = FAR_FUTURE()) =>
    program.methods
      .setMandate({ lowThreshold: low, perTxMax: perTx, dailyCap: daily, expiresAt })
      .accountsPartial({
        owner: v.owner.publicKey,
        vault: v.vault,
        mandate: pda("mandate", v.vault),
      })
      .signers([v.owner])
      .rpc(CONFIRMED);

  const rotate = (
    v: Ctx,
    keys: { agent?: PublicKey; guard?: PublicKey; device?: PublicKey },
    signer: Keypair = v.owner
  ) =>
    program.methods
      .rotateKeys(keys.agent ?? null, keys.guard ?? null, keys.device ?? null)
      .accountsPartial({ owner: signer.publicKey, vault: v.vault })
      .signers([signer])
      .rpc(CONFIRMED);

  const revoke = (v: Ctx, signer: Keypair) =>
    program.methods
      .revokeAgent()
      .accountsPartial({ authority: signer.publicKey, vault: v.vault })
      .signers([signer])
      .rpc(CONFIRMED);

  const unpause = (v: Ctx, signer: Keypair = v.owner) =>
    program.methods
      .unpause()
      .accountsPartial({ owner: signer.publicKey, vault: v.vault })
      .signers([signer])
      .rpc(CONFIRMED);

  const withdraw = (v: Ctx, amount: BN, signer: Keypair = v.owner, to: PublicKey = v.ownerToken) =>
    program.methods
      .withdraw(amount)
      .accountsPartial({
        owner: signer.publicKey,
        vault: v.vault,
        mint,
        ownerTokenAccount: to,
        vaultTokenAccount: v.vaultToken,
      })
      .signers([signer])
      .rpc(CONFIRMED);

  const addRecipient = (v: Ctx, recipient: PublicKey, signer: Keypair = v.owner) =>
    program.methods
      .addRecipient(recipient, Array.from(Buffer.alloc(32, 7)), USDC(50))
      .accountsPartial({
        owner: signer.publicKey,
        vault: v.vault,
        allowEntry: pda("allow", v.vault, recipient),
      })
      .signers([signer])
      .rpc(CONFIRMED);

  const balance = async (account: PublicKey) => (await getAccount(connection, account)).amount;

  async function expectError(attempt: Promise<unknown>, code: string) {
    let error: any;
    try {
      await attempt;
    } catch (e) {
      error = e;
    }
    expect(error, `expected ${code}, but the transaction succeeded`).to.exist;
    expect(error.error?.errorCode?.code, String(error)).to.equal(code);
  }

  async function expectEvent(signature: string, name: string) {
    const tx = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    const names = [...parser.parseLogs(tx!.meta!.logMessages!)].map((e) => e.name);
    expect(names).to.include(name);
  }

  before(async () => {
    mint = await createMint(connection, payer, payer.publicKey, null, 6, undefined, CONFIRMED); // dUSDC
  });

  describe("init_vault", () => {
    it("stores the keys and creates a vault-owned token account", async () => {
      const v = await newVault();
      const vault = await program.account.vault.fetch(v.vault);
      expect(vault.owner.toBase58()).to.equal(v.owner.publicKey.toBase58());
      expect(vault.agent.toBase58()).to.equal(v.agent.publicKey.toBase58());
      expect(vault.guard.toBase58()).to.equal(v.guard.publicKey.toBase58());
      expect(vault.device!.toBase58()).to.equal(v.device!.publicKey.toBase58());
      expect(vault.mint.toBase58()).to.equal(mint.toBase58());
      expect(vault.vaultTokenAccount.toBase58()).to.equal(v.vaultToken.toBase58());
      expect(vault.paused).to.equal(false);
      expect(vault.pendingNonce.toNumber()).to.equal(0);

      const token = await getAccount(connection, v.vaultToken);
      expect(token.owner.toBase58()).to.equal(v.vault.toBase58());
      expect(token.mint.toBase58()).to.equal(mint.toBase58());
      await expectEvent(v.initSig, "vaultInitialized");
    });

    it("second_vault_for_same_owner_rejected", async () => {
      const v = await newVault();
      let failed = false;
      try {
        await program.methods
          .initVault(v.agent.publicKey, v.guard.publicKey, null)
          .accountsPartial({
            owner: v.owner.publicKey,
            vault: v.vault,
            mint,
            vaultTokenAccount: v.vaultToken,
          })
          .signers([v.owner])
          .rpc();
      } catch {
        failed = true;
      }
      expect(failed).to.equal(true);
    });
  });

  describe("set_mandate", () => {
    it("creates the mandate", async () => {
      const v = await newVault();
      const expiresAt = FAR_FUTURE();
      const sig = await setMandate(v, USDC(10), USDC(100), USDC(500), expiresAt);
      const m = await program.account.mandate.fetch(pda("mandate", v.vault));
      expect(m.lowThreshold.toString()).to.equal(USDC(10).toString());
      expect(m.perTxMax.toString()).to.equal(USDC(100).toString());
      expect(m.dailyCap.toString()).to.equal(USDC(500).toString());
      expect(m.expiresAt.toString()).to.equal(expiresAt.toString());
      expect(m.spentToday.toNumber()).to.equal(0);
      expect(m.windowStart.toNumber()).to.be.greaterThan(0);
      await expectEvent(sig, "mandateSet");
    });

    // TODO(phase 2): assert a nonzero spent_today survives, once agent_execute can spend.
    it("update changes limits but keeps the spending window", async () => {
      const v = await newVault();
      await setMandate(v, USDC(10), USDC(100), USDC(500));
      const before = await program.account.mandate.fetch(pda("mandate", v.vault));
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await setMandate(v, USDC(1), USDC(2), USDC(3));
      const after = await program.account.mandate.fetch(pda("mandate", v.vault));
      expect(after.dailyCap.toString()).to.equal(USDC(3).toString());
      expect(after.windowStart.toString()).to.equal(before.windowStart.toString());
      expect(after.spentToday.toString()).to.equal(before.spentToday.toString());
    });

    it("non_owner_cannot_set_mandate", async () => {
      const v = await newVault();
      const attacker = await funded();
      await expectError(
        program.methods
          .setMandate({
            lowThreshold: USDC(1),
            perTxMax: USDC(1_000_000),
            dailyCap: USDC(1_000_000),
            expiresAt: FAR_FUTURE(),
          })
          .accountsPartial({
            owner: attacker.publicKey,
            vault: v.vault,
            mandate: pda("mandate", v.vault),
          })
          .signers([attacker])
          .rpc(),
        "Unauthorized"
      );
    });

    it("invalid_mandate_thresholds_rejected", async () => {
      const v = await newVault();
      await expectError(setMandate(v, USDC(101), USDC(100), USDC(500)), "InvalidMandate");
      await expectError(setMandate(v, USDC(10), USDC(501), USDC(500)), "InvalidMandate");
    });

    it("already_expired_mandate_rejected", async () => {
      const v = await newVault();
      await expectError(setMandate(v, USDC(1), USDC(2), USDC(3), new BN(1)), "InvalidMandate");
    });
  });

  describe("allowlist", () => {
    it("adds a recipient", async () => {
      const v = await newVault();
      const recipient = Keypair.generate().publicKey;
      const sig = await addRecipient(v, recipient);
      const entry = await program.account.allowEntry.fetch(pda("allow", v.vault, recipient));
      expect(entry.recipient.toBase58()).to.equal(recipient.toBase58());
      expect(entry.perRecipientCap.toString()).to.equal(USDC(50).toString());
      expect(entry.label).to.deep.equal(Array.from(Buffer.alloc(32, 7)));
      await expectEvent(sig, "recipientAdded");
    });

    it("removes a recipient and refunds rent to the owner", async () => {
      const v = await newVault();
      const recipient = Keypair.generate().publicKey;
      const allowEntry = pda("allow", v.vault, recipient);
      await addRecipient(v, recipient);
      const before = await connection.getBalance(v.owner.publicKey, "confirmed");
      const sig = await program.methods
        .removeRecipient(recipient)
        .accountsPartial({ owner: v.owner.publicKey, vault: v.vault, allowEntry })
        .signers([v.owner])
        .rpc(CONFIRMED);
      expect(await connection.getAccountInfo(allowEntry, "confirmed")).to.equal(null);
      expect(await connection.getBalance(v.owner.publicKey, "confirmed")).to.be.greaterThan(before);
      await expectEvent(sig, "recipientRemoved");
    });

    it("non_owner_cannot_add_recipient", async () => {
      const v = await newVault();
      const attacker = await funded();
      await expectError(addRecipient(v, attacker.publicKey, attacker), "Unauthorized");
    });

    it("non_owner_cannot_remove_recipient", async () => {
      const v = await newVault();
      const attacker = await funded();
      const recipient = Keypair.generate().publicKey;
      await addRecipient(v, recipient);
      await expectError(
        program.methods
          .removeRecipient(recipient)
          .accountsPartial({
            owner: attacker.publicKey,
            vault: v.vault,
            allowEntry: pda("allow", v.vault, recipient),
          })
          .signers([attacker])
          .rpc(),
        "Unauthorized"
      );
    });
  });

  describe("deposit and withdraw", () => {
    it("deposit moves funds into the vault", async () => {
      const v = await newVault();
      const sig = await deposit(v, USDC(100));
      expect(await balance(v.vaultToken)).to.equal(100_000_000n);
      expect(await balance(v.ownerToken)).to.equal(900_000_000n);
      await expectEvent(sig, "deposited");
    });

    it("withdraw returns funds to the owner", async () => {
      const v = await newVault();
      await deposit(v, USDC(100));
      const sig = await withdraw(v, USDC(40));
      expect(await balance(v.vaultToken)).to.equal(60_000_000n);
      expect(await balance(v.ownerToken)).to.equal(940_000_000n);
      await expectEvent(sig, "withdrawn");
    });

    it("zero_amount_rejected", async () => {
      const v = await newVault();
      await expectError(deposit(v, new BN(0)), "InvalidAmount");
      await expectError(withdraw(v, new BN(0)), "InvalidAmount");
    });

    it("non_owner_cannot_withdraw", async () => {
      const v = await newVault();
      await deposit(v, USDC(100));
      const attacker = await funded();
      const attackerToken = await createAssociatedTokenAccount(
        connection,
        payer,
        mint,
        attacker.publicKey,
        CONFIRMED
      );
      await expectError(withdraw(v, USDC(100), attacker, attackerToken), "Unauthorized");
      expect(await balance(v.vaultToken)).to.equal(100_000_000n);
    });

    it("owner_cannot_withdraw_to_someone_elses_account", async () => {
      const v = await newVault();
      await deposit(v, USDC(100));
      const other = await funded();
      const otherToken = await createAssociatedTokenAccount(
        connection,
        payer,
        mint,
        other.publicKey,
        CONFIRMED
      );
      await expectError(withdraw(v, USDC(1), v.owner, otherToken), "ConstraintTokenOwner");
    });

    it("owner_can_withdraw_while_paused", async () => {
      const v = await newVault();
      await deposit(v, USDC(100));
      await revoke(v, v.owner);
      await withdraw(v, USDC(100));
      expect(await balance(v.vaultToken)).to.equal(0n);
    });
  });

  describe("revoke_agent and unpause", () => {
    it("owner can revoke and unpause", async () => {
      const v = await newVault();
      const revokeSig = await revoke(v, v.owner);
      expect((await program.account.vault.fetch(v.vault)).paused).to.equal(true);
      await expectEvent(revokeSig, "agentRevoked");

      const unpauseSig = await unpause(v);
      expect((await program.account.vault.fetch(v.vault)).paused).to.equal(false);
      await expectEvent(unpauseSig, "vaultUnpaused");
    });

    it("device_can_revoke", async () => {
      const v = await newVault();
      await revoke(v, v.device!);
      expect((await program.account.vault.fetch(v.vault)).paused).to.equal(true);
    });

    it("random_key_cannot_revoke", async () => {
      const v = await newVault();
      const attacker = await funded();
      await expectError(revoke(v, attacker), "Unauthorized");
      expect((await program.account.vault.fetch(v.vault)).paused).to.equal(false);
    });

    it("agent_cannot_revoke", async () => {
      const v = await newVault();
      await expectError(revoke(v, v.agent), "Unauthorized");
    });

    it("revoke_without_device_is_owner_only", async () => {
      const v = await newVault(false);
      const attacker = await funded();
      await expectError(revoke(v, attacker), "Unauthorized");
      await revoke(v, v.owner);
      expect((await program.account.vault.fetch(v.vault)).paused).to.equal(true);
    });

    it("device_cannot_unpause", async () => {
      const v = await newVault();
      await revoke(v, v.device!);
      await expectError(unpause(v, v.device!), "Unauthorized");
      expect((await program.account.vault.fetch(v.vault)).paused).to.equal(true);
    });
  });

  describe("rotate_keys", () => {
    it("rotating_agent_requires_pause", async () => {
      const v = await newVault();
      await expectError(rotate(v, { agent: Keypair.generate().publicKey }), "VaultNotPaused");
      const vault = await program.account.vault.fetch(v.vault);
      expect(vault.agent.toBase58()).to.equal(v.agent.publicKey.toBase58());
    });

    // TODO(phase 2): also assert agent_execute rejects the leaked key. It does not exist yet.
    it("leaked_agent_key_useless_after_rotate", async () => {
      const v = await newVault();
      await deposit(v, USDC(100));
      const leaked = v.agent;
      const fresh = Keypair.generate();

      await revoke(v, v.device!);
      const sig = await rotate(v, { agent: fresh.publicKey });
      await unpause(v);
      await expectEvent(sig, "keysRotated");

      const vault = await program.account.vault.fetch(v.vault);
      expect(vault.paused).to.equal(false);
      expect(vault.agent.toBase58()).to.equal(fresh.publicKey.toBase58());

      // The vault is live again, and the leaked key has no authority over it.
      await expectError(rotate(v, { agent: leaked.publicKey }, leaked), "Unauthorized");
      await expectError(unpause(v, leaked), "Unauthorized");
      await expectError(revoke(v, leaked), "Unauthorized");
      const leakedToken = await createAssociatedTokenAccount(
        connection,
        payer,
        mint,
        leaked.publicKey,
        CONFIRMED
      );
      await expectError(withdraw(v, USDC(100), leaked, leakedToken), "Unauthorized");
      expect(await balance(v.vaultToken)).to.equal(100_000_000n);
    });

    it("non_owner_cannot_rotate_keys", async () => {
      const v = await newVault();
      const attacker = await funded();
      await revoke(v, v.owner);
      await expectError(rotate(v, { agent: attacker.publicKey }, attacker), "Unauthorized");
      await expectError(rotate(v, { guard: attacker.publicKey }, attacker), "Unauthorized");
      await expectError(rotate(v, { device: attacker.publicKey }, attacker), "Unauthorized");
      const vault = await program.account.vault.fetch(v.vault);
      expect(vault.agent.toBase58()).to.equal(v.agent.publicKey.toBase58());
    });

    it("device_cannot_rotate_keys", async () => {
      const v = await newVault();
      await expectError(rotate(v, { device: v.device!.publicKey }, v.device!), "Unauthorized");
    });

    it("guard and device rotate without a pause, omitted keys stay", async () => {
      const v = await newVault();
      const newGuard = Keypair.generate().publicKey;
      const newDevice = await funded();
      await rotate(v, { guard: newGuard, device: newDevice.publicKey });
      const vault = await program.account.vault.fetch(v.vault);
      expect(vault.guard.toBase58()).to.equal(newGuard.toBase58());
      expect(vault.device!.toBase58()).to.equal(newDevice.publicKey.toBase58());
      expect(vault.agent.toBase58()).to.equal(v.agent.publicKey.toBase58());

      await expectError(revoke(v, v.device!), "Unauthorized");
      await revoke(v, newDevice);
    });

    // Anchor's TS coder encodes null as the outer None, so it cannot express Some(None).
    // The instruction data ends in that option's byte: patch 0x00 to 0x01 0x00.
    it("owner can remove the device key", async () => {
      const v = await newVault();
      const ix = await program.methods
        .rotateKeys(null, null, null)
        .accountsPartial({ owner: v.owner.publicKey, vault: v.vault })
        .instruction();
      ix.data = Buffer.concat([ix.data.subarray(0, ix.data.length - 1), Buffer.from([1, 0])]);
      await provider.sendAndConfirm!(new Transaction().add(ix), [v.owner], CONFIRMED);

      const vault = await program.account.vault.fetch(v.vault);
      expect(vault.device).to.equal(null);
      await expectError(revoke(v, v.device!), "Unauthorized");
    });
  });
});
