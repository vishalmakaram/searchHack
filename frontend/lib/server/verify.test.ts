import { describe, expect, it } from "vitest";
import { T0, useTestStore } from "./test-helpers";
import { sign, verifySignature } from "./verify";

const SECRET = "whsec_from_telem";
const BODY = '{"type":"agent.changes","changes":[]}';
const T = String(Math.floor(T0.getTime() / 1000));

const headers = (signature?: string) => new Headers(signature === undefined ? {} : { "Telem-Signature": signature });

describe("verifySignature", () => {
  useTestStore();

  it("accepts a correct signature", () => {
    expect(verifySignature(SECRET, headers(`t=${T},v1=${sign(SECRET, T, BODY)}`), BODY)).toBe("valid");
  });

  it("matches the documented scheme: HMAC-SHA256 of '<t>.<body>' in hex", () => {
    // Computed independently: printf '1700000000.{}' | openssl dgst -sha256 -hmac secret
    expect(sign("secret", "1700000000", "{}")).toBe("b8569b78799ff9e3cbff0fc2d63a33a2b57f3282abd07c37ae5e8e7d79a5f163");
  });

  it("refuses a signature made with another secret or for another body", () => {
    expect(verifySignature(SECRET, headers(`t=${T},v1=${sign("other", T, BODY)}`), BODY)).toBe("invalid");
    expect(verifySignature(SECRET, headers(`t=${T},v1=${sign(SECRET, T, BODY)}`), `${BODY} `)).toBe("invalid");
  });

  it("refuses a timestamp more than five minutes away", () => {
    const old = String(Number(T) - 301);
    expect(verifySignature(SECRET, headers(`t=${old},v1=${sign(SECRET, old, BODY)}`), BODY)).toBe("invalid");
    const recent = String(Number(T) - 299);
    expect(verifySignature(SECRET, headers(`t=${recent},v1=${sign(SECRET, recent, BODY)}`), BODY)).toBe("valid");
  });

  it("accepts any of several v1 values", () => {
    const header = `t=${T},v1=${"0".repeat(64)},v1=${sign(SECRET, T, BODY)}`;
    expect(verifySignature(SECRET, headers(header), BODY)).toBe("valid");
  });

  it("refuses a malformed header", () => {
    expect(verifySignature(SECRET, headers("nonsense"), BODY)).toBe("invalid");
    expect(verifySignature(SECRET, headers(`v1=${sign(SECRET, T, BODY)}`), BODY)).toBe("invalid");
  });

  it("does not check when there is no secret or no signature", () => {
    expect(verifySignature(null, headers(`t=${T},v1=abc`), BODY)).toBe("not_checked");
    expect(verifySignature(SECRET, headers(), BODY)).toBe("not_checked");
  });
});
