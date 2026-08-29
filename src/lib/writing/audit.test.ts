import { describe, expect, it } from "vitest";
import { deriveAuditVerdict, validateAuditFindingSemantics } from "@/lib/writing/audit";
import type { WritingAudit } from "@/lib/writing/contracts";

function audit(): WritingAudit {
  return {
    schemaVersion: 1,
    id: "aud_audit01",
    variantId: "variant",
    inputHash: "hash",
    auditedAt: 1,
    auditor: { kind: "agent", skillVersion: "1" },
    overlay: { id: "overlay:x", version: 1 },
    core: { version: 1 },
    verdict: "pass",
    findings: [],
    claims: { total: 0, preserved: 0, altered: [], missing: [], invented: [], privateIncluded: [] },
    hard: { units: 1, chars: [1], limit: 280, hashtags: 0, links: 0, mediaCount: 0 },
    voice: { status: "none", skipped: [] },
    heuristics: { applied: [], conflicts: [], skippedForVoice: [] },
  };
}

describe("writing audit derivation", () => {
  it("ignores a voice-skipped heuristic but warns when rules-first is used", () => {
    const skipped = audit();
    skipped.findings.push({ code: "x/post/heuristic/hook-test", class: "heuristic", severity: "warning", message: "hook", skippedForVoice: true });
    expect(deriveAuditVerdict(skipped)).toBe("pass");
    skipped.voice.status = "rules_first";
    skipped.findings[0].skippedForVoice = false;
    expect(deriveAuditVerdict(skipped)).toBe("warn");
  });

  it("blocks invented claims and hard limit violations server-side", () => {
    const invented = audit();
    invented.claims.invented.push({ text: "made up" });
    expect(deriveAuditVerdict(invented)).toBe("block");
    const tooLong = audit();
    tooLong.hard.chars = [281];
    expect(deriveAuditVerdict(tooLong)).toBe("block");
  });

  it("never voice-skips hard or claim blockers", () => {
    for (const findingClass of ["hard", "claim"] as const) {
      const blocked = audit();
      blocked.findings.push({
        code: `x/post/${findingClass}/blocked-test`,
        class: findingClass,
        severity: "blocker",
        message: "blocked",
        skippedForVoice: true,
      });
      expect(deriveAuditVerdict(blocked)).toBe("block");
      expect(validateAuditFindingSemantics(blocked)).toBe("audit_voice_skip_class");
    }
  });

  it("warns for known missing and non-verbatim altered claims", () => {
    const missing = audit();
    missing.claims.missing.push("clm_claim01");
    expect(deriveAuditVerdict(missing)).toBe("warn");

    const altered = audit();
    altered.claims.altered.push("clm_claim01");
    expect(deriveAuditVerdict(altered)).toBe("warn");
  });

  it("forbids blocker severity on heuristic findings", () => {
    const invalid = audit();
    invalid.findings.push({ code: "x/post/heuristic/hook-test", class: "heuristic", severity: "blocker", message: "hook" });
    expect(validateAuditFindingSemantics(invalid)).toBe("audit_severity_class");
  });
});
