import { BN } from "@anchor-lang/core";
import { Keypair, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import { classifyTier, Tier } from "../packages/sdk/src/tier";
import {
  addRecipient,
  balance,
  clockNow,
  computeUnits,
  CONFIRMED,
  connection,
  Ctx,
  deposit,
  eventOf,
  expectError,
  fund,
  funded,
  mint,
  newVault,
  pda,
  pendingPda,
  program,
  REASON,
  revoke,
  rotate,
  setMandate,
  slowIt,
  tokenAccount,
  unpause,
  units,
  USDC,
  waitForClock,
  withdraw,
} from "./helpers";

const LOW = 10;
const PER_TX = 100;
const DAILY = 150;
const VAULT_BALANCE = 500;

/** A funded vault with a mandate of low 10, per-tx 100, daily 150, and one allowlisted recipient. */
async function armed(mandateOpts: Parameters<typeof setMandate>[4] = {}) {
  const v = await newVault();
  await fund(v.agent.publicKey); // agent_propose pays rent
  await deposit(v, USDC(VAULT_BALANCE));
  await setMandate(v, USDC(LOW), USDC(PER_TX), USDC(DAILY), mandateOpts);
  const recipient = Keypair.generate().publicKey;
  const recipientToken = await tokenAccount(recipient);
  await addRecipient(v, recipient, v.owner, USDC(PER_TX));
  return { ...v, recipient, recipientToken };
}
type Armed = Awaited<ReturnType<typeof armed>>;

const execute = (
  v: Ctx,
  recipientOwner: PublicKey,
  recipientToken: PublicKey,
  amount: BN,
  opts: { guard?: Keypair; signer?: Keypair; allowEntry?: PublicKey } = {}
) => {
  const signer = opts.signer ?? v.agent;
  return program.methods
    .agentExecute(amount, REASON)
    .accountsPartial({
      agent: signer.publicKey,
      guard: opts.guard?.publicKey ?? null,
      vault: v.vault,
      mandate: pda("mandate", v.vault),
      mint,
      vaultTokenAccount: v.vaultToken,
      recipientTokenAccount: recipientToken,
      allowEntry: opts.allowEntry ?? pda("allow", v.vault, recipientOwner),
    })
    .signers(opts.guard ? [signer, opts.guard] : [signer])
    .rpc(CONFIRMED);
};

const pay = (v: Armed, amount: BN, opts: Parameters<typeof execute>[4] = {}) =>
  execute(v, v.recipient, v.recipientToken, amount, opts);

/** Proposes at the vault's current nonce, and returns that nonce. */
async function propose(v: Ctx, amount: BN, recipient: PublicKey, signer: Keypair = v.agent) {
  const { pendingNonce: nonce } = await program.account.vault.fetch(v.vault);
  const sig = await program.methods
    .agentPropose(amount, recipient, REASON)
    .accountsPartial({
      agent: signer.publicKey,
      vault: v.vault,
      mandate: pda("mandate", v.vault),
      pendingAction: pendingPda(v.vault, nonce),
    })
    .signers([signer])
    .rpc(CONFIRMED);
  return { nonce, sig };
}

const approve = (
  v: Armed,
  nonce: BN,
  signer: Keypair = v.owner,
  to: PublicKey = v.recipientToken
) =>
  program.methods
    .approvePending(nonce)
    .accountsPartial({
      authority: signer.publicKey,
      vault: v.vault,
      mandate: pda("mandate", v.vault),
      pendingAction: pendingPda(v.vault, nonce),
      mint,
      vaultTokenAccount: v.vaultToken,
      recipientTokenAccount: to,
    })
    .signers([signer])
    .rpc(CONFIRMED);

const reject = (v: Ctx, nonce: BN, signer: Keypair = v.owner) =>
  program.methods
    .rejectPending(nonce)
    .accountsPartial({
      authority: signer.publicKey,
      vault: v.vault,
      pendingAction: pendingPda(v.vault, nonce),
    })
    .signers([signer])
    .rpc(CONFIRMED);

const closePending = (v: Ctx, nonce: BN, signer: Keypair = v.owner) =>
  program.methods
    .closePending(nonce)
    .accountsPartial({
      owner: signer.publicKey,
      vault: v.vault,
      pendingAction: pendingPda(v.vault, nonce),
    })
    .signers([signer])
    .rpc(CONFIRMED);

const mandateOf = (v: Ctx) => program.account.mandate.fetch(pda("mandate", v.vault));
const pendingOf = (v: Ctx, nonce: BN) =>
  program.account.pendingAction.fetch(pendingPda(v.vault, nonce));

/** Asserts the vault and the armed recipient hold exactly these amounts of dUSDC. */
async function expectFunds(v: Armed, vaultUnits: number, recipientUnits: number) {
  expect(await balance(v.vaultToken)).to.equal(units(vaultUnits));
  expect(await balance(v.recipientToken)).to.equal(units(recipientUnits));
}

/** What the SDK predicts right now for paying `amount` to the armed recipient. */
async function sdkTier(v: Armed, amount: BN, recipient: PublicKey = v.recipient): Promise<Tier> {
  const m = await mandateOf(v);
  const entry = await program.account.allowEntry.fetchNullable(pda("allow", v.vault, recipient));
  const big = (x: BN) => BigInt(x.toString());
  return classifyTier(
    {
      lowThreshold: big(m.lowThreshold),
      perTxMax: big(m.perTxMax),
      dailyCap: big(m.dailyCap),
      windowStart: big(m.windowStart),
      windowSecs: big(m.windowSecs),
    },
    entry ? { perRecipientCap: big(entry.perRecipientCap) } : null,
    big(m.spentToday),
    big(amount),
    BigInt(await clockNow())
  );
}

const computeUnitsSeen: Record<string, number> = {};

describe("Tier routing", () => {
  it("low_tier_pays_with_the_agent_signature_alone", async () => {
    const v = await armed();
    expect(await sdkTier(v, USDC(LOW))).to.equal("LOW");

    const sig = await pay(v, USDC(LOW));

    await expectFunds(v, VAULT_BALANCE - LOW, LOW);
    expect((await mandateOf(v)).spentToday.toString()).to.equal(USDC(LOW).toString());
    const event = await eventOf(sig, "actionExecuted");
    expect(event.tier).to.deep.equal({ low: {} });
    expect(event.amount.toString()).to.equal(USDC(LOW).toString());
    expect(event.recipient.toBase58()).to.equal(v.recipient.toBase58());
    expect(event.reasonHash).to.deep.equal(REASON);
    expect(event.spentToday.toString()).to.equal(USDC(LOW).toString());
    computeUnitsSeen["agent_execute (LOW)"] = await computeUnits(sig);
  });

  it("medium_tier_pays_with_the_guard_signature", async () => {
    const v = await armed();
    expect(await sdkTier(v, USDC(LOW + 1))).to.equal("MEDIUM");

    const sig = await pay(v, USDC(LOW + 1), { guard: v.guard });

    await expectFunds(v, VAULT_BALANCE - LOW - 1, LOW + 1);
    expect((await eventOf(sig, "actionExecuted")).tier).to.deep.equal({ medium: {} });
    computeUnitsSeen["agent_execute (MEDIUM)"] = await computeUnits(sig);
  });

  it("per_tx_max_itself_is_still_medium", async () => {
    const v = await armed();
    expect(await sdkTier(v, USDC(PER_TX))).to.equal("MEDIUM");
    const sig = await pay(v, USDC(PER_TX), { guard: v.guard });
    expect((await eventOf(sig, "actionExecuted")).tier).to.deep.equal({ medium: {} });
    await expectFunds(v, VAULT_BALANCE - PER_TX, PER_TX);
  });

  it("agent_may_escalate_a_low_amount_by_proposing", async () => {
    const v = await armed();
    expect(await sdkTier(v, USDC(1))).to.equal("LOW");
    const { nonce, sig } = await propose(v, USDC(1), v.recipient);
    expect((await eventOf(sig, "actionPending")).nonce.toString()).to.equal(nonce.toString());
    await expectFunds(v, VAULT_BALANCE, 0);
  });

  it("zero_amount_cannot_execute_or_be_proposed", async () => {
    const v = await armed();
    await expectError(pay(v, new BN(0)), "InvalidAmount");
    await expectError(propose(v, new BN(0), v.recipient), "InvalidAmount");
    await expectFunds(v, VAULT_BALANCE, 0);
  });

  it("over_per_recipient_cap_requires_approval", async () => {
    const v = await armed();
    const small = Keypair.generate().publicKey;
    const smallToken = await tokenAccount(small);
    await addRecipient(v, small, v.owner, USDC(20));
    expect(await sdkTier(v, USDC(21), small)).to.equal("HIGH");

    await expectError(
      execute(v, small, smallToken, USDC(21), { guard: v.guard }),
      "RequiresApproval"
    );

    expect(await balance(smallToken)).to.equal(0n);
    expect(await balance(v.vaultToken)).to.equal(units(VAULT_BALANCE));
  });
});

describe("Attacks", () => {
  it("injected_recipient_not_allowlisted_cannot_execute", async () => {
    const v = await armed();
    const attacker = Keypair.generate().publicKey;
    const attackerToken = await tokenAccount(attacker);
    expect(await sdkTier(v, USDC(1), attacker)).to.equal("HIGH");

    await expectError(
      execute(v, attacker, attackerToken, USDC(1), { guard: v.guard }),
      "NotAllowlisted"
    );

    expect(await balance(attackerToken)).to.equal(0n);
    expect(await balance(v.vaultToken)).to.equal(units(VAULT_BALANCE));
  });

  it("injected_recipient_cannot_borrow_another_recipients_allow_entry", async () => {
    const v = await armed();
    const attacker = Keypair.generate().publicKey;
    const attackerToken = await tokenAccount(attacker);

    await expectError(
      execute(v, attacker, attackerToken, USDC(1), {
        allowEntry: pda("allow", v.vault, v.recipient),
      }),
      "ConstraintSeeds"
    );

    expect(await balance(attackerToken)).to.equal(0n);
    expect(await balance(v.vaultToken)).to.equal(units(VAULT_BALANCE));
  });

  it("removed_recipient_cannot_execute", async () => {
    const v = await armed();
    await pay(v, USDC(1));
    await program.methods
      .removeRecipient(v.recipient)
      .accountsPartial({
        owner: v.owner.publicKey,
        vault: v.vault,
        allowEntry: pda("allow", v.vault, v.recipient),
      })
      .signers([v.owner])
      .rpc(CONFIRMED);

    await expectError(pay(v, USDC(1)), "NotAllowlisted");

    await expectFunds(v, VAULT_BALANCE - 1, 1);
  });

  it("injected_recipient_proposal_moves_no_funds", async () => {
    const v = await armed();
    const attacker = Keypair.generate().publicKey;
    const attackerToken = await tokenAccount(attacker);

    const { nonce } = await propose(v, USDC(PER_TX), attacker);

    const pending = await pendingOf(v, nonce);
    expect(pending.status).to.deep.equal({ pending: {} });
    expect(pending.recipient.toBase58()).to.equal(attacker.toBase58());
    expect((await program.account.vault.fetch(v.vault)).pendingNonce.toString()).to.equal(
      nonce.addn(1).toString()
    );
    expect(await balance(attackerToken)).to.equal(0n);
    expect(await balance(v.vaultToken)).to.equal(units(VAULT_BALANCE));
  });

  it("agent_cannot_exceed_per_tx_max_without_approval", async () => {
    const v = await armed();
    expect(await sdkTier(v, USDC(PER_TX + 1))).to.equal("HIGH");
    await expectError(pay(v, USDC(PER_TX + 1), { guard: v.guard }), "RequiresApproval");
    await expectFunds(v, VAULT_BALANCE, 0);
  });

  it("agent_cannot_exceed_daily_cap", async () => {
    const v = await armed();
    await pay(v, USDC(PER_TX), { guard: v.guard });
    await pay(v, USDC(DAILY - PER_TX), { guard: v.guard }); // exactly at the cap is allowed
    expect((await mandateOf(v)).spentToday.toString()).to.equal(USDC(DAILY).toString());
    expect(await sdkTier(v, USDC(1))).to.equal("HIGH");

    await expectError(pay(v, USDC(1)), "ExceedsDailyCap");

    await expectFunds(v, VAULT_BALANCE - DAILY, DAILY);
  });

  slowIt("daily_cap_resets_after_window", async () => {
    const v = await armed({ windowSecs: new BN(60) });
    await pay(v, USDC(PER_TX), { guard: v.guard });
    await pay(v, USDC(DAILY - PER_TX), { guard: v.guard });
    await expectError(pay(v, USDC(1)), "ExceedsDailyCap");

    const before = await mandateOf(v);
    await waitForClock(before.windowStart.toNumber() + 60);
    expect(await sdkTier(v, USDC(1))).to.equal("LOW");

    const sig = await pay(v, USDC(1));

    const after = await mandateOf(v);
    expect(after.spentToday.toString()).to.equal(USDC(1).toString());
    expect(after.windowStart.toNumber()).to.be.greaterThan(before.windowStart.toNumber());
    expect((await eventOf(sig, "actionExecuted")).spentToday.toString()).to.equal(
      USDC(1).toString()
    );
    await expectFunds(v, VAULT_BALANCE - DAILY - 1, DAILY + 1);
  });

  it("set_mandate_preserves_a_nonzero_spent_today", async () => {
    const v = await armed();
    await pay(v, USDC(LOW));
    const before = await mandateOf(v);

    await setMandate(v, USDC(1), USDC(2), USDC(DAILY * 2));

    const after = await mandateOf(v);
    expect(after.spentToday.toString()).to.equal(USDC(LOW).toString());
    expect(after.windowStart.toString()).to.equal(before.windowStart.toString());
    expect(after.dailyCap.toString()).to.equal(USDC(DAILY * 2).toString());
    await expectFunds(v, VAULT_BALANCE - LOW, LOW);
  });

  it("window_and_ttl_below_the_minimum_are_rejected", async () => {
    const v = await armed();
    const low = USDC(LOW);
    await expectError(setMandate(v, low, low, low, { windowSecs: new BN(59) }), "InvalidMandate");
    await expectError(
      setMandate(v, low, low, low, { pendingTtlSecs: new BN(59) }),
      "InvalidMandate"
    );
  });

  it("new_mandate_defaults_to_a_day_for_window_and_ttl", async () => {
    const m = await mandateOf(await armed());
    expect(m.windowSecs.toNumber()).to.equal(86_400);
    expect(m.pendingTtlSecs.toNumber()).to.equal(86_400);
  });

  it("medium_tier_without_guard_signature_fails", async () => {
    const v = await armed();
    await expectError(pay(v, USDC(LOW + 1)), "GuardSignatureRequired");
    await expectFunds(v, VAULT_BALANCE, 0);
  });

  it("fake_guard_signature_fails", async () => {
    const v = await armed();
    await expectError(
      pay(v, USDC(LOW + 1), { guard: Keypair.generate() }),
      "GuardSignatureRequired"
    );
    await expectFunds(v, VAULT_BALANCE, 0);
  });

  it("random_key_cannot_act_as_agent", async () => {
    const v = await armed();
    const attacker = await funded();
    await expectError(pay(v, USDC(1), { signer: attacker }), "Unauthorized");
    await expectError(propose(v, USDC(1), v.recipient, attacker), "Unauthorized");
    await expectFunds(v, VAULT_BALANCE, 0);
  });

  it("stolen_agent_key_after_revoke_cannot_spend", async () => {
    const v = await armed();
    await revoke(v, v.device!);

    await expectError(pay(v, USDC(1)), "VaultPaused");
    await expectError(pay(v, USDC(LOW + 1), { guard: v.guard }), "VaultPaused");
    await expectError(propose(v, USDC(1), v.recipient), "VaultPaused");

    await expectFunds(v, VAULT_BALANCE, 0);
  });

  it("leaked_agent_key_useless_after_rotate", async () => {
    const v = await armed();
    const leaked = v.agent;
    const fresh = await funded();

    await revoke(v, v.device!);
    await rotate(v, { agent: fresh.publicKey });
    await unpause(v);

    const vault = await program.account.vault.fetch(v.vault);
    expect(vault.paused).to.equal(false);
    expect(vault.agent.toBase58()).to.equal(fresh.publicKey.toBase58());

    // The vault is live again, and the leaked key can do nothing with it.
    await expectError(pay(v, USDC(1), { signer: leaked }), "Unauthorized");
    await expectError(propose(v, USDC(1), v.recipient, leaked), "Unauthorized");
    await expectError(rotate(v, { agent: leaked.publicKey }, leaked), "Unauthorized");
    await expectError(unpause(v, leaked), "Unauthorized");
    await expectError(revoke(v, leaked), "Unauthorized");
    const leakedToken = await tokenAccount(leaked.publicKey);
    await expectError(withdraw(v, USDC(1), leaked, leakedToken), "Unauthorized");
    await expectFunds(v, VAULT_BALANCE, 0);
    expect(await balance(leakedToken)).to.equal(0n);

    // The replacement key works.
    await pay(v, USDC(1), { signer: fresh });
    await expectFunds(v, VAULT_BALANCE - 1, 1);
  });

  it("expired_mandate_blocks_agent", async () => {
    const expiresAt = (await clockNow()) + 8;
    const v = await armed({ expiresAt: new BN(expiresAt) });
    await waitForClock(expiresAt);

    await expectError(pay(v, USDC(1)), "MandateExpired");
    await expectError(pay(v, USDC(LOW + 1), { guard: v.guard }), "MandateExpired");
    await expectError(propose(v, USDC(1), v.recipient), "MandateExpired");

    await expectFunds(v, VAULT_BALANCE, 0);
  });

  it("owner_withdraw_still_works_when_paused", async () => {
    const v = await armed();
    await revoke(v, v.device!);
    await withdraw(v, USDC(VAULT_BALANCE));
    expect(await balance(v.vaultToken)).to.equal(0n);
    expect(await balance(v.ownerToken)).to.equal(units(1000));
  });
});

describe("Approvals", () => {
  it("propose_then_approve_pays_the_stored_recipient", async () => {
    const v = await armed();
    const amount = PER_TX + 50; // above what the agent may do alone
    const { nonce, sig: proposeSig } = await propose(v, USDC(amount), v.recipient);
    const proposed = await eventOf(proposeSig, "actionPending");
    expect(proposed.amount.toString()).to.equal(USDC(amount).toString());
    expect(proposed.recipient.toBase58()).to.equal(v.recipient.toBase58());
    expect(proposed.reasonHash).to.deep.equal(REASON);
    await expectFunds(v, VAULT_BALANCE, 0);

    const sig = await approve(v, nonce);

    await expectFunds(v, VAULT_BALANCE - amount, amount);
    expect((await pendingOf(v, nonce)).status).to.deep.equal({ executed: {} });
    expect((await mandateOf(v)).spentToday.toString()).to.equal(USDC(amount).toString());
    const event = await eventOf(sig, "actionApproved");
    expect(event.nonce.toString()).to.equal(nonce.toString());
    expect(event.approver.toBase58()).to.equal(v.owner.publicKey.toBase58());
    computeUnitsSeen["approve_pending"] = await computeUnits(sig);
  });

  it("each_proposal_gets_its_own_nonce", async () => {
    const v = await armed();
    const first = await propose(v, USDC(1), v.recipient);
    const second = await propose(v, USDC(2), v.recipient);
    expect(second.nonce.toString()).to.equal(first.nonce.addn(1).toString());
    await approve(v, second.nonce);
    await expectFunds(v, VAULT_BALANCE - 2, 2);
    expect((await pendingOf(v, first.nonce)).status).to.deep.equal({ pending: {} });
  });

  it("random_key_cannot_approve_pending", async () => {
    const v = await armed();
    const { nonce } = await propose(v, USDC(PER_TX), v.recipient);
    const attacker = await funded();
    await expectError(approve(v, nonce, attacker), "Unauthorized");
    await expectError(reject(v, nonce, attacker), "Unauthorized");
    await expectFunds(v, VAULT_BALANCE, 0);
    expect((await pendingOf(v, nonce)).status).to.deep.equal({ pending: {} });
  });

  it("agent_cannot_approve_its_own_pending", async () => {
    const v = await armed();
    const { nonce } = await propose(v, USDC(PER_TX), v.recipient);
    await expectError(approve(v, nonce, v.agent), "Unauthorized");
    await expectFunds(v, VAULT_BALANCE, 0);
    expect((await pendingOf(v, nonce)).status).to.deep.equal({ pending: {} });
  });

  it("guard_cannot_approve_pending", async () => {
    const v = await armed();
    const { nonce } = await propose(v, USDC(PER_TX), v.recipient);
    await expectError(approve(v, nonce, v.guard), "Unauthorized");
    await expectFunds(v, VAULT_BALANCE, 0);
  });

  it("device_key_can_approve_pending", async () => {
    const v = await armed();
    const { nonce } = await propose(v, USDC(PER_TX), v.recipient);
    const sig = await approve(v, nonce, v.device!);
    await expectFunds(v, VAULT_BALANCE - PER_TX, PER_TX);
    expect((await eventOf(sig, "actionApproved")).approver.toBase58()).to.equal(
      v.device!.publicKey.toBase58()
    );
  });

  it("owner_can_reject_pending", async () => {
    const v = await armed();
    const { nonce } = await propose(v, USDC(PER_TX), v.recipient);
    const sig = await reject(v, nonce);
    expect((await pendingOf(v, nonce)).status).to.deep.equal({ rejected: {} });
    await expectFunds(v, VAULT_BALANCE, 0);
    const event = await eventOf(sig, "actionRejected");
    expect(event.nonce.toString()).to.equal(nonce.toString());
    expect(event.approver.toBase58()).to.equal(v.owner.publicKey.toBase58());
  });

  it("device_key_can_reject_pending", async () => {
    const v = await armed();
    const { nonce } = await propose(v, USDC(PER_TX), v.recipient);
    await reject(v, nonce, v.device!);
    expect((await pendingOf(v, nonce)).status).to.deep.equal({ rejected: {} });
    await expectFunds(v, VAULT_BALANCE, 0);
  });

  it("pending_action_cannot_be_executed_twice", async () => {
    const v = await armed();
    const { nonce } = await propose(v, USDC(PER_TX), v.recipient);
    await approve(v, nonce);
    await expectError(approve(v, nonce), "PendingNotActive");
    await expectError(reject(v, nonce), "PendingNotActive");
    await expectFunds(v, VAULT_BALANCE - PER_TX, PER_TX);
  });

  it("rejected_pending_cannot_be_approved", async () => {
    const v = await armed();
    const { nonce } = await propose(v, USDC(PER_TX), v.recipient);
    await reject(v, nonce);
    await expectError(approve(v, nonce), "PendingNotActive");
    await expectFunds(v, VAULT_BALANCE, 0);
  });

  // The legacy validator has no clock control, so this uses the minimum pending_ttl_secs and
  // really waits it out. See Decision 18 in CLAUDE.md.
  slowIt("expired_pending_cannot_be_approved", async () => {
    const v = await armed({ pendingTtlSecs: new BN(60) });
    const { nonce } = await propose(v, USDC(PER_TX), v.recipient);
    const { createdAt } = await pendingOf(v, nonce);
    await waitForClock(createdAt.toNumber() + 61);

    await expectError(approve(v, nonce), "PendingExpired");
    await expectFunds(v, VAULT_BALANCE, 0);
    expect((await pendingOf(v, nonce)).status).to.deep.equal({ pending: {} });

    // A stale proposal can still be cleaned up.
    await expectError(closePending(v, nonce), "PendingStillActive");
    await reject(v, nonce);
    expect((await pendingOf(v, nonce)).status).to.deep.equal({ rejected: {} });
    await closePending(v, nonce);
    await expectFunds(v, VAULT_BALANCE, 0);
  });

  it("cannot_close_active_pending", async () => {
    const v = await armed();
    const { nonce } = await propose(v, USDC(PER_TX), v.recipient);

    await expectError(closePending(v, nonce), "PendingStillActive");

    expect((await pendingOf(v, nonce)).status).to.deep.equal({ pending: {} });
    await approve(v, nonce);
    await expectFunds(v, VAULT_BALANCE - PER_TX, PER_TX);
  });

  it("close_returns_rent", async () => {
    const v = await armed();
    const { nonce } = await propose(v, USDC(PER_TX), v.recipient);
    await reject(v, nonce);
    const account = pendingPda(v.vault, nonce);
    const rent = await connection.getBalance(account, "confirmed");
    const before = await connection.getBalance(v.owner.publicKey, "confirmed");
    expect(rent).to.be.greaterThan(0);

    const sig = await closePending(v, nonce); // the provider wallet pays the fee

    expect(await connection.getBalance(v.owner.publicKey, "confirmed")).to.equal(before + rent);
    expect(await connection.getAccountInfo(account, "confirmed")).to.equal(null);
    const event = await eventOf(sig, "pendingClosed");
    expect(event.nonce.toString()).to.equal(nonce.toString());
    expect(event.vault.toBase58()).to.equal(v.vault.toBase58());
  });

  it("non_owner_cannot_close_pending", async () => {
    const v = await armed();
    const { nonce } = await propose(v, USDC(PER_TX), v.recipient);
    await reject(v, nonce);
    const attacker = await funded();

    await expectError(closePending(v, nonce, attacker), "Unauthorized");
    await expectError(closePending(v, nonce, v.device!), "Unauthorized");
    await expectError(closePending(v, nonce, v.agent), "Unauthorized");

    expect((await pendingOf(v, nonce)).status).to.deep.equal({ rejected: {} });
  });

  it("closed_pending_cannot_be_approved", async () => {
    const v = await armed();
    const { nonce } = await propose(v, USDC(PER_TX), v.recipient);
    await approve(v, nonce);
    await closePending(v, nonce);

    await expectError(approve(v, nonce), "AccountNotInitialized");
    await expectError(closePending(v, nonce), "AccountNotInitialized");

    await expectFunds(v, VAULT_BALANCE - PER_TX, PER_TX);
  });

  it("approve_to_wrong_recipient_account_fails", async () => {
    const v = await armed();
    const { nonce } = await propose(v, USDC(PER_TX), v.recipient);
    const attacker = Keypair.generate().publicKey;
    const attackerToken = await tokenAccount(attacker);

    await expectError(approve(v, nonce, v.owner, attackerToken), "RecipientMismatch");

    expect(await balance(attackerToken)).to.equal(0n);
    await expectFunds(v, VAULT_BALANCE, 0);
    expect((await pendingOf(v, nonce)).status).to.deep.equal({ pending: {} });
  });

  it("approvals_still_work_when_paused", async () => {
    const v = await armed();
    const first = await propose(v, USDC(1), v.recipient);
    const second = await propose(v, USDC(2), v.recipient);
    await revoke(v, v.device!);

    await approve(v, first.nonce);
    await reject(v, second.nonce);

    await expectFunds(v, VAULT_BALANCE - 1, 1);
    expect((await pendingOf(v, first.nonce)).status).to.deep.equal({ executed: {} });
    expect((await pendingOf(v, second.nonce)).status).to.deep.equal({ rejected: {} });
  });

  it("approvals_still_work_after_the_mandate_expires", async () => {
    const expiresAt = (await clockNow()) + 12;
    const v = await armed({ expiresAt: new BN(expiresAt) });
    const { nonce } = await propose(v, USDC(1), v.recipient);
    await waitForClock(expiresAt);

    await approve(v, nonce);

    await expectFunds(v, VAULT_BALANCE - 1, 1);
  });

  it("human_approval_may_exceed_daily_cap_and_then_blocks_the_agent", async () => {
    const v = await armed();
    const amount = DAILY + 50;
    const { nonce } = await propose(v, USDC(amount), v.recipient);

    await approve(v, nonce);

    const m = await mandateOf(v);
    expect(m.spentToday.gt(m.dailyCap)).to.equal(true);
    await expectFunds(v, VAULT_BALANCE - amount, amount);

    expect(await sdkTier(v, USDC(1))).to.equal("HIGH");
    await expectError(pay(v, USDC(1)), "ExceedsDailyCap");
    await expectFunds(v, VAULT_BALANCE - amount, amount);
  });

  after(() => {
    console.log("\n      Compute units (from the tx logs):");
    for (const [label, used] of Object.entries(computeUnitsSeen)) {
      console.log(`        ${label}: ${used}`);
    }
  });
});
