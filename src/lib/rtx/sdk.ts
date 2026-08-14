import { RTX_MANIFEST, RTX_SDK_PERMISSIONS } from "@/lib/rtx/manifest";
import { getRtxAppId, getRtxAppName, resolveRtxApiBase, type EnvLike } from "@/lib/rtx/env";

export type RtxPermissionState = {
  granted: string[];
  denied: string[];
};

export type RtxRegisterResult = {
  success: boolean;
  message?: string;
  permissions?: RtxPermissionState;
  dismissed?: boolean;
  error?: string;
};

export type RtxPingResult = {
  success: boolean;
  mode?: string;
  appId?: string;
  error?: string;
};

function buildHeaders(appId: string): HeadersInit {
  return {
    "content-type": "application/json",
    "x-app-id": appId,
  };
}

export async function registerWithRtx(
  fetchImpl: typeof fetch = fetch,
  env: EnvLike = process.env
): Promise<RtxRegisterResult> {
  const appId = getRtxAppId(env);
  const apiBase = resolveRtxApiBase(env);

  if (!appId) {
    return { success: false, error: "RTX_APP_ID is not set" };
  }
  if (!apiBase) {
    return { success: false, error: "RealTimeX API base URL is not configured" };
  }

  try {
    const response = await fetchImpl(`${apiBase}/sdk/register`, {
      method: "POST",
      headers: buildHeaders(appId),
      body: JSON.stringify({
        app_id: appId,
        app_name: getRtxAppName(env) ?? RTX_MANIFEST.name,
        permissions: RTX_SDK_PERMISSIONS,
      }),
    });

    const body = (await response.json()) as RtxRegisterResult & {
      error?: string;
    };

    if (!response.ok) {
      return {
        success: false,
        error: body.error ?? `Registration failed (${response.status})`,
      };
    }

    return {
      success: body.success ?? true,
      message: body.message,
      permissions: body.permissions,
      dismissed: body.dismissed,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Registration request failed",
    };
  }
}

export async function pingRtx(
  fetchImpl: typeof fetch = fetch,
  env: EnvLike = process.env
): Promise<RtxPingResult> {
  const appId = getRtxAppId(env);
  const apiBase = resolveRtxApiBase(env);

  if (!appId) {
    return { success: false, error: "RTX_APP_ID is not set" };
  }
  if (!apiBase) {
    return { success: false, error: "RealTimeX API base URL is not configured" };
  }

  try {
    const response = await fetchImpl(`${apiBase}/sdk/ping`, {
      method: "GET",
      headers: buildHeaders(appId),
    });

    const body = (await response.json()) as RtxPingResult & { error?: string };

    if (!response.ok) {
      return {
        success: false,
        error: body.error ?? `Ping failed (${response.status})`,
      };
    }

    return {
      success: body.success ?? true,
      mode: body.mode,
      appId: body.appId ?? appId,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Ping request failed",
    };
  }
}
