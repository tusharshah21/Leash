import { expect } from "chai";
import { describeError, errorName, LeashTxError } from "../src/errors";
import { IDL } from "../src/idl";

describe("sdk: errors", () => {
  const programErrors = (IDL as unknown as { errors: { code: number; name: string }[] }).errors;
  const pascal = (s: string) => s[0].toUpperCase() + s.slice(1);

  it("maps every program error, by name and by code", () => {
    expect(programErrors.length).to.be.greaterThan(0);
    for (const { code, name } of programErrors) {
      const expected = pascal(name);
      expect(errorName({ error: { errorCode: { code: expected } } })).to.equal(expected);
      expect(errorName(new Error(`custom program error: 0x${code.toString(16)}`))).to.equal(
        expected
      );
      expect(describeError({ logs: [`Error Code: ${expected}.`] })).to.not.contain("Error Code");
    }
  });

  it("gives the short message", () => {
    expect(
      describeError({ logs: ["Program log: AnchorError. Error Code: NotAllowlisted."] })
    ).to.equal("Recipient not on the allowlist");
  });

  it("falls back to the original message", () => {
    expect(describeError(new Error("socket hang up"))).to.equal("socket hang up");
    expect(new LeashTxError({ InstructionError: [0, { Custom: 6005 }] }, "sig").code).to.equal(
      "NotAllowlisted"
    );
    expect(errorName(new Error('{"InstructionError":[0,{"Custom":6005}]}'))).to.equal(
      "NotAllowlisted"
    );
    expect(
      new LeashTxError(new Error('{"InstructionError":[0,{"Custom":6005}]}'), "sig").code
    ).to.equal("NotAllowlisted");
    expect(errorName(new Error("custom program error: 0x1"))).to.equal(undefined);
  });

  it("LeashTxError keeps the signature and the code", () => {
    const e = new LeashTxError("failed", "sig", ["Error Code: PendingExpired."]);
    expect(e.signature).to.equal("sig");
    expect(e.code).to.equal("PendingExpired");
    expect(e.message).to.equal("Proposal has expired");
  });
});
