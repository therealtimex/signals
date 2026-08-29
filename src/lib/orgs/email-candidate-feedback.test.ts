import { describe, expect, it } from "vitest";
import { emailCandidateActionSuccessMessage } from "./email-candidate-feedback";

describe("emailCandidateActionSuccessMessage", () => {
  it("uses verified for verify actions", () => {
    expect(emailCandidateActionSuccessMessage("verify")).toBe("Candidate verified.");
    expect(emailCandidateActionSuccessMessage("verify")).not.toContain("verifyed");
  });

  it("preserves other candidate-action messages", () => {
    expect(emailCandidateActionSuccessMessage("invalidate")).toBe("Candidate invalidated.");
    expect(emailCandidateActionSuccessMessage("probe")).toBe("Candidate probe completed.");
    expect(emailCandidateActionSuccessMessage("correct")).toBe("Candidate corrected.");
  });
});
