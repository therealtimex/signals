import { describe, it, expect } from "vitest";
import { formatWorkflowError } from "@/lib/workflows/format-error";

describe("formatWorkflowError", () => {
  it("formats browser enrichment unavailable", () => {
    const raw =
      "BROWSER_ENRICHMENT_UNAVAILABLE: In-process Playwright profile enrichment was removed from Signals.";
    const result = formatWorkflowError(raw);
    expect(result.category).toBe("browser_enrichment");
    expect(result.title).toBe("Profile enrichment moved to RealTimeX Browser");
  });

  it("formats agent orchestration unavailable", () => {
    const raw =
      "AGENT_ORCHESTRATION_UNAVAILABLE: In-process agent orchestration was removed from Signals.";
    const result = formatWorkflowError(raw);
    expect(result.category).toBe("agent_orchestration");
    expect(result.title).toBe("Agent orchestration moved to RealTimeX");
  });

  it("formats rate limit with seconds→minutes conversion", () => {
    const raw =
      'Rate limited on /users/123/tweets?tweet.fields=created_at%2Cpublic_metrics&max_results=10&pagination_token=7140dibdnow9c7btw4. Retry after 899s';
    const result = formatWorkflowError(raw);
    expect(result.category).toBe("rate_limit");
    expect(result.title).toBe("Rate limited — try again in 15 minutes");
    expect(result.detail).toBeUndefined();
  });

  it("formats rate limit with short duration", () => {
    const raw = "Rate limited on /users/123/likes. Retry after 30s";
    const result = formatWorkflowError(raw);
    expect(result.title).toBe("Rate limited — try again in 30 seconds");
  });

  it("formats rate limit with hours", () => {
    const raw = "Rate limited on /endpoint. Retry after 3660s";
    const result = formatWorkflowError(raw);
    expect(result.title).toBe("Rate limited — try again in 1h 1m");
  });

  it("formats X API tier restriction", () => {
    const raw =
      "Endpoint /tweets/search/recent requires a higher X API tier. This endpoint requires Basic access or above.";
    const result = formatWorkflowError(raw);
    expect(result.category).toBe("tier");
    expect(result.title).toBe("X API tier too low for this feature");
  });

  it("formats batch limit (enrichment)", () => {
    const raw =
      "Batch limit reached after 15 profiles. Remaining contacts will be enriched in the next batch.";
    const result = formatWorkflowError(raw);
    expect(result.category).toBe("batch_limit");
    expect(result.title).toBe("Batch limit reached (15 profiles processed)");
  });

  it("formats batch limit (scraper)", () => {
    const raw =
      "Batch limit of 15 profiles reached. Wait 30 minutes before the next batch.";
    const result = formatWorkflowError(raw);
    expect(result.category).toBe("batch_limit");
    expect(result.title).toBe("Batch limit reached (15 profile max)");
  });

  it("formats CAPTCHA/challenge detection", () => {
    const raw = "Challenge/CAPTCHA detected while loading @someuser. Stopping batch.";
    const result = formatWorkflowError(raw);
    expect(result.category).toBe("challenge");
    expect(result.title).toBe("CAPTCHA or verification detected");
  });

  it("formats batch stop due to challenge", () => {
    const raw = "Stopping batch due to challenge detection.";
    const result = formatWorkflowError(raw);
    expect(result.category).toBe("challenge");
    expect(result.title).toBe("CAPTCHA or verification detected");
  });

  it("formats browser session expired", () => {
    const raw =
      "X browser session is invalid or expired. Please re-authenticate in Settings.";
    const result = formatWorkflowError(raw);
    expect(result.category).toBe("session");
    expect(result.title).toBe("Browser session expired — re-authenticate in Settings");
  });

  it("formats no credentials", () => {
    const raw = "No credentials found for account";
    const result = formatWorkflowError(raw);
    expect(result.category).toBe("credentials");
    expect(result.title).toBe("Account not connected");
  });

  it("formats per-item @handle error with nested rate limit", () => {
    const raw =
      "Failed to enrich @testuser: Rate limited on /users/123/tweets. Retry after 900s";
    const result = formatWorkflowError(raw);
    expect(result.category).toBe("item_error");
    expect(result.title).toBe("Failed to process @testuser");
    expect(result.detail).toBe("Rate limited — try again in 15 minutes");
  });

  it("formats per-item @handle error with simple message", () => {
    const raw = "Failed to process @someuser: Something went wrong";
    const result = formatWorkflowError(raw);
    expect(result.category).toBe("item_error");
    expect(result.title).toBe("Failed to process @someuser");
    expect(result.detail).toBe("Something went wrong");
  });

  it("formats per-item metadata sync error", () => {
    const raw =
      "Failed to sync metadata for John Doe (john@example.com): fetch failed";
    const result = formatWorkflowError(raw);
    expect(result.category).toBe("item_error");
    expect(result.title).toBe("Failed to sync metadata for John Doe");
    expect(result.detail).toBe("Network error — check your connection");
  });

  it("formats per-item name error", () => {
    const raw = "Failed to process Jane Smith: No credentials found for account";
    const result = formatWorkflowError(raw);
    expect(result.category).toBe("item_error");
    expect(result.title).toBe("Failed to process Jane Smith");
    expect(result.detail).toBe("Account not connected");
  });

  it("formats sync wrapper with nested error", () => {
    const raw =
      "Tweet sync failed: Rate limited on /users/123/tweets?tweet.fields=created_at. Retry after 450s";
    const result = formatWorkflowError(raw);
    expect(result.category).toBe("sync_error");
    expect(result.title).toBe("Tweet sync encountered an error");
    expect(result.detail).toBe("Rate limited — try again in 8 minutes");
  });

  it("formats mention sync wrapper", () => {
    const raw = "Mention sync failed: fetch failed";
    const result = formatWorkflowError(raw);
    expect(result.category).toBe("sync_error");
    expect(result.title).toBe("Mention sync encountered an error");
    expect(result.detail).toBe("Network error — check your connection");
  });

  it("formats metadata sync wrapper", () => {
    const raw = "Metadata sync failed: ETIMEDOUT";
    const result = formatWorkflowError(raw);
    expect(result.category).toBe("sync_error");
    expect(result.title).toBe("Metadata sync encountered an error");
    expect(result.detail).toBe("Network error — check your connection");
  });

  it("formats profile enrichment wrapper", () => {
    const raw = "Profile enrichment failed: No credentials found for account";
    const result = formatWorkflowError(raw);
    expect(result.category).toBe("sync_error");
    expect(result.title).toBe("Profile enrichment encountered an error");
    expect(result.detail).toBe("Account not connected");
  });

  it("formats network errors", () => {
    expect(formatWorkflowError("fetch failed").category).toBe("network");
    expect(formatWorkflowError("ECONNREFUSED").category).toBe("network");
    expect(formatWorkflowError("ETIMEDOUT").category).toBe("network");
    expect(formatWorkflowError("Connection timeout occurred").category).toBe("network");
  });

  it("truncates unknown errors to 80 chars", () => {
    const long = "A".repeat(100);
    const result = formatWorkflowError(long);
    expect(result.category).toBe("unknown");
    expect(result.title).toBe("A".repeat(77) + "...");
    expect(result.title.length).toBe(80);
  });

  it("passes through short unknown errors unchanged", () => {
    const short = "Something unexpected happened";
    const result = formatWorkflowError(short);
    expect(result.category).toBe("unknown");
    expect(result.title).toBe(short);
  });

  it("handles deeply nested errors (wrapper → per-item → rate limit)", () => {
    const raw =
      "Sync failed: Failed to process @deep: Rate limited on /endpoint. Retry after 60s";
    const result = formatWorkflowError(raw);
    expect(result.category).toBe("sync_error");
    expect(result.title).toBe("Sync encountered an error");
    // detail is the formatted per-item error title
    expect(result.detail).toBe("Failed to process @deep");
  });
});
