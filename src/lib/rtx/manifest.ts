import manifest from "../../../rtx-manifest.json";

export type RtxManifest = {
  id: string;
  name: string;
  version: string;
  description: string;
  healthPath: string;
  homePath: string;
  permissions: string[];
};

export const RTX_MANIFEST = manifest as RtxManifest;

export const RTX_SDK_PERMISSIONS = RTX_MANIFEST.permissions;
