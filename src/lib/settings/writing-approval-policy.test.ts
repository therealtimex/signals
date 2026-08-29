import { afterEach, describe, expect, it } from "vitest";
import { updateSignalsConfig } from "@/lib/settings/signals-config";
import {
  getWritingApprovalPolicy,
  WRITING_APPROVAL_POLICY_ENV,
} from "@/lib/settings/writing-approval-policy";

describe("writing approval policy", () => {
  afterEach(() => updateSignalsConfig({ writingApprovalPolicy: undefined }));

  it("resolves env, then config, then the explicit default", () => {
    expect(getWritingApprovalPolicy({})).toBe("explicit");
    updateSignalsConfig({ writingApprovalPolicy: "auto_low_risk" });
    expect(getWritingApprovalPolicy({})).toBe("auto_low_risk");
    expect(getWritingApprovalPolicy({ [WRITING_APPROVAL_POLICY_ENV]: "explicit" })).toBe(
      "explicit",
    );
  });

  it("ignores invalid values", () => {
    updateSignalsConfig({ writingApprovalPolicy: "bad" as "explicit" });
    expect(getWritingApprovalPolicy({ [WRITING_APPROVAL_POLICY_ENV]: "also_bad" })).toBe(
      "explicit",
    );
  });
});
