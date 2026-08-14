import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "@/lib/auth/crypto";

describe("crypto", () => {
  it("round-trips plaintext through encrypt and decrypt", () => {
    const plaintext = '{"apiKey":"test-secret-value"}';
    const ciphertext = encrypt(plaintext);

    expect(ciphertext).not.toBe(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it("produces different ciphertext for the same input (random IV)", () => {
    const a = encrypt("same");
    const b = encrypt("same");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe("same");
    expect(decrypt(b)).toBe("same");
  });
});
