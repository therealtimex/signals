import { describe, expect, it } from "vitest";
import { transitionCandidate } from "./transitions";

describe("email candidate transitions", () => {
  it("never treats catch-all acceptance as verified", () => {
    expect(transitionCandidate("predicted", "probe_deliverable", { catchAll: "yes" })).toMatchObject({
      status: "uncertain",
      reason: "catch_all_domain",
    });
    expect(transitionCandidate("predicted", "probe_deliverable", { catchAll: "unknown" })).toMatchObject({
      status: "uncertain",
    });
  });

  it("allows explicit evidence and non-catch-all acceptance to verify", () => {
    expect(transitionCandidate("predicted", "manual_verify")).toMatchObject({ status: "verified" });
    expect(transitionCandidate("uncertain", "probe_deliverable", { catchAll: "no" })).toMatchObject({
      status: "verified",
      verificationMethod: "smtp_rcpt",
    });
  });
});
