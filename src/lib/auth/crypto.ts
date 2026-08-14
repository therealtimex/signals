import { randomBytes, createCipheriv, createDecipheriv, createHash } from "crypto";
import { hostname, userInfo } from "os";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Derives a 256-bit key from a passphrase using SHA-256.
 */
function deriveKey(passphrase: string): Buffer {
  return createHash("sha256").update(passphrase).digest();
}

/**
 * Machine-specific encryption passphrase.
 * Ties credentials to this machine — prevents casual plaintext exposure.
 */
function getMachinePassphrase(prefix = "signals"): string {
  return `${prefix}:${hostname()}:${userInfo().username}`;
}

/**
 * Encrypt a string value. Returns base64-encoded ciphertext
 * with IV and auth tag prepended.
 */
export function encrypt(plaintext: string): string {
  const key = deriveKey(getMachinePassphrase("signals"));
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8");
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: iv + authTag + ciphertext
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return combined.toString("base64");
}

/**
 * Decrypt a base64-encoded ciphertext. Returns the original plaintext.
 */
export function decrypt(ciphertext: string): string {
  try {
    const key = deriveKey(getMachinePassphrase("signals"));
    const combined = Buffer.from(ciphertext, "base64");

    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    // Fallback to legacy passphrase if previously encrypted under openvolo
    const key = deriveKey(getMachinePassphrase("openvolo"));
    const combined = Buffer.from(ciphertext, "base64");

    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString("utf8");
  }
}
