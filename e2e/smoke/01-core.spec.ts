import { test, expect } from "@playwright/test";

test.describe("smoke:core UI", () => {
  test("home redirects to dashboard", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("dashboard renders key sections", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(page.getByText("Contact Pipeline")).toBeVisible();
    await expect(page.getByText("Total contacts in CRM")).toBeVisible();
    await expect(page.getByText("Your AI-powered social CRM at a glance.")).toBeVisible();
  });

  test("contacts page loads", async ({ page }) => {
    await page.goto("/dashboard/contacts");

    await expect(page.getByRole("heading", { name: "Contacts", exact: true })).toBeVisible();
    await expect(page.getByText("Manage your CRM contacts across platforms.")).toBeVisible();
  });

  test("settings page loads", async ({ page }) => {
    await page.goto("/dashboard/settings");

    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  });

  test("sidebar navigation reaches contacts and settings", async ({ page }) => {
    await page.goto("/dashboard");

    await page.getByRole("link", { name: "Contacts" }).click();
    await expect(page).toHaveURL(/\/dashboard\/contacts/);

    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/dashboard\/settings/);
  });
});
