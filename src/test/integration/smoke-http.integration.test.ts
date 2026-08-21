import { describe, expect, it } from "vitest";
import { smokeBaseUrl, smokeFetch } from "./http-client";

describe("smoke:core HTTP", () => {
  it("home redirects to dashboard", async () => {
    const response = await smokeFetch("/", { redirect: "manual" });
    expect([307, 308, 302]).toContain(response.status);
    const location = response.headers.get("location") ?? "";
    expect(location).toMatch(/\/dashboard$/);
  });

  it("dashboard HTML includes key sections", async () => {
    const response = await smokeFetch("/dashboard");
    expect(response.ok).toBe(true);
    const html = await response.text();
    expect(html).toContain("Contact Pipeline");
    expect(html).toContain("Total contacts in CRM");
    expect(html).toContain("Your AI-powered social CRM at a glance.");
  });

  it("contacts page HTML loads", async () => {
    const response = await smokeFetch("/dashboard/contacts");
    expect(response.ok).toBe(true);
    const html = await response.text();
    expect(html).toContain("Contacts");
    expect(html).toMatch(/\d+ contacts?/);
    expect(html).toContain("Identities");
  });

  it("settings page HTML loads", async () => {
    const response = await smokeFetch("/dashboard/settings");
    expect(response.ok).toBe(true);
    const html = await response.text();
    expect(html).toContain("Settings");
  });

  it("dashboard and child routes return HTML from the same origin", async () => {
    const base = smokeBaseUrl();
    const dashboard = await smokeFetch("/dashboard");
    const contacts = await smokeFetch("/dashboard/contacts");
    const settings = await smokeFetch("/dashboard/settings");
    expect(dashboard.ok && contacts.ok && settings.ok).toBe(true);
    expect(dashboard.url.startsWith(base)).toBe(true);
    expect(contacts.url).toContain("/dashboard/contacts");
    expect(settings.url).toContain("/dashboard/settings");
  });
});
