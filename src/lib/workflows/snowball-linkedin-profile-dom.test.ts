import { Window } from "happy-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractLinkedInProfileDomObservation } from "@/lib/workflows/snowball-identity-evidence";

function renderLinkedInProfile(url: string, markup: string): Window {
  const browserWindow = new Window({ url });
  browserWindow.document.body.innerHTML = markup;
  vi.stubGlobal("window", browserWindow);
  vi.stubGlobal("document", browserWindow.document);
  return browserWindow;
}

describe("LinkedIn Snowball profile DOM extraction", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("extracts the current obfuscated top-card DOM by canonical profile URL", () => {
    const browserWindow = renderLinkedInProfile(
      "https://www.linkedin.com/in/jane-doe/",
      `
        <main>
          <div>
            <a href="https://www.linkedin.com/in/sidebar-person/"
               componentkey="ProfileVerificationTriggerRef-sidebar-person">
              <h2>Sidebar Person</h2>
            </a>
          </div>
          <div class="obfuscated-card-shell">
            <div class="obfuscated-top-card">
              <div>
                <div>
                  <a href="https://www.linkedin.com/in/jane-doe/"
                     componentkey="ProfileVerificationTriggerRef-jane-doe">
                    <div><h2>Jane Doe</h2></div>
                  </a>
                  <p>· 2nd</p>
                </div>
              </div>
              <p>Founder &amp; CEO at Acme, Inc.</p>
              <p>Acme, Inc. · Example University</p>
              <div>San Francisco Bay Area · Contact info</div>
            </div>
          </div>
          <section>
            <a href="https://www.linkedin.com/in/jane-doe/"><strong>Jane Doe</strong></a>
            reposted this
          </section>
        </main>
      `,
    );

    expect(extractLinkedInProfileDomObservation()).toEqual({
      visibleName: "Jane Doe",
      headline: "Founder & CEO at Acme, Inc.",
      topCardText:
        "Jane Doe · 2nd Founder & CEO at Acme, Inc. Acme, Inc. · Example University San Francisco Bay Area · Contact info",
      unavailable: false,
      avatarUrl: null,
      sessionViewerAvatarUrl: null,
    });

    browserWindow.close();
  });

  it("retains the legacy LinkedIn top-card selectors as a fallback", () => {
    const browserWindow = renderLinkedInProfile(
      "https://www.linkedin.com/in/jane-doe/",
      `
        <main>
          <section>
            <h1 class="text-heading-xlarge">Jane Doe</h1>
            <div class="text-body-medium break-words">Founder at Acme</div>
            <p>Jane Doe Founder at Acme London</p>
          </section>
        </main>
      `,
    );

    expect(extractLinkedInProfileDomObservation()).toEqual({
      visibleName: "Jane Doe",
      headline: "Founder at Acme",
      topCardText: "Jane Doe Founder at Acme Jane Doe Founder at Acme London",
      unavailable: false,
      avatarUrl: null,
      sessionViewerAvatarUrl: null,
    });

    browserWindow.close();
  });

  it("binds the top-card photo and ignores the authenticated nav Me thumbnail", () => {
    const viewerThumb =
      "https://media.licdn.com/dms/image/v2/C5103AQHThgCA9BePxw/profile-displayphoto-shrink_100_100/0/1";
    const contactPhoto =
      "https://media.licdn.com/dms/image/v2/D4E03AQOtherAsset99/profile-displayphoto-shrink_400_400/0/1";
    const browserWindow = renderLinkedInProfile(
      "https://www.linkedin.com/in/jane-doe/",
      `
        <nav class="global-nav">
          <div class="global-nav__me">
            <img src="${viewerThumb}" alt="viewer">
          </div>
        </nav>
        <main>
          <div class="obfuscated-top-card">
            <a href="https://www.linkedin.com/in/jane-doe/"
               componentkey="ProfileVerificationTriggerRef-jane-doe">
              <div><h2>Jane Doe</h2></div>
            </a>
            <p>Founder &amp; CEO at Acme, Inc.</p>
            <p>Acme, Inc. · Example University</p>
            <img class="pv-top-card-profile-picture__image"
                 src="${contactPhoto}"
                 srcset="https://media.licdn.com/dms/image/v2/D4E03AQOtherAsset99/profile-displayphoto-shrink_100_100/0/1 1x, ${contactPhoto} 2x"
                 alt="Jane Doe">
          </div>
        </main>
      `,
    );

    expect(extractLinkedInProfileDomObservation()).toMatchObject({
      visibleName: "Jane Doe",
      avatarUrl: contactPhoto,
      sessionViewerAvatarUrl: viewerThumb,
    });

    browserWindow.close();
  });

  it("does not take an unrelated main-content profile photo when no top-card container is proven", () => {
    const unrelatedPhoto =
      "https://media.licdn.com/dms/image/v2/D4E03AQPeopleAlso99/profile-displayphoto-shrink_400_400/0/1";
    const browserWindow = renderLinkedInProfile(
      "https://www.linkedin.com/in/jane-doe/",
      `
        <main>
          <section>
            <h1 class="text-heading-xlarge">Jane Doe</h1>
            <div class="text-body-medium break-words">Founder at Acme</div>
            <p>Jane Doe Founder at Acme London</p>
          </section>
          <section>
            <h2>People also viewed</h2>
            <img src="${unrelatedPhoto}" alt="Other Person">
          </section>
        </main>
      `,
    );

    expect(extractLinkedInProfileDomObservation()).toMatchObject({
      visibleName: "Jane Doe",
      headline: "Founder at Acme",
      avatarUrl: null,
    });

    browserWindow.close();
  });
});
