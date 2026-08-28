import { describe, expect, it } from "vitest";
import packageMetadata from "../../../package.json";
import {
  SIGNALS_PP_CLI_PACKAGE,
  SIGNALS_PP_CLI_VERSION,
  signalsPpCliHealthFields,
} from "@/lib/signals-pp-cli/metadata";

describe("signals-pp-cli metadata", () => {
  it("pins CLI package identity to the app release version", () => {
    expect(SIGNALS_PP_CLI_PACKAGE).toBe("@realtimex/signals-pp-cli");
    expect(SIGNALS_PP_CLI_VERSION).toBe(packageMetadata.version);
    expect(signalsPpCliHealthFields()).toEqual({
      cliPackage: "@realtimex/signals-pp-cli",
      cliVersion: packageMetadata.version,
    });
  });
});
