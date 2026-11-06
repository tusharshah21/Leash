import { expect } from "chai";
import { classifyTier, patchClearDevice } from "../src/tier";

describe("sdk: classifyTier", () => {
  const mandate = {
    lowThreshold: 10n,
    perTxMax: 100n,
    dailyCap: 150n,
    windowStart: 1000n,
    windowSecs: 60n,
  };
  const entry = { perRecipientCap: 100n };
  const NOW = 1030n; // inside the window
  const classify = (amount: bigint, spent = 0n, now = NOW, allow: typeof entry | null = entry) =>
    classifyTier(mandate, allow, spent, amount, now);

  it("LOW up to and including low_threshold", () => {
    expect(classify(1n)).to.equal("LOW");
    expect(classify(10n)).to.equal("LOW");
  });

  it("MEDIUM above low_threshold up to and including per_tx_max", () => {
    expect(classify(11n)).to.equal("MEDIUM");
    expect(classify(100n)).to.equal("MEDIUM");
  });

  it("HIGH above per_tx_max", () => {
    expect(classify(101n)).to.equal("HIGH");
  });

  it("HIGH when the recipient is not allowlisted, however small the amount", () => {
    expect(classify(1n, 0n, NOW, null)).to.equal("HIGH");
  });

  it("HIGH above per_recipient_cap, even when below per_tx_max", () => {
    expect(classify(21n, 0n, NOW, { perRecipientCap: 20n })).to.equal("HIGH");
    expect(classify(20n, 0n, NOW, { perRecipientCap: 20n })).to.equal("MEDIUM");
  });

  it("spending up to daily_cap is allowed, one unit more is HIGH", () => {
    expect(classify(10n, 140n)).to.equal("LOW");
    expect(classify(11n, 140n)).to.equal("HIGH");
  });

  it("the window resets at exactly window_start + window_secs", () => {
    expect(classify(10n, 150n, 1059n)).to.equal("HIGH");
    expect(classify(10n, 150n, 1060n)).to.equal("LOW");
  });

  it("a reset does not lift per_tx_max", () => {
    expect(classify(101n, 150n, 1060n)).to.equal("HIGH");
  });

  it("spent_today above daily_cap after an approval blocks the agent", () => {
    expect(classify(1n, 200n)).to.equal("HIGH");
  });

  it("does not wrap near u64::MAX", () => {
    expect(classify(1n, 18_446_744_073_709_551_615n)).to.equal("HIGH");
  });

  it("zero and negative amounts throw", () => {
    expect(() => classify(0n)).to.throw(RangeError);
    expect(() => classify(-1n)).to.throw(RangeError);
  });
});

describe("sdk: patchClearDevice", () => {
  it("replaces the trailing None with Some(None)", () => {
    const ix = { data: Buffer.from([9, 9, 0, 0, 0]) };
    expect([...patchClearDevice(ix).data]).to.deep.equal([9, 9, 0, 0, 1, 0]);
  });

  it("refuses data that does not end in None", () => {
    expect(() => patchClearDevice({ data: Buffer.from([9, 1]) })).to.throw();
    expect(() => patchClearDevice({ data: Buffer.alloc(0) })).to.throw();
  });
});
