import { describe, expect, it } from "vitest";
import { deriveNameParts } from "./name-parts";

describe("email name parts", () => {
  it.each([
    ["Dr. José García-López", { first: "jose", last: "garcialopez" }],
    ["Ludwig van der Berg", { first: "ludwig", last: "vanderberg", particlesJoined: true }],
    ["Mary Anne O'Brien Jr.", { first: "mary", last: "obrien", ambiguous: ["anne"] }],
    ["J. Smith", { first: "j", last: "smith", firstIsInitial: true }],
  ])("normalizes %s", (name, expected) => {
    expect(deriveNameParts({ name })).toMatchObject({ ok: true, ...expected });
  });

  it("rejects unusable names", () => {
    expect(deriveNameParts({ name: "Madonna" })).toEqual({ ok: false, reason: "single_token" });
    expect(deriveNameParts({ name: "山田 太郎" })).toEqual({ ok: false, reason: "non_latin" });
  });
});
