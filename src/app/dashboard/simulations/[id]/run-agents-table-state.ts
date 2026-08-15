export type TranscriptUiState = {
  expandedAgentIds: ReadonlySet<string>;
  cacheRevision: number;
};

export function toggleTranscriptExpansion(
  state: TranscriptUiState,
  agentId: string,
): TranscriptUiState {
  const next = new Set(state.expandedAgentIds);
  if (next.has(agentId)) {
    next.delete(agentId);
  } else {
    next.add(agentId);
  }
  return { expandedAgentIds: next, cacheRevision: state.cacheRevision };
}

/** Bump revision after cache load without mutating expansion (avoids stale reopen). */
export function bumpTranscriptCacheRevision(state: TranscriptUiState): TranscriptUiState {
  return { expandedAgentIds: state.expandedAgentIds, cacheRevision: state.cacheRevision + 1 };
}
