import { describe, expect, it } from "vitest";
import { externalEffectsDenied, getInstanceKind } from "@/lib/instance/instance";

describe("getInstanceKind", () => {
  it("is dev only for the exact value SIGNALS_INSTANCE=dev", () => {
    expect(getInstanceKind({ SIGNALS_INSTANCE: "dev" })).toBe("dev");
  });

  it.each([
    ["unset", {}],
    ["empty", { SIGNALS_INSTANCE: "" }],
    ["canonical", { SIGNALS_INSTANCE: "canonical" }],
    ["other casing", { SIGNALS_INSTANCE: "DEV" }],
    ["padded", { SIGNALS_INSTANCE: " dev " }],
    ["any other value", { SIGNALS_INSTANCE: "production" }],
  ])("is canonical when SIGNALS_INSTANCE is %s", (_label, env) => {
    expect(getInstanceKind(env)).toBe("canonical");
  });

  it("reads process.env by default", () => {
    expect(getInstanceKind()).toBe(getInstanceKind(process.env));
  });
});

describe("externalEffectsDenied", () => {
  it("denies effects exactly when the instance is dev", () => {
    expect(externalEffectsDenied({ SIGNALS_INSTANCE: "dev" })).toBe(true);
    expect(externalEffectsDenied({})).toBe(false);
  });

  it("has no override: no other variable re-allows effects on a dev instance", () => {
    expect(
      externalEffectsDenied({
        SIGNALS_INSTANCE: "dev",
        SIGNALS_ALLOW_EXTERNAL_EFFECTS: "1",
        SIGNALS_EXTERNAL_EFFECTS: "allowed",
        SIGNALS_DEV_ALLOW_PUBLISH: "true",
      }),
    ).toBe(true);
  });
});
