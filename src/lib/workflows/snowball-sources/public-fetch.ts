import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { resolveSnowballSourceUrl } from "@/lib/workflows/snowball-sources/url";

const MAX_REDIRECTS = 3;
const MAX_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;

type LookupAddress = { address: string; family: number };
type LookupImpl = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<LookupAddress[]>;

export type PublicSourceResponse = {
  url: string;
  status: number;
  contentType: string;
  body: string;
};

export type PublicSourceTransport = (
  url: string,
  limits?: {
    maxRedirects?: number;
    maxBytes?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    beforeRequest?: (url: string) => boolean | void | Promise<boolean | void>;
  },
) => Promise<PublicSourceResponse>;

type PinnedResponse = PublicSourceResponse & { location?: string; bytes: number };

type PinnedRequestImpl = (
  canonicalUrl: string,
  limits: { maxBytes: number; signal: AbortSignal },
) => Promise<PinnedResponse>;

export type PublicSourceTransportDependencies = {
  lookup?: LookupImpl;
  requestPinned?: PinnedRequestImpl;
};

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("source_request_aborted");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortReason(signal);
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function createDeadlineSignal(timeoutMs: number, external?: AbortSignal): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort(abortReason(external!));
  if (external?.aborted) controller.abort(abortReason(external));
  else external?.addEventListener("abort", onExternalAbort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error("source_request_timeout")),
    Math.max(1, timeoutMs),
  );
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", onExternalAbort);
    },
  };
}

function parseIpv4(address: string): number[] | null {
  if (isIP(address) !== 4) return null;
  const octets = address.split(".").map(Number);
  return octets.length === 4 ? octets : null;
}

/** Default-deny address policy for public-source transport. */
export function isPublicSourceAddress(address: string): boolean {
  const ipv4 = parseIpv4(address);
  if (ipv4) {
    const [a, b, c] = ipv4;
    if (
      a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0 && c === 2)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113)
    ) return false;
    return true;
  }
  if (isIP(address) !== 6) return false;
  const lower = address.toLowerCase();
  const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mapped) return isPublicSourceAddress(mapped);
  // Only globally routable 2000::/3 addresses are eligible; reject documentation space too.
  if (!/^[23][0-9a-f]{3}:/.test(lower) && !/^[23][0-9a-f]{0,2}::/.test(lower)) return false;
  if (lower.startsWith("2001:db8:")) return false;
  return true;
}

async function resolvePublicAddresses(
  hostname: string,
  signal: AbortSignal,
  lookupImpl: LookupImpl,
): Promise<LookupAddress[]> {
  throwIfAborted(signal);
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("source_host_not_public");
  }
  if (isIP(host)) {
    if (!isPublicSourceAddress(host)) throw new Error("source_address_not_public");
    return [{ address: host, family: isIP(host) }];
  }
  const addresses = await abortable(lookupImpl(host, { all: true, verbatim: true }), signal);
  throwIfAborted(signal);
  if (!addresses.length || addresses.some(({ address }) => !isPublicSourceAddress(address))) {
    throw new Error("source_address_not_public");
  }
  return addresses;
}

async function requestPinned(
  canonicalUrl: string,
  limits: { maxBytes: number; signal: AbortSignal },
  lookupImpl: LookupImpl,
): Promise<PinnedResponse> {
  const url = new URL(canonicalUrl);
  const addresses = await resolvePublicAddresses(url.hostname, limits.signal, lookupImpl);
  const pinned = addresses[0]!;
  return abortable(new Promise((resolve, reject) => {
    throwIfAborted(limits.signal);
    const request = httpsRequest(url, {
      method: "GET",
      headers: {
        accept: "text/html,application/xhtml+xml;q=0.9",
        "accept-encoding": "identity",
        "user-agent": "Signals-Snowball-Source/1.0",
      },
      lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family),
    }, (response) => {
      const status = response.statusCode ?? 0;
      const contentType = String(response.headers["content-type"] ?? "");
      const location = response.headers.location;
      const declaredLength = Number(response.headers["content-length"]);
      if (Number.isFinite(declaredLength) && declaredLength > limits.maxBytes) {
        request.destroy(new Error("source_response_too_large"));
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer | string) => {
        if (limits.signal.aborted) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > limits.maxBytes) {
          request.destroy(new Error("source_response_too_large"));
          return;
        }
        chunks.push(buffer);
      });
      response.on("end", () => resolve({
        url: canonicalUrl,
        status,
        contentType,
        body: Buffer.concat(chunks).toString("utf8"),
        bytes,
        ...(location ? { location } : {}),
      }));
      response.on("aborted", () => reject(new Error("source_response_aborted")));
      response.on("error", reject);
    });
    const onAbort = () => request.destroy(abortReason(limits.signal));
    limits.signal.addEventListener("abort", onAbort, { once: true });
    request.on("close", () => limits.signal.removeEventListener("abort", onAbort));
    request.on("error", reject);
    request.end();
  }), limits.signal);
}

/** HTTPS-only, DNS-pinned, bounded transport. Every redirect is re-canonicalized and re-resolved. */
export function createPublicSnowballSourceTransport(
  dependencies: PublicSourceTransportDependencies = {},
): PublicSourceTransport {
  const lookupImpl = dependencies.lookup ?? dnsLookup;
  const requestImpl: PinnedRequestImpl = dependencies.requestPinned
    ?? ((url, limits) => requestPinned(url, limits, lookupImpl));
  return async (value, requestedLimits = {}) => {
    const limits = {
      maxRedirects: requestedLimits.maxRedirects ?? MAX_REDIRECTS,
      maxBytes: requestedLimits.maxBytes ?? MAX_BYTES,
      timeoutMs: requestedLimits.timeoutMs ?? REQUEST_TIMEOUT_MS,
    };
    let current = resolveSnowballSourceUrl(value)?.canonicalUrl;
    if (!current) throw new Error("invalid_source_url");
    const deadline = createDeadlineSignal(limits.timeoutMs, requestedLimits.signal);
    let bytesRemaining = limits.maxBytes;
    try {
      for (let redirect = 0; redirect <= limits.maxRedirects; redirect += 1) {
        throwIfAborted(deadline.signal);
        const allowed = await abortable(
          Promise.resolve(requestedLimits.beforeRequest?.(current)),
          deadline.signal,
        );
        if (allowed === false) throw new Error("source_request_budget_exhausted");
        const response = await abortable(requestImpl(current, {
          maxBytes: bytesRemaining,
          signal: deadline.signal,
        }), deadline.signal);
        bytesRemaining -= response.bytes;
        if (response.status >= 300 && response.status < 400 && response.location) {
          if (redirect === limits.maxRedirects) throw new Error("source_redirect_limit");
          const next = resolveSnowballSourceUrl(new URL(response.location, current).toString());
          if (!next) throw new Error("unsafe_source_redirect");
          current = next.canonicalUrl;
          continue;
        }
        if (response.status < 200 || response.status >= 300) throw new Error(`source_http_${response.status}`);
        if (!/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(response.contentType)) {
          throw new Error("unsupported_source_content_type");
        }
        return {
          url: current,
          status: response.status,
          contentType: response.contentType,
          body: response.body,
        };
      }
      throw new Error("source_redirect_limit");
    } finally {
      deadline.cleanup();
    }
  };
}

export const fetchPublicSnowballSource = createPublicSnowballSourceTransport();
