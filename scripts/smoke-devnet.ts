// Exercises the SDK against the demo vault on devnet. Run the bootstrap script first.
// Uses small amounts: a run takes 28 dUSDC off the demo's 500 daily cap.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { type LeashEvent, LeashClient, LeashTxError } from "@leash/sdk";
import { getAccount } from "@solana/spl-token";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  cliWallet,
  connection,
  demoKey,
  DEVNET_JSON,
  dusdc,
  providerFor,
  txLink,
  Wallet,
} from "./common.ts";

const demo = JSON.parse(readFileSync(DEVNET_JSON, "utf8"));
const ownerKey = demoKey("owner");
const owner = ownerKey.publicKey;
const asAgent = new LeashClient(providerFor(demoKey("agent")), owner);
const asDevice = new LeashClient(providerFor(demoKey("device")), owner);
const asOwner = new LeashClient(providerFor(ownerKey), owner);
const guard = new Wallet(demoKey("guard"));
const deviceKey = new PublicKey(demo.device.address);

const payer = cliWallet().publicKey;
const startBalance = await connection.getBalance(payer);

const vendor = (name: string) => {
  const v = demo.vendors.find((x: { name: string }) => x.name === name);
  return { wallet: new PublicKey(v.address), token: new PublicKey(v.tokenAccount) };
};
const amountOf = async (account: PublicKey) =>
  (await getAccount(connection, account, "confirmed")).amount;

const report = (label: string, signature: string) =>
  console.log(`${label.padEnd(34)} ${txLink(signature)}`);

const seen: LeashEvent[] = [];
const unsubscribe = asAgent.onLeashEvent((e) => seen.push(e));

// LOW: the agent alone.
const acme = vendor("Acme Design");
let before = await amountOf(acme.token);
const low = await asAgent.act(dusdc(1), acme.wallet, "smoke: LOW payment");
assert.equal(low.tier, "LOW");
assert.equal(await amountOf(acme.token), before + dusdc(1));
report("LOW, agent alone", low.signature);

// MEDIUM: refused without the guard, paid with it.
const cloud = vendor("CloudHost Inc");
await assert.rejects(asAgent.act(dusdc(26), cloud.wallet, "smoke: no guard"), /co-signature/);
before = await amountOf(cloud.token);
const medium = await asAgent.act(dusdc(26), cloud.wallet, "smoke: MEDIUM payment", { guard });
assert.equal(medium.tier, "MEDIUM");
assert.equal(await amountOf(cloud.token), before + dusdc(26));
report("MEDIUM, agent plus guard", medium.signature);

// HIGH: an unlisted recipient. It moves nothing until the device key approves.
const ownerToken = new PublicKey(demo.owner.tokenAccount);
before = await amountOf(ownerToken);
const high = await asAgent.act(dusdc(1), owner, "smoke: HIGH payment");
assert.equal(high.tier, "HIGH");
if (high.tier !== "HIGH") throw new Error("unreachable");
assert.equal(await amountOf(ownerToken), before);
assert.ok((await asAgent.fetchPending()).some((p) => p.nonce === high.nonce));
report("HIGH, agent proposes", high.signature);
report("HIGH, device approves", await asDevice.approve(high.nonce));
assert.equal(await amountOf(ownerToken), before + dusdc(1));
report("Owner closes the settled proposal", await asOwner.close(high.nonce));

// Injected recipient: the agent is told to pay the attacker. Lands onchain, and fails.
const attackerToken = new PublicKey(demo.attacker.tokenAccount);
const attackerBefore = await amountOf(attackerToken);
let injected: LeashTxError | undefined;
try {
  await asAgent.execute({
    amount: dusdc(1),
    recipient: new PublicKey(demo.attacker.address),
    reason: "smoke: injected recipient",
    skipPreflight: true,
  });
} catch (err) {
  injected = err as LeashTxError;
}
assert.ok(injected, "the injected payment must fail");
assert.equal(injected.code, "NotAllowlisted", String(injected));
assert.ok(injected.signature, "the failure should have landed onchain");
assert.equal(await amountOf(attackerToken), attackerBefore);
report(`Injected recipient: ${injected.message}`, injected.signature);

// Rejection, for the rest of the human path.
const stale = await asAgent.propose(dusdc(1), acme.wallet, "smoke: rejected");
report("Device rejects a proposal", await asDevice.reject(stale.nonce));
report("Owner closes it", await asOwner.close(stale.nonce));

// Pause: the device can stop the agent, and only the owner can restart it.
report("Device revokes the agent", await asDevice.revoke());
try {
  await assert.rejects(asAgent.act(dusdc(1), acme.wallet, "smoke: paused"), (e: LeashTxError) => {
    assert.equal(e.code, "VaultPaused");
    return true;
  });
} finally {
  report("Owner unpauses", await asOwner.unpause());
}

// Key rotation, including the Some(None) encoding. Always puts the device back.
let lastSignature = "";
report("Owner removes the device key", await asOwner.rotateKeys({ device: null }));
try {
  assert.equal((await asOwner.fetchVault()).device, null);
} finally {
  lastSignature = await asOwner.rotateKeys({ device: deviceKey });
  report("Owner restores the device key", lastSignature);
}
assert.ok((await asOwner.fetchVault()).device?.equals(deviceKey));

// Events: the websocket feed and the page-load history.
await new Promise((resolve) => setTimeout(resolve, 5000));
unsubscribe();
const names = new Set(seen.map((e) => String(e.name)));
for (const name of ["actionExecuted", "actionPending", "actionApproved", "pendingClosed"]) {
  assert.ok(names.has(name), `no ${name} over the websocket, saw [${[...names]}]`);
}
const recent = await asOwner.fetchRecentEvents(5);
assert.equal(recent[0]?.signature, lastSignature, "recent events should be newest first");
const executed = seen.find((e) => e.name === "actionExecuted");
assert.ok(executed?.name === "actionExecuted" && executed.data.reasonHash.length === 32);
console.log(`\nWebsocket events: ${seen.length}`);
console.log(`Recent events: ${recent.map((e) => String(e.name)).join(", ")}`);

const spent = (startBalance - (await connection.getBalance(payer))) / LAMPORTS_PER_SOL;
const { spentToday, dailyCap } = await asOwner.fetchMandate();
console.log(`Daily cap used: ${Number(spentToday) / 1e6} of ${Number(dailyCap) / 1e6} dUSDC`);
console.log(`Deploy wallet SOL spent: ${spent}`);
console.log("\nSmoke test passed.");
process.exit(0);
