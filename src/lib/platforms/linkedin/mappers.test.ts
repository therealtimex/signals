import { describe, it, expect, vi, afterEach } from "vitest";
import {
  mapLinkedInProfileToContact,
  mapLinkedInProfileToIdentity,
  mapLinkedInConnectionToContact,
  mapLinkedInConnectionToIdentity,
} from "@/lib/platforms/linkedin/mappers";
import type { LinkedInProfile, LinkedInConnection } from "@/lib/platforms/linkedin/client";

describe("mapLinkedInProfileToContact", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("maps OpenID Connect userinfo shape", () => {
    const profile: LinkedInProfile = {
      sub: "li-abc",
      given_name: "Alex",
      family_name: "Rivera",
      name: "Alex Rivera",
      email: "alex@example.com",
      picture: "https://media.licdn.com/photo.jpg",
      vanityName: "alexrivera",
      localizedHeadline: "Founder",
    };

    const contact = mapLinkedInProfileToContact(profile);

    expect(contact).toMatchObject({
      name: "Alex Rivera",
      firstName: "Alex",
      lastName: "Rivera",
      email: "alex@example.com",
      headline: "Founder",
      platform: "linkedin",
      platformUserId: "li-abc",
      profileUrl: "https://linkedin.com/in/alexrivera",
      photoUrl: "https://media.licdn.com/photo.jpg",
    });
  });

  it("maps legacy profile fields and nested profile pictures", () => {
    const profile: LinkedInProfile = {
      sub: "legacy-1",
      id: "legacy-1",
      localizedFirstName: "Legacy",
      localizedLastName: "User",
      localizedHeadline: "Advisor",
      profilePicture: {
        "displayImage~": {
          elements: [
            {
              identifiers: [{ identifier: "https://media.licdn.com/low.jpg" }],
            },
            {
              identifiers: [{ identifier: "https://media.licdn.com/high.jpg" }],
            },
          ],
        },
      },
    };

    const contact = mapLinkedInProfileToContact(profile);
    expect(contact.name).toBe("Legacy User");
    expect(contact.photoUrl).toBe("https://media.licdn.com/high.jpg");
    expect(contact.profileUrl).toBeNull();
  });
});

describe("mapLinkedInConnectionToContact", () => {
  it("maps legacy connection export shape", () => {
    const connection: LinkedInConnection = {
      id: "conn-1",
      localizedFirstName: "Sam",
      localizedLastName: "Lee",
      localizedHeadline: "Engineer",
      vanityName: "samlee",
    };

    const contact = mapLinkedInConnectionToContact(connection);

    expect(contact).toMatchObject({
      name: "Sam Lee",
      firstName: "Sam",
      lastName: "Lee",
      headline: "Engineer",
      platform: "linkedin",
      platformUserId: "conn-1",
      profileUrl: "https://linkedin.com/in/samlee",
    });
  });

  it("maps profile and connection identities", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T00:00:00Z"));

    const profileIdentity = mapLinkedInProfileToIdentity(
      {
        sub: "li-1",
        given_name: "Pat",
        family_name: "Kim",
        vanityName: "patkim",
      },
      "contact-1",
      "pat@example.com"
    );

    expect(profileIdentity.platformHandle).toBe("/in/patkim");
    expect(JSON.parse(profileIdentity.platformData!).email).toBe("pat@example.com");

    const connectionIdentity = mapLinkedInConnectionToIdentity(
      {
        id: "conn-9",
        localizedFirstName: "Riley",
        localizedLastName: "Ng",
        vanityName: "rileyn",
      },
      "contact-2"
    );

    expect(connectionIdentity.platformUrl).toBe("https://linkedin.com/in/rileyn");
  });
});
