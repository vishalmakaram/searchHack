import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export type IdPrefix = "ws" | "scr" | "wh" | "dlv" | "run" | "q";

/** A prefix plus 12 random characters, e.g. "scr_k3v9x0q2m7ab". */
export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomString(12)}`;
}

/** The secret a webhook gives to Telem. */
export function newSecret(): string {
  return `whsec_${randomString(32)}`;
}

/** Uniformly random characters from `alphabet`, using a CSPRNG. */
export function randomString(length: number, alphabet: string = ALPHABET): string {
  // Bytes at or above `limit` are rejected so that every character is equally likely.
  const limit = 256 - (256 % alphabet.length);
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= limit) continue;
      out += alphabet[byte % alphabet.length];
      if (out.length === length) break;
    }
  }
  return out;
}
