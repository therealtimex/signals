import { afterEach } from "vitest";

// Vitest 3.2 never returns to the event loop between synchronous tests, so a file of
// sync better-sqlite3 tests runs as one macrotask. The worker's `onTaskUpdate` RPC reply
// from the main process then sits unread in the IPC pipe while birpc's fixed 60s timer
// runs; once a file's contiguous sync work exceeds 60s the timer phase fires before the
// poll phase and Vitest reports `[vitest-worker]: Timeout calling "onTaskUpdate"` as an
// unhandled error after every test passed (#370). One real event-loop turn after each
// test bounds that window to a single test. Captured at load so vi.useFakeTimers()
// inside a test cannot swap it for a fake.
const realSetImmediate = setImmediate;

afterEach(() => new Promise<void>((resolve) => realSetImmediate(resolve)));
