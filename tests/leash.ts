import { BN } from "@anchor-lang/core";
import { getAccount } from "@solana/spl-token";
import { Keypair, Transaction } from "@solana/web3.js";
import { expect } from "chai";
import { patchClearDevice } from "../packages/sdk/src/tier";
import {
  addRecipient,
  balance,
  clockNow,
  closeVault,
  CONFIRMED,
  connection,
  deposit,
  expectError,
  eventOf,
  expectEvent,
  FAR_FUTURE,
  funded,
  mint,
  newVault,
  pda,
  pendingPda,
  program,
  provider,
  REASON,
  revoke,
  rotate,
  setMandate,
  tokenAccount,
  unpause,
  USDC,
  waitForClock,
  withdraw,
} from "./helpers";

describe("leash", () => {
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
      expect(vault.pendingNonce.toString()).to.equal(vault.pendingBase.toString());
      expect(vault.pendingBase.gtn(0)).to.equal(true);

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

  describe("key separation", () => {
    const init = (
      owner: Keypair,
      agent: Keypair,
      guard: Keypair,
      device: Keypair | null = null
    ) => {
      const vault = pda("vault", owner.publicKey);
      return program.methods
        .initVault(agent.publicKey, guard.publicKey, device?.publicKey ?? null)
        .accountsPartial({
          owner: owner.publicKey,
          vault,
          mint,
          vaultTokenAccount: pda("vault_token", vault),
        })
        .signers([owner])
        .rpc(CONFIRMED);
    };

    it("agent_equal_guard_rejected", async () => {
      const owner = await funded();
      const key = Keypair.generate();
      await expectError(init(owner, key, key), "KeyReuseNotAllowed");
    });

    it("agent_equal_owner_rejected", async () => {
      const owner = await funded();
      await expectError(init(owner, owner, Keypair.generate()), "KeyReuseNotAllowed");
    });

    it("guard_equal_owner_rejected", async () => {
      const owner = await funded();
      await expectError(init(owner, Keypair.generate(), owner), "KeyReuseNotAllowed");
    });

    it("device_equal_agent_or_guard_rejected", async () => {
      const owner = await funded();
      const agent = Keypair.generate();
      const guard = Keypair.generate();
      await expectError(init(owner, agent, guard, agent), "KeyReuseNotAllowed");
      await expectError(init(owner, agent, guard, guard), "KeyReuseNotAllowed");
    });

    it("rotate_to_reused_key_rejected", async () => {
      const v = await newVault();
      const owner = v.owner.publicKey;
      await revoke(v, v.owner);
      await expectError(rotate(v, { agent: v.guard.publicKey }), "KeyReuseNotAllowed");
      await expectError(rotate(v, { agent: owner }), "KeyReuseNotAllowed");
      await expectError(rotate(v, { guard: v.agent.publicKey }), "KeyReuseNotAllowed");
      await expectError(rotate(v, { guard: owner }), "KeyReuseNotAllowed");
      await expectError(rotate(v, { device: v.agent.publicKey }), "KeyReuseNotAllowed");
      await expectError(rotate(v, { device: v.guard.publicKey }), "KeyReuseNotAllowed");

      const vault = await program.account.vault.fetch(v.vault);
      expect(vault.agent.toBase58()).to.equal(v.agent.publicKey.toBase58());
      expect(vault.guard.toBase58()).to.equal(v.guard.publicKey.toBase58());
    });
  });

  describe("set_mandate", () => {
    it("creates the mandate", async () => {
      const v = await newVault();
      const expiresAt = FAR_FUTURE();
      const sig = await setMandate(v, USDC(10), USDC(100), USDC(500), { expiresAt });
      const m = await program.account.mandate.fetch(pda("mandate", v.vault));
      expect(m.lowThreshold.toString()).to.equal(USDC(10).toString());
      expect(m.perTxMax.toString()).to.equal(USDC(100).toString());
      expect(m.dailyCap.toString()).to.equal(USDC(500).toString());
      expect(m.expiresAt.toString()).to.equal(expiresAt.toString());
      expect(m.spentToday.toNumber()).to.equal(0);
      expect(m.windowStart.toNumber()).to.be.greaterThan(0);
      await expectEvent(sig, "mandateSet");
    });

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
            windowSecs: null,
            pendingTtlSecs: null,
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
      await expectError(
        setMandate(v, USDC(1), USDC(2), USDC(3), { expiresAt: new BN(1) }),
        "InvalidMandate"
      );
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
      const attackerToken = await tokenAccount(attacker.publicKey);
      await expectError(withdraw(v, USDC(100), attacker, attackerToken), "Unauthorized");
      expect(await balance(v.vaultToken)).to.equal(100_000_000n);
    });

    it("owner_cannot_withdraw_to_someone_elses_account", async () => {
      const v = await newVault();
      await deposit(v, USDC(100));
      const other = await funded();
      const otherToken = await tokenAccount(other.publicKey);
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

  describe("close_vault", () => {
    /** An active vault with a mandate, 100 dUSDC and one allowlisted recipient. */
    const ready = async () => {
      const v = await newVault();
      await setMandate(v, USDC(1), USDC(2), USDC(3));
      await deposit(v, USDC(100));
      const recipient = Keypair.generate().publicKey;
      await addRecipient(v, recipient);
      return { v, allow: pda("allow", v.vault, recipient) };
    };

    const recreate = (v: Awaited<ReturnType<typeof newVault>>) =>
      program.methods
        .initVault(v.agent.publicKey, v.guard.publicKey, v.device!.publicKey)
        .accountsPartial({
          owner: v.owner.publicKey,
          vault: v.vault,
          mint,
          vaultTokenAccount: v.vaultToken,
        })
        .signers([v.owner])
        .rpc(CONFIRMED);

    const propose = async (v: Awaited<ReturnType<typeof newVault>>, recipient: Keypair) => {
      const { pendingNonce: nonce } = await program.account.vault.fetch(v.vault);
      await program.methods
        .agentPropose(USDC(5), recipient.publicKey, REASON)
        .accountsPartial({
          agent: v.agent.publicKey,
          vault: v.vault,
          mandate: pda("mandate", v.vault),
          pendingAction: pendingPda(v.vault, nonce),
        })
        .signers([v.agent])
        .rpc(CONFIRMED);
      return nonce;
    };

    /** Closes with a pending action left behind, recreates, and returns what is needed to probe it. */
    const staleProposal = async () => {
      const { v, allow } = await ready();
      await connection
        .requestAirdrop(v.agent.publicKey, 1e9)
        .then((sig) => connection.confirmTransaction(sig, "confirmed"));
      const nonce = await propose(v, v.device!);
      await revoke(v, v.owner);
      await closeVault(v, v.owner, [allow]);
      // pending_base has one-second resolution, and no real close and recreate is faster.
      await waitForClock((await clockNow()) + 2);
      await recreate(v);
      await setMandate(v, USDC(1), USDC(2), USDC(3));
      await deposit(v, USDC(100));
      return { v, nonce };
    };

    it("non_owner_cannot_close", async () => {
      const { v, allow } = await ready();
      await revoke(v, v.owner);
      const attacker = await funded();
      const attackerToken = await tokenAccount(attacker.publicKey);
      await expectError(closeVault(v, attacker, [allow], attackerToken), "Unauthorized");
      await expectError(closeVault(v, v.device!, [allow], attackerToken), "Unauthorized");
      expect(await balance(v.vaultToken)).to.equal(100_000_000n);
    });

    it("cannot_close_active_vault", async () => {
      const { v, allow } = await ready();
      await expectError(closeVault(v, v.owner, [allow]), "VaultNotPaused");
      expect(await balance(v.vaultToken)).to.equal(100_000_000n);
    });

    it("close_returns_funds_and_rent", async () => {
      const { v, allow } = await ready();
      await revoke(v, v.owner);
      const before = await connection.getBalance(v.owner.publicKey, "confirmed");
      const mandate = pda("mandate", v.vault);
      const rents = await Promise.all(
        [v.vault, mandate, v.vaultToken, allow].map((a) => connection.getBalance(a, "confirmed"))
      );

      const sig = await closeVault(v, v.owner, [allow]);

      expect(await balance(v.ownerToken)).to.equal(1000_000_000n);
      for (const account of [v.vault, mandate, v.vaultToken, allow]) {
        expect(await connection.getAccountInfo(account, "confirmed")).to.equal(null);
      }
      const after = await connection.getBalance(v.owner.publicKey, "confirmed");
      const rent = rents.reduce((sum, r) => sum + r, 0);
      expect(after).to.be.at.least(before + rent - 10_000);
      const event = await eventOf(sig, "vaultClosed");
      expect(event.returned.toString()).to.equal("100000000");
    });

    it("close_rejects_foreign_allow_entry", async () => {
      const { v, allow } = await ready();
      const other = await ready();
      await revoke(v, v.owner);
      await expectError(closeVault(v, v.owner, [other.allow]), "InvalidRemainingAccount");
      await expectError(closeVault(v, v.owner, [v.vault]), "InvalidRemainingAccount");
      expect(await connection.getAccountInfo(other.allow, "confirmed")).to.not.equal(null);
      await closeVault(v, v.owner, [allow]);
    });

    it("owner_can_recreate_vault_after_close", async () => {
      const { v, allow } = await ready();
      await revoke(v, v.owner);
      await closeVault(v, v.owner, [allow]);

      await recreate(v);
      await setMandate(v, USDC(1), USDC(2), USDC(3));
      await deposit(v, USDC(10));

      const vault = await program.account.vault.fetch(v.vault);
      expect(vault.paused).to.equal(false);
      expect(vault.pendingNonce.toString()).to.equal(vault.pendingBase.toString());
      expect(await balance(v.vaultToken)).to.equal(10_000_000n);
    });

    it("stale_pending_cannot_be_decided_after_recreate", async () => {
      const { v, nonce } = await staleProposal();
      const pendingAction = pendingPda(v.vault, nonce);
      expect((await program.account.vault.fetch(v.vault)).pendingBase.gt(nonce)).to.equal(true);

      await expectError(
        program.methods
          .rejectPending(nonce)
          .accountsPartial({ authority: v.owner.publicKey, vault: v.vault, pendingAction })
          .signers([v.owner])
          .rpc(CONFIRMED),
        "PendingNotActive"
      );
      const recipientToken = await tokenAccount(v.device!.publicKey);
      await expectError(
        program.methods
          .approvePending(nonce)
          .accountsPartial({
            authority: v.owner.publicKey,
            vault: v.vault,
            mandate: pda("mandate", v.vault),
            pendingAction,
            mint,
            vaultTokenAccount: v.vaultToken,
            recipientTokenAccount: recipientToken,
          })
          .signers([v.owner])
          .rpc(CONFIRMED),
        "PendingNotActive"
      );
      expect(await balance(v.vaultToken)).to.equal(100_000_000n);
      expect(await balance(recipientToken)).to.equal(0n);
    });

    it("stale_pending_can_be_closed_and_proposals_still_work", async () => {
      const { v, nonce } = await staleProposal();
      const pendingAction = pendingPda(v.vault, nonce);
      await program.methods
        .closePending(nonce)
        .accountsPartial({ owner: v.owner.publicKey, vault: v.vault, pendingAction })
        .signers([v.owner])
        .rpc(CONFIRMED);
      expect(await connection.getAccountInfo(pendingAction, "confirmed")).to.equal(null);

      const next = await propose(v, v.device!);
      expect(next.gt(nonce)).to.equal(true);
    });
  });

  describe("rotate_keys", () => {
    it("rotating_agent_requires_pause", async () => {
      const v = await newVault();
      await expectError(rotate(v, { agent: Keypair.generate().publicKey }), "VaultNotPaused");
      const vault = await program.account.vault.fetch(v.vault);
      expect(vault.agent.toBase58()).to.equal(v.agent.publicKey.toBase58());
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

    it("owner can remove the device key", async () => {
      const v = await newVault();
      const ix = await program.methods
        .rotateKeys(null, null, null)
        .accountsPartial({ owner: v.owner.publicKey, vault: v.vault })
        .instruction();
      await provider.sendAndConfirm!(
        new Transaction().add(patchClearDevice(ix)),
        [v.owner],
        CONFIRMED
      );

      const vault = await program.account.vault.fetch(v.vault);
      expect(vault.device).to.equal(null);
      await expectError(revoke(v, v.device!), "Unauthorized");
    });
  });
});
