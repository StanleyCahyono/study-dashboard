// Small fetch wrapper for Google APIs: bearer token, JSON, bounded retries with
// exponential backoff + jitter, and Retry-After support. Requests go straight
// from the browser to Google; nothing passes through any other server.

export class GoogleError extends Error {
  constructor(
    public status: number,
    public reason: string,
    message: string,
  ) {
    super(message);
  }
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type Http = {
  get<T>(url: string, params?: Record<string, string | number | boolean | undefined>): Promise<T>;
  send<T>(method: "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown, headers?: Record<string, string>): Promise<T>;
};

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;

export function withParams(url: string, params?: Record<string, string | number | boolean | undefined>): string {
  if (!params) return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") u.searchParams.set(k, String(v));
  return u.toString();
}

export function makeHttp(token: () => string, fetchImpl: FetchLike = (u, i) => fetch(u, i), sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)), random = Math.random): Http {
  async function request<T>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method,
          headers: { Authorization: `Bearer ${token()}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
          body: body === undefined ? undefined : JSON.stringify(body),
          cache: "no-store",
        });
      } catch (e) {
        // Network failure: the request may or may not have reached Google. Callers
        // that create things use deterministic IDs, so retrying is safe.
        lastErr = e;
        await sleep(backoff(attempt, null, random));
        continue;
      }
      if (res.ok) {
        if (res.status === 204) return undefined as T;
        const text = await res.text();
        return (text ? JSON.parse(text) : undefined) as T;
      }
      const errBody = await res.json().catch(() => ({}));
      const reason: string = errBody?.error?.errors?.[0]?.reason ?? errBody?.error?.status ?? "";
      const message: string = errBody?.error?.message ?? res.statusText;
      const rateLimited = res.status === 403 && /rateLimitExceeded|userRateLimitExceeded/.test(reason);
      if ((RETRYABLE.has(res.status) || rateLimited) && attempt < MAX_ATTEMPTS - 1) {
        await sleep(backoff(attempt, res.headers.get("Retry-After"), random));
        continue;
      }
      throw new GoogleError(res.status, reason || String(res.status), message);
    }
    throw lastErr instanceof Error ? lastErr : new Error("Network error talking to Google.");
  }
  return {
    get: (url, params) => request("GET", withParams(url, params)),
    send: (method, url, body, headers) => request(method, url, body, headers),
  };
}

export function backoff(attempt: number, retryAfter: string | null, random = Math.random): number {
  const ra = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(ra) && ra >= 0) return Math.min(60_000, ra * 1000);
  return Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(random() * 500);
}

export function describeError(e: unknown): string {
  if (e instanceof GoogleError) {
    if (e.status === 401) return "Signed out (token expired or access removed). Sign in again.";
    if (e.status === 403 && /accessNotConfigured|SERVICE_DISABLED/i.test(e.reason + e.message)) return "This Google API isn’t enabled in your Google Cloud project (see setup steps).";
    if (e.status === 403 && /insufficient|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(e.reason + e.message)) return "Permission for this wasn’t granted. Sign in again and allow it.";
    if (e.status === 403) return `Google refused: ${e.message}`;
    return `Google error ${e.status}: ${e.message}`;
  }
  return e instanceof Error ? e.message : String(e);
}
