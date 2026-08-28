import packageMetadata from "../../../package.json";

/** npm package name for the Signals Printing Press CLI (ADR-174 revision). */
export const SIGNALS_PP_CLI_PACKAGE = "@realtimex/signals-pp-cli";

/** Locked to the running Local App / marketplace release train. */
export const SIGNALS_PP_CLI_VERSION = packageMetadata.version;

export function signalsPpCliHealthFields() {
  return {
    cliPackage: SIGNALS_PP_CLI_PACKAGE,
    cliVersion: SIGNALS_PP_CLI_VERSION,
  };
}
