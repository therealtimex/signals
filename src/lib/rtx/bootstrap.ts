import { isRtxEmbedded, type EnvLike } from "@/lib/rtx/env";
import { pingRtx, registerWithRtx, type RtxPermissionState } from "@/lib/rtx/sdk";

export type RtxRuntimeMode = "standalone" | "embedded";

export type RtxBootstrapState = {
  mode: RtxRuntimeMode;
  appId: string | null;
  registered: boolean;
  pingOk: boolean;
  permissions: RtxPermissionState | null;
  message: string | null;
  error: string | null;
  bootstrappedAt: string | null;
};

let state: RtxBootstrapState = {
  mode: "standalone",
  appId: null,
  registered: false,
  pingOk: false,
  permissions: null,
  message: null,
  error: null,
  bootstrappedAt: null,
};

let bootstrapPromise: Promise<RtxBootstrapState> | null = null;

export function getRtxBootstrapState(): RtxBootstrapState {
  return state;
}

export function resetRtxBootstrapState(): void {
  state = {
    mode: "standalone",
    appId: null,
    registered: false,
    pingOk: false,
    permissions: null,
    message: null,
    error: null,
    bootstrappedAt: null,
  };
  bootstrapPromise = null;
}

export async function bootstrapRtxIfEmbedded(
  fetchImpl: typeof fetch = fetch,
  env: EnvLike = process.env
): Promise<RtxBootstrapState> {
  if (!isRtxEmbedded(env)) {
    state = {
      mode: "standalone",
      appId: null,
      registered: false,
      pingOk: false,
      permissions: null,
      message: "Running in standalone mode",
      error: null,
      bootstrappedAt: new Date().toISOString(),
    };
    return state;
  }

  if (state.bootstrappedAt && state.mode === "embedded") {
    return state;
  }

  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      const appId = env.RTX_APP_ID?.trim() ?? null;
      const registerResult = await registerWithRtx(fetchImpl, env);
      const pingResult = await pingRtx(fetchImpl, env);

      state = {
        mode: "embedded",
        appId,
        registered: registerResult.success,
        pingOk: pingResult.success,
        permissions: registerResult.permissions ?? null,
        message: registerResult.message ?? null,
        error: registerResult.error ?? pingResult.error ?? null,
        bootstrappedAt: new Date().toISOString(),
      };

      if (state.registered && state.pingOk) {
        console.log(`[signals-rtx] Registered Local App ${appId} with RealTimeX`);
      } else if (state.error) {
        console.warn(`[signals-rtx] Bootstrap incomplete: ${state.error}`);
      }

      return state;
    })();
  }

  return bootstrapPromise;
}
