import { describe, expect, it } from "vitest";
import {
  getLaunchDetailHref,
  isLaunchRowActivationKey,
} from "@/app/dashboard/launches/launches-list-utils";

describe("launches list utils", () => {
  it("builds the launch detail href", () => {
    expect(getLaunchDetailHref("launch-1")).toBe("/dashboard/launches/launch-1");
  });

  it("accepts Enter and Space as row activation keys", () => {
    expect(isLaunchRowActivationKey("Enter")).toBe(true);
    expect(isLaunchRowActivationKey(" ")).toBe(true);
    expect(isLaunchRowActivationKey("Tab")).toBe(false);
  });
});
