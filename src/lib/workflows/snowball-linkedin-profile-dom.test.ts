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
    });

    browserWindow.close();
  });
});
