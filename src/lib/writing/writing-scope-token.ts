/**
 * Dispatch-issued capability for composed writing.
 *
 * The launch scope has to be minted from something the caller cannot *choose*. A workflow run id is
 * a selector — enumerable through agent-tools, so naming one proves nothing. This token is a
 * capability: Signals mints it while dispatching a composed run, stores only its hash on the
 * server-owned run row, and writes the plaintext into that dispatch's brief. Presenting it is
 * therefore evidence of having been handed *this* dispatch, which is what the run id never was.
 *
 * Shape is `<workflowRunId>.<secret>` so verification is a direct row lookup rather than a scan.
 *
 * Bound, stated plainly: the brief file lives in the RTX workspace, so an agent with filesystem
 * access to another run's brief can read that run's token. This is a capability boundary, not a
 * cryptographic one — the route has no per-request identity to bind to. It closes caller-*selected*
 * cross-run attribution; it does not defend against an agent that reads another dispatch's files.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { sha256 } from "@/lib/writing/hash";

/** Server-only key on the stored run config; `_`-prefixed keys never reach the agent's brief. */
export const WRITING_SCOPE_TOKEN_CONFIG_KEY = "_writingScopeTokenHash";

export type WritingScopeToken = { token: string; tokenHash: string };

export function mintWritingScopeToken(workflowRunId: string): WritingScopeToken {
  const token = `${workflowRunId}.${randomBytes(24).toString("base64url")}`;
  return { token, tokenHash: sha256(token) };
}

export function parseWritingScopeToken(
  value: unknown,
): { workflowRunId: string; token: string } | null {
  if (typeof value !== "string") return null;
  const separator = value.lastIndexOf(".");
  if (separator <= 0 || separator === value.length - 1) return null;
  const workflowRunId = value.slice(0, separator);
  return workflowRunId ? { workflowRunId, token: value } : null;
}

/** Constant-time comparison, so a mismatched token cannot be probed byte by byte. */
export function writingScopeTokenMatches(token: string, expectedHash: unknown): boolean {
  if (typeof expectedHash !== "string" || expectedHash.length === 0) return false;
  const actual = Buffer.from(sha256(token), "utf8");
  const expected = Buffer.from(expectedHash, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
