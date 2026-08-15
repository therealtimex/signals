import { describe, expect, it } from "vitest";
import {
  bumpTranscriptCacheRevision,
  toggleTranscriptExpansion,
} from "@/app/dashboard/simulations/[id]/run-agents-table-state";

describe("run-agents-table transcript UI state", () => {
  it("collapse-before-fetch-resolution stays collapsed when cache revision bumps", () => {
    let state = toggleTranscriptExpansion(
      { expandedAgentIds: new Set(), cacheRevision: 0 },
      "agent-1",
    );
    expect(state.expandedAgentIds.has("agent-1")).toBe(true);

    state = toggleTranscriptExpansion(state, "agent-1");
    expect(state.expandedAgentIds.has("agent-1")).toBe(false);

    state = bumpTranscriptCacheRevision(state);
    expect(state.expandedAgentIds.has("agent-1")).toBe(false);
    expect(state.cacheRevision).toBe(1);
  });

  it("re-expand after cached load only toggles expansion, not cache revision", () => {
    let state = toggleTranscriptExpansion(
      { expandedAgentIds: new Set(), cacheRevision: 1 },
      "agent-1",
    );
    expect(state.expandedAgentIds.has("agent-1")).toBe(true);
    expect(state.cacheRevision).toBe(1);

    state = toggleTranscriptExpansion(state, "agent-1");
    state = toggleTranscriptExpansion(state, "agent-1");
    expect(state.expandedAgentIds.has("agent-1")).toBe(true);
    expect(state.cacheRevision).toBe(1);
  });
});
