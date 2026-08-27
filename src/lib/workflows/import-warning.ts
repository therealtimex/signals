export const IMPORT_RUN_RECORDING_FAILED = "IMPORT_RUN_RECORDING_FAILED" as const;

export interface ImportWarning {
  code: typeof IMPORT_RUN_RECORDING_FAILED;
  message: string;
}

export const IMPORT_RUN_RECORDING_FAILED_MESSAGE =
  "Contacts were imported, but this run could not be saved to run history. Check Contacts before importing this file again.";
