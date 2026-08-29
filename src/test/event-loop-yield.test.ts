import { describe, expect, it, vi } from "vitest";

// Guards src/test/setup-event-loop-yield.ts (#370). `realSetImmediate` is captured before
// any test can fake timers; if it has run by the time the next test starts, the worker
// completed a full event-loop iteration (timers → poll → check) between tests, which is
// exactly when a pending RPC reply from the Vitest main process gets read.
const realSetImmediate = setImmediate;
const seen = { immediate: false };

describe("worker returns to the event loop between tests", () => {
  it("schedules a check-phase callback and finishes without yielding", () => {
    vi.useFakeTimers(); // the setup hook must survive faked timers
    realSetImmediate(() => {
      seen.immediate = true;
    });
    expect(seen.immediate).toBe(false);
  });

  it("observes the callback before the next test starts", () => {
    vi.useRealTimers();
    expect(seen.immediate).toBe(true);
  });
});
