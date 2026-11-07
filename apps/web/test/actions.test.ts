// The Actions handlers with loaded data stubbed. No network: transactions are built by the real SDK.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import anchor from "@anchor-lang/core";
import {
  type ActivityEntry,
  IDL,
  LeashClient,
  mandatePda,
  pendingPda,
  reasonHash,
} from "@leash/sdk";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  ACTION_HEADERS,
  ACTIONS_JSON,
  type ActionDeps,
  dialUrl,
  getPending,
  getRevoke,
  blinkPage,
  type LoadedPending,
  type LoadedVault,
  postDecision,
  phantomUrl,
  postRevoke,
} from "../lib/actions.ts";

const owner = Keypair.generate().publicKey;
const device = Keypair.generate().publicKey;
const stranger = Keypair.generate().publicKey;
const attacker = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
const NONCE = 7n;
const SITE = "https://leash.example";
const BLOCKHASH = Keypair.generate().publicKey.toBase58();
const REASONING = "Invoice 42 says to pay this new account.";

const provider = new anchor.AnchorProvider(
  new Connection("http://127.0.0.1:1"),
  { publicKey: owner } as never,
  {}
);
const client = new LeashClient(provider, owner);
const vault = client.vault;
const V = vault.toBase58();
const N = NONCE.toString();

const vaultState = (over: Partial<LoadedVault> = {}): LoadedVault => ({
  owner,
  device,
  mint,
  paused: false,
  pendingBase: 0n,
  ...over,
});

const activity: ActivityEntry[] = [
  { ts: "t", actor: "agent", kind: "pay", nonce: N, reasoning: REASONING },
  {
    ts: "t",
    actor: "guard",
    kind: "review",
    nonce: N,
    risk: 90,
    rationale: "The recipient is unknown.",
  },
];

const proposal = (over: Partial<LoadedPending> = {}): LoadedPending => ({
  recipient: attacker,
  amount: 190_000_000n,
  status: "pending",
  createdAt: 1000,
  ttlSecs: 100,
  chainNow: 1050,
  listed: false,
  reasonHash: reasonHash(REASONING),
  activity,
  ...over,
});

const deps = (
  loadedVault: LoadedVault | null = vaultState(),
  loadedPending: LoadedPending | null = proposal()
): ActionDeps => ({
  site: SITE,
  loadVault: async () => loadedVault,
  loadPending: async () => loadedPending,
  clientFor: () => client,
  blockhash: async () => BLOCKHASH,
});

const ixNamed = (name: string) =>
  (
    IDL as unknown as { instructions: { name: string; discriminator: number[] }[] }
  ).instructions.find((ix) => ix.name === name)!.discriminator;

const decode = (body: object) => {
  const { transaction, type } = body as { transaction: string; type: string };
  assert.equal(type, "transaction");
  return Transaction.from(Buffer.from(transaction, "base64"));
};

const onlyLeashIx = (tx: Transaction) => {
  const ix = tx.instructions.filter((i) => i.programId.toBase58() === IDL.address);
  assert.equal(ix.length, 1);
  return ix[0];
};

test("approve builds approve_pending for the owner, unsigned and paid by the owner", async () => {
  const { status, body } = await postDecision(
    "approve",
    V,
    N,
    { account: owner.toBase58() },
    deps()
  );
  assert.equal(status, 200);
  const tx = decode(body);
  assert.equal(tx.feePayer!.toBase58(), owner.toBase58());
  assert.equal(tx.recentBlockhash, BLOCKHASH);
  assert.ok(tx.signatures.every((s) => s.signature === null));

  const ix = onlyLeashIx(tx);
  assert.deepEqual([...ix.data.subarray(0, 8)], ixNamed("approve_pending"));
  assert.equal(ix.data.readBigUInt64LE(8), NONCE);
  assert.equal(ix.keys[0].pubkey.toBase58(), owner.toBase58());
  assert.ok(ix.keys[0].isSigner);
  assert.equal(ix.keys[1].pubkey.toBase58(), V);
  assert.equal(ix.keys[2].pubkey.toBase58(), mandatePda(vault).toBase58());
  assert.equal(ix.keys[3].pubkey.toBase58(), pendingPda(vault, NONCE).toBase58());
  assert.match((body as { message: string }).message, /Approved\. Paying 190 dUSDC/);
});

test("approve also creates the recipient's token account if it is missing", async () => {
  const { body } = await postDecision("approve", V, N, { account: owner.toBase58() }, deps());
  assert.equal(decode(body).instructions.length, 2);
});

test("reject builds reject_pending and the device key may sign it", async () => {
  const { status, body } = await postDecision(
    "reject",
    V,
    N,
    { account: device.toBase58() },
    deps()
  );
  assert.equal(status, 200);
  const tx = decode(body);
  assert.equal(tx.feePayer!.toBase58(), device.toBase58());
  const ix = onlyLeashIx(tx);
  assert.deepEqual([...ix.data.subarray(0, 8)], ixNamed("reject_pending"));
  assert.equal(ix.data.readBigUInt64LE(8), NONCE);
  assert.equal(ix.keys[0].pubkey.toBase58(), device.toBase58());
});

test("a stranger gets a clear refusal, and no transaction", async () => {
  for (const decision of ["approve", "reject"] as const) {
    const { status, body } = await postDecision(
      decision,
      V,
      N,
      { account: stranger.toBase58() },
      deps()
    );
    assert.equal(status, 403);
    assert.match((body as { message: string }).message, /owner or device/);
    assert.ok(!("transaction" in body));
  }
});

test("bad input is a 400", async () => {
  const good = { account: owner.toBase58() };
  assert.equal((await postDecision("approve", "nope", N, good, deps())).status, 400);
  assert.equal((await postDecision("approve", V, "1x", good, deps())).status, 400);
  assert.equal(
    (await postDecision("approve", V, "99999999999999999999", good, deps())).status,
    400
  );
  assert.equal((await postDecision("approve", V, N, { account: "x" }, deps())).status, 400);
  assert.equal((await postDecision("approve", V, N, null, deps())).status, 400);
  assert.equal((await getPending("nope", N, deps())).status, 400);
  assert.equal((await getRevoke("nope", deps())).status, 400);
});

test("an open proposal offers Approve and Reject, with the chain's facts and the review", async () => {
  const { status, body } = await getPending(V, N, deps());
  assert.equal(status, 200);
  const action = body as {
    icon: string;
    title: string;
    description: string;
    disabled?: boolean;
    links: { actions: { label: string; href: string; type: string }[] };
  };
  assert.equal(action.icon, `${SITE}/api/actions/pending/${V}/${N}/card.png`);
  assert.match(action.title, /NOT ON ALLOWLIST.*190 dUSDC/);
  assert.ok(action.description.includes(`Agent claims: ${REASONING}`));
  assert.match(action.description, /risk 90\/100: The recipient is unknown/);
  assert.ok(!action.disabled);
  assert.deepEqual(
    action.links.actions.map((a) => [a.label, a.type, a.href]),
    [
      ["Approve", "transaction", `${SITE}/api/actions/pending/${V}/${N}/approve`],
      ["Reject", "transaction", `${SITE}/api/actions/pending/${V}/${N}/reject`],
    ]
  );
});

test("reasoning that does not match the onchain hash is not shown", async () => {
  const forged = proposal({ reasonHash: reasonHash("something else") });
  const { body } = await getPending(V, N, deps(vaultState(), forged));
  const { description } = body as { description: string };
  assert.ok(!description.includes(REASONING));
  assert.match(description, /No verified reasoning/);
});

test("an allowlisted recipient is named and not flagged", async () => {
  const listed = proposal({ listed: true, label: "DataLabs" });
  const { body } = await getPending(V, N, deps(vaultState(), listed));
  const { title, description } = body as { title: string; description: string };
  assert.equal(title, "Pay 190 dUSDC to DataLabs?");
  assert.ok(!description.includes("NOT ON ALLOWLIST"));
});

const CLOSED: [string, ActionDeps, RegExp][] = [
  ["executed", deps(vaultState(), proposal({ status: "executed" })), /Already approved/],
  ["rejected", deps(vaultState(), proposal({ status: "rejected" })), /Already rejected/],
  ["expired", deps(vaultState(), proposal({ chainNow: 1101 })), /Expired/],
  ["stale", deps(vaultState({ pendingBase: NONCE + 1n })), /vault that was closed/],
  ["no proposal", deps(vaultState(), null), /no proposal/],
  ["no vault", deps(null), /no Leash vault/],
];

for (const [name, closedDeps, reason] of CLOSED) {
  test(`${name}: GET is a disabled action with the reason, and POST builds nothing`, async () => {
    const { status, body } = await getPending(V, N, closedDeps);
    assert.equal(status, 200);
    const action = body as { disabled: boolean; links?: unknown; error: { message: string } };
    assert.equal(action.disabled, true);
    assert.equal(action.links, undefined);
    assert.match(action.error.message, reason);

    const post = await postDecision("approve", V, N, { account: owner.toBase58() }, closedDeps);
    assert.ok(post.status >= 400 && post.status < 500);
    assert.match((post.body as { message: string }).message, reason);
  });
}

test("exactly at the deadline a proposal is still open, as in the program", async () => {
  const { body } = await getPending(V, N, deps(vaultState(), proposal({ chainNow: 1100 })));
  assert.ok(!(body as { disabled?: boolean }).disabled);
});

test("revoke: GET offers the single action, POST builds revoke_agent for the owner", async () => {
  const get = await getRevoke(V, deps());
  const action = get.body as { label: string; icon: string; disabled?: boolean };
  assert.equal(action.label, "Revoke agent");
  assert.equal(action.icon, `${SITE}/api/actions/revoke/${V}/card.png`);
  assert.ok(!action.disabled);

  const { status, body } = await postRevoke(V, { account: owner.toBase58() }, deps());
  assert.equal(status, 200);
  const tx = decode(body);
  assert.equal(tx.feePayer!.toBase58(), owner.toBase58());
  const ix = onlyLeashIx(tx);
  assert.deepEqual([...ix.data.subarray(0, 8)], ixNamed("revoke_agent"));
  assert.equal(ix.keys[0].pubkey.toBase58(), owner.toBase58());
});

test("revoke is owner only here, including against the device key", async () => {
  for (const key of [device, stranger]) {
    const { status } = await postRevoke(V, { account: key.toBase58() }, deps());
    assert.equal(status, 403);
  }
});

test("revoke on a paused vault is disabled, and on a closed one too", async () => {
  const paused = deps(vaultState({ paused: true }));
  const get = (await getRevoke(V, paused)).body as { disabled: boolean };
  assert.equal(get.disabled, true);
  assert.equal((await postRevoke(V, { account: owner.toBase58() }, paused)).status, 409);
  assert.equal(((await getRevoke(V, deps(null))).body as { disabled: boolean }).disabled, true);
  assert.equal((await postRevoke(V, { account: owner.toBase58() }, deps(null))).status, 404);
});

test("the spec's headers and actions.json are as published", () => {
  assert.equal(ACTION_HEADERS["Access-Control-Allow-Origin"], "*");
  assert.match(ACTION_HEADERS["Access-Control-Allow-Headers"], /X-Accept-Action-Version/);
  assert.match(ACTION_HEADERS["Access-Control-Expose-Headers"], /X-Blockchain-Ids/);
  assert.equal(ACTION_HEADERS["X-Blockchain-Ids"], "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1");
  assert.deepEqual(ACTIONS_JSON.rules, [
    { pathPattern: "/api/actions/**", apiPath: "/api/actions/**" },
  ]);
});

test("dialUrl encodes the action and selects devnet", () => {
  const url = new URL(dialUrl(`${SITE}/api/actions/revoke/abc`));
  assert.equal(url.host, "dial.to");
  assert.equal(url.searchParams.get("action"), `solana-action:${SITE}/api/actions/revoke/abc`);
  assert.equal(url.searchParams.get("cluster"), "devnet");
});

test("phantomUrl opens our Blink page in Phantom's browser", () => {
  const path = "/api/actions/revoke/abc";
  const url = new URL(phantomUrl(SITE, path));
  assert.equal(url.host, "phantom.com");
  assert.equal(decodeURIComponent(url.pathname.split("/").pop()!), blinkPage(SITE, path));
  assert.equal(url.searchParams.get("ref"), SITE);
  assert.equal(new URL(blinkPage(SITE, path)).searchParams.get("action"), path);
});

test("the fixture's accounts are distinct, so the checks above mean something", () => {
  assert.equal(
    new Set([owner, device, stranger, attacker].map((k: PublicKey) => k.toBase58())).size,
    4
  );
});
