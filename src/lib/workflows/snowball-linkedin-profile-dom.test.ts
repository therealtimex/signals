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

  it("binds an SDUI top-card photo that sits in a [componentkey=topcard] sibling of the text card", () => {
    const viewerThumb =
      "https://media.licdn.com/dms/image/v2/C5103AQHThgCA9BePxw/profile-displayphoto-shrink_100_100/0/1";
    const contactPhoto =
      "https://media.licdn.com/dms/image/v2/D5603AQGqTD9aT-xIdA/profile-displayphoto-shrink_800_800/0/1";
    const facepileScale =
      "https://media.licdn.com/dms/image/v2/D5603AQHRxdPA1E3azQ/profile-displayphoto-scale_100_100/0/1";
    const facepileShrink =
      "https://media.licdn.com/dms/image/v2/C5603AQGCA0jXW9wIGQ/profile-displayphoto-shrink_100_100/0/1";
    const browserWindow = renderLinkedInProfile(
      "https://www.linkedin.com/in/jane-doe/",
      `
        <nav class="global-nav">
          <img src="${viewerThumb}" alt="viewer">
        </nav>
        <main>
          <section>
            <div>
              <div>
                <a componentkey="topcard" href="https://www.linkedin.com/in/jane-doe/">
                  <div componentkey="topcard">
                    <figure>
                      <img src="${contactPhoto}" width="152" height="152" alt="Jane Doe">
                    </figure>
                  </div>
                </a>
              </div>
              <div>
                <a href="https://www.linkedin.com/in/jane-doe/"
                   componentkey="ProfileVerificationTriggerRef-jane-doe">
                  <div><h2>Jane Doe</h2></div>
                </a>
                <p>Founder &amp; CEO at Acme, Inc.</p>
                <p>Acme, Inc. · Example University</p>
              </div>
              <div>
                <a>
                  <ul>
                    <li><img src="${facepileScale}" width="24" height="24" alt="Mutual"></li>
                    <li><img src="${facepileShrink}" width="24" height="24" alt="Other"></li>
                  </ul>
                </a>
              </div>
            </div>
          </section>
        </main>
      `,
    );

    expect(extractLinkedInProfileDomObservation()).toMatchObject({
      visibleName: "Jane Doe",
      headline: "Founder & CEO at Acme, Inc.",
      avatarUrl: contactPhoto,
      sessionViewerAvatarUrl: viewerThumb,
    });

    browserWindow.close();
  });

  it("does not bind an unassociated cousin photo when the SDUI card has no componentkey=topcard", () => {
    const cousinPhoto =
      "https://media.licdn.com/dms/image/v2/D5603AQAlexHeathTop/profile-displayphoto-shrink_400_400/0/1";
    const browserWindow = renderLinkedInProfile(
      "https://www.linkedin.com/in/jane-doe/",
      `
        <nav><img src="https://media.licdn.com/dms/image/v2/C5103AQHThgCA9BePxw/profile-displayphoto-shrink_100_100/0/1" alt="viewer"></nav>
        <main>
          <section>
            <div class="obf-photo">
              <img src="${cousinPhoto}" alt="Jane Doe">
            </div>
            <div>
              <a href="https://www.linkedin.com/in/jane-doe/"
                 componentkey="ProfileVerificationTriggerRef-jane-doe">
                <h2>Jane Doe</h2>
              </a>
              <p>Founder &amp; CEO at Acme, Inc.</p>
              <p>Acme, Inc. · Example University</p>
            </div>
          </section>
        </main>
      `,
    );

    expect(extractLinkedInProfileDomObservation()).toMatchObject({
      visibleName: "Jane Doe",
      avatarUrl: null,
    });

    browserWindow.close();
  });

  it("does not bind a sibling photo enclosed by a different /in/ profile", () => {
    const otherPhoto =
      "https://media.licdn.com/dms/image/v2/D4E03AQOtherPerson99/profile-displayphoto-shrink_400_400/0/1";
    const browserWindow = renderLinkedInProfile(
      "https://www.linkedin.com/in/jane-doe/",
      `
        <main>
          <section>
            <a href="https://www.linkedin.com/in/other-person/">
              <img src="${otherPhoto}" alt="Other Person">
            </a>
            <div>
              <a href="https://www.linkedin.com/in/jane-doe/"
                 componentkey="ProfileVerificationTriggerRef-jane-doe">
                <h2>Jane Doe</h2>
              </a>
              <p>Founder &amp; CEO at Acme, Inc.</p>
              <p>Acme, Inc. · Example University</p>
            </div>
          </section>
        </main>
      `,
    );

    expect(extractLinkedInProfileDomObservation()).toMatchObject({
      visibleName: "Jane Doe",
      avatarUrl: null,
    });

    browserWindow.close();
  });

  it("skips a different profile's [componentkey=topcard] and binds the current profile's keyed photo", () => {
    const otherPhoto =
      "https://media.licdn.com/dms/image/v2/D4E03AQOtherPerson99/profile-displayphoto-shrink_400_400/0/1";
    const janePhoto =
      "https://media.licdn.com/dms/image/v2/D5603AQGqTD9aT-xIdA/profile-displayphoto-shrink_800_800/0/1";
    const browserWindow = renderLinkedInProfile(
      "https://www.linkedin.com/in/jane-doe/",
      `
        <main>
          <section>
            <a componentkey="topcard" href="https://www.linkedin.com/in/other-person/">
              <img src="${otherPhoto}" alt="Other Person">
            </a>
            <div>
              <a href="https://www.linkedin.com/in/jane-doe/"
                 componentkey="ProfileVerificationTriggerRef-jane-doe">
                <h2>Jane Doe</h2>
              </a>
              <p>Founder &amp; CEO at Acme, Inc.</p>
              <p>Acme, Inc. · Example University</p>
            </div>
            <a componentkey="topcard" href="https://www.linkedin.com/in/jane-doe/">
              <img src="${janePhoto}" alt="Jane Doe">
            </a>
          </section>
        </main>
      `,
    );

    expect(extractLinkedInProfileDomObservation()).toMatchObject({
      visibleName: "Jane Doe",
      avatarUrl: janePhoto,
    });

    browserWindow.close();
  });

  it("does not bind a mutual-connections facepile when the profile has no top-card photo", () => {
    const facepileScale =
      "https://media.licdn.com/dms/image/v2/D5603AQHRxdPA1E3azQ/profile-displayphoto-scale_100_100/0/1";
    const browserWindow = renderLinkedInProfile(
      "https://www.linkedin.com/in/jane-doe/",
      `
        <main>
          <section>
            <div>
              <div>
                <a href="https://www.linkedin.com/in/jane-doe/"
                   componentkey="ProfileVerificationTriggerRef-jane-doe">
                  <h2>Jane Doe</h2>
                </a>
                <p>Founder &amp; CEO at Acme, Inc.</p>
                <p>Acme, Inc. · Example University</p>
              </div>
              <div>
                <ul>
                  <li><img src="${facepileScale}" width="24" height="24" alt="Mutual"></li>
                </ul>
              </div>
            </div>
          </section>
        </main>
      `,
    );

    expect(extractLinkedInProfileDomObservation()).toMatchObject({
      visibleName: "Jane Doe",
      avatarUrl: null,
    });

    browserWindow.close();
  });
});
