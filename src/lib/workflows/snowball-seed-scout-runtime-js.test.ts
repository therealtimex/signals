import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * The copy-link harvest runs `scoutExtractPostUrl` inside the browser, not the
 * Python helper next to it. Those two drifted once already — the Python side
 * accepted numeric/photo/group Facebook posts while the evaluated script still
 * only took `/posts/pfbid` — so this exercises the generated script text itself.
 */
const RESOLVE_SCRIPT = join(
  process.cwd(),
  "scripts",
  "snowball-seed-scout",
  "lib",
  "resolve.py",
);

type ScoutWindow = {
  __scoutCopiedLinks: string[];
  __scoutClipboardHooked?: boolean;
  scoutExtractPostUrl: (href: string) => string | null;
};

function generateInitScript(): string {
  const result = spawnSync("python3", [RESOLVE_SCRIPT, "copy-link-init"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`resolve.py copy-link-init failed: ${result.stderr}`);
  }
  return result.stdout;
}

/** Evaluate the real generated script against minimal browser stubs. */
function evaluateInitScript(script: string): ScoutWindow {
  const win = { __scoutCopiedLinks: [] as string[] } as unknown as ScoutWindow;
  const navigatorStub = {
    clipboard: { writeText: async () => undefined },
  };
  const documentStub = {
    body: { dispatchEvent: () => true },
    querySelector: () => null,
    querySelectorAll: () => [] as unknown[],
  };
  const KeyboardEventStub = class {
    constructor(
      public type: string,
      public init?: Record<string, unknown>,
    ) {}
  };

  const run = new Function(
    "window",
    "navigator",
    "document",
    "KeyboardEvent",
    `return ${script}`,
  );
  const ready = run(win, navigatorStub, documentStub, KeyboardEventStub);
  expect(ready).toBe("ready");
  return win;
}

describe("snowball seed scout runtime extractor", () => {
  let scout: ScoutWindow;

  beforeAll(() => {
    scout = evaluateInitScript(generateInitScript());
  });

  it("accepts a pfbid post", () => {
    const url =
      "https://www.facebook.com/saritasym/posts/pfbid0AVUoH55Pnb4cxmX8Gt5yjEYJmuy8cS3cvm8iWRUyLyyuxg5MzDSt5NwNpLY6xpvrl";
    expect(scout.scoutExtractPostUrl(url)).toBe(url);
  });

  it("accepts a numeric post id", () => {
    expect(
      scout.scoutExtractPostUrl("https://www.facebook.com/acme/posts/1234567890"),
    ).toBe("https://www.facebook.com/acme/posts/1234567890");
  });

  it("accepts a photo permalink", () => {
    expect(
      scout.scoutExtractPostUrl("https://www.facebook.com/photo?fbid=987654321&set=a.1"),
    ).toBe("https://www.facebook.com/photo?fbid=987654321");
  });

  it("accepts a group permalink", () => {
    expect(
      scout.scoutExtractPostUrl(
        "https://www.facebook.com/groups/buildinpublic/permalink/556677/",
      ),
    ).toBe("https://www.facebook.com/groups/buildinpublic/permalink/556677");
  });

  it("unwraps an l.facebook.com redirect", () => {
    const inner = encodeURIComponent(
      "https://www.facebook.com/acme/posts/1234567890",
    );
    expect(
      scout.scoutExtractPostUrl(`https://l.facebook.com/l.php?u=${inner}`),
    ).toBe("https://www.facebook.com/acme/posts/1234567890");
  });

  it("rejects a profile or feed URL", () => {
    expect(scout.scoutExtractPostUrl("https://www.facebook.com/acme")).toBeNull();
    expect(scout.scoutExtractPostUrl("https://www.facebook.com/")).toBeNull();
  });
});
