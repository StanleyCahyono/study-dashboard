// Google sign-in with Google Identity Services (token model). The browser gets a
// short-lived access token (about 1 hour) directly from Google. Tokens are kept
// only in memory and in this tab's sessionStorage (cleared when the app closes);
// there are no refresh tokens and no server.

import type { GAccount } from "../store";
import { makeHttp, type FetchLike } from "./http";

export const GIS_SRC = "https://accounts.google.com/gsi/client";

export const SCOPE = {
  identity: ["openid", "email"],
  calendarRead: "https://www.googleapis.com/auth/calendar.readonly",
  // Only calendars this app creates: it can't see or change your other calendars' events through this.
  calendarWrite: "https://www.googleapis.com/auth/calendar.app.created",
  gmailRead: "https://www.googleapis.com/auth/gmail.readonly",
};

export function scopesFor(acc: GAccount, planner: boolean): string[] {
  const s = [...SCOPE.identity];
  if (acc.useCalendar) s.push(SCOPE.calendarRead);
  if (planner) s.push(SCOPE.calendarWrite);
  if (acc.useMail) s.push(SCOPE.gmailRead);
  return s;
}

type TokenResponse = { access_token?: string; expires_in?: number | string; scope?: string; error?: string; error_description?: string };
type TokenClient = { requestAccessToken: (o?: { prompt?: string; login_hint?: string }) => void };
type Gis = {
  accounts: {
    oauth2: {
      initTokenClient: (cfg: Record<string, unknown>) => TokenClient;
      revoke: (token: string, done?: () => void) => void;
    };
  };
};
declare global {
  interface Window {
    google?: Gis;
  }
}

let loading: Promise<void> | null = null;

/** Loads Google's sign-in script (only once the owner has set a client ID). */
export function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error("Couldn’t load Google sign-in. Check your connection."));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export type Token = { token: string; exp: number; scopes: string[] };
const memory = new Map<string, Token>();
const KEY = (id: string) => `gtok:${id}`;

export function getToken(accountId: string, now = Date.now()): Token | null {
  let t = memory.get(accountId) ?? null;
  if (!t) {
    try {
      const raw = sessionStorage.getItem(KEY(accountId));
      if (raw) t = JSON.parse(raw) as Token;
    } catch {
      t = null;
    }
  }
  if (!t || t.exp - 60_000 <= now) return null;
  memory.set(accountId, t);
  return t;
}

export function setToken(accountId: string, t: Token) {
  memory.set(accountId, t);
  try {
    sessionStorage.setItem(KEY(accountId), JSON.stringify(t));
  } catch {
    /* memory only */
  }
}

export function forgetToken(accountId: string) {
  memory.delete(accountId);
  try {
    sessionStorage.removeItem(KEY(accountId));
  } catch {
    /* ignore */
  }
}

/**
 * Opens Google's sign-in window for one account. Call it directly from a tap
 * (browsers only allow sign-in windows from a user action).
 */
export function requestToken(clientId: string, acc: GAccount, scopes: string[], firstTime: boolean): Promise<Token> {
  return new Promise((resolve, reject) => {
    const g = window.google;
    if (!g?.accounts?.oauth2) {
      reject(new Error("Google sign-in isn’t loaded yet. Try again in a moment."));
      return;
    }
    const client = g.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: scopes.join(" "),
      include_granted_scopes: true,
      login_hint: acc.email,
      callback: (r: TokenResponse) => {
        if (r.error || !r.access_token) {
          reject(new Error(r.error_description || r.error || "Google sign-in failed."));
          return;
        }
        const granted = (r.scope ?? "").split(/\s+/).filter(Boolean);
        resolve({ token: r.access_token, exp: Date.now() + Number(r.expires_in ?? 3600) * 1000, scopes: granted });
      },
      error_callback: (e: { type?: string; message?: string }) =>
        reject(new Error(e?.type === "popup_closed" ? "The Google sign-in window was closed." : e?.type === "popup_failed_to_open" ? "The sign-in window was blocked. Allow pop-ups for this site." : e?.message || "Google sign-in failed.")),
    });
    client.requestAccessToken({ prompt: firstTime ? "consent" : "" });
  });
}

export type Identity = { email: string; sub: string };

export async function fetchIdentity(token: string, fetchImpl?: FetchLike): Promise<Identity> {
  const http = makeHttp(() => token, fetchImpl);
  const me = await http.get<{ email?: string; sub?: string; email_verified?: boolean }>("https://www.googleapis.com/oauth2/v3/userinfo");
  if (!me.email || !me.sub) throw new Error("Google didn’t return the account’s email.");
  return { email: me.email.toLowerCase(), sub: me.sub };
}

/** The connected account must be the one the owner meant, and stay the same Google account. */
export function checkIdentity(acc: GAccount, id: Identity): string | null {
  if (id.email !== acc.email.toLowerCase()) return `You signed in as ${id.email}, but this connection is for ${acc.email}. Pick ${acc.email} in the Google window.`;
  if (acc.sub && acc.sub !== id.sub) return `${acc.email} now belongs to a different Google account than before. Disconnect it and connect again.`;
  return null;
}

export function revokeToken(token: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      window.google?.accounts?.oauth2?.revoke(token, () => resolve());
      setTimeout(resolve, 3000);
    } catch {
      resolve();
    }
  });
}
