// Same-origin JSON client. Private responses are never cached (server sends
// no-store and the service worker ignores /api/*).

export type PublicStatus = { profile: "real" | "demo"; enrolled: boolean };

export type NextClass = {
  course_code: string;
  course_title: string;
  kind: string;
  location: string | null;
  starts_at: string;
  ends_at: string;
  in_progress: boolean;
  minutes_until_start: number;
};

export type NextTask = {
  id: number;
  title: string;
  course_code: string | null;
  due_at: string | null;
  due_known: boolean;
  estimated_minutes: number | null;
};

export type Today = {
  profile: "real" | "demo";
  now: string;
  timezone: string;
  next_class: NextClass | null;
  next_task: NextTask | null;
  overdue_count: number;
  sync: { state: "demo" | "no_sources" | "ok" | "stale" | "error"; label: string; sources_connected: number; last_success_at: string | null };
};

export type Device = {
  session_id: string;
  device_label: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  current: boolean;
};

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfter?: number) {
    super(message);
  }
}

export class NetworkError extends Error {}

let csrfToken: string | null = null;

export function setCsrf(token: string | null) {
  csrfToken = token;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "X-StudyDash": "1", Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && csrfToken) headers["X-CSRF-Token"] = csrfToken;
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new NetworkError("network");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const retry = res.headers.get("Retry-After");
    throw new ApiError(res.status, data.error ?? data.detail ?? "error", data.message ?? data.detail ?? res.statusText, retry ? Number(retry) : undefined);
  }
  return data as T;
}

export const api = {
  publicStatus: () => request<PublicStatus>("GET", "/api/public/status"),
  session: () => request<{ csrf_token: string; profile: string; device_label: string; session_id: string }>("GET", "/api/auth/session"),
  login: (passphrase: string, device_label?: string) =>
    request<{ csrf_token: string }>("POST", "/api/auth/login", { passphrase, device_label: device_label || undefined }),
  enroll: (code: string, passphrase: string, device_label?: string) =>
    request<{ csrf_token: string }>("POST", "/api/auth/enroll", { code, passphrase, device_label: device_label || undefined }),
  logout: () => request<{ ok: true }>("POST", "/api/auth/logout"),
  today: () => request<Today>("GET", "/api/today"),
  devices: () => request<{ devices: Device[] }>("GET", "/api/auth/devices"),
  revoke: (id: string) => request<{ ok: true }>("POST", `/api/auth/devices/${encodeURIComponent(id)}/revoke`),
};
