// Reads Gmail (read-only) for possible deadlines.
//
// * Only messages matching the owner's search filter are opened, newest first,
//   at most MAX_PER_SYNC per sync. The filter narrows what the app reads; the
//   permission Google grants (gmail.readonly) technically allows reading all mail.
// * Incremental: Gmail's history id tells whether anything new arrived. If that
//   checkpoint expired (HTTP 404), it falls back to a bounded search.
// * Only a short quote is kept. The app never sends mail, changes labels, or
//   follows instructions written in an email.

import { extractCandidates, type Candidate } from "../email";
import type { GAccount } from "../store";
import { GoogleError, type Http } from "./http";

export const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
export const MAX_PER_SYNC = 30;

type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[]; headers?: { name: string; value: string }[] };
type Message = { id: string; threadId?: string; payload?: Part; internalDate?: string };

export function decodeB64Url(data: string): string {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

function stripHtml(s: string): string {
  return s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

/** Plain-text body: prefers text/plain, falls back to text/html. */
export function bodyText(payload: Part | undefined): string {
  if (!payload) return "";
  const all: Part[] = [];
  const walk = (p: Part) => {
    all.push(p);
    p.parts?.forEach(walk);
  };
  walk(payload);
  const plain = all.find((p) => p.mimeType === "text/plain" && p.body?.data);
  if (plain) return decodeB64Url(plain.body!.data!);
  const html = all.find((p) => p.mimeType === "text/html" && p.body?.data);
  return html ? stripHtml(decodeB64Url(html.body!.data!)) : "";
}

const header = (p: Part | undefined, name: string) => p?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

export type GmailFound = { messageId: string; link: string; candidates: Candidate[] };
export type GmailSync = { found: GmailFound[]; historyId: string | null; seen: string[]; mode: "first" | "incremental" | "nothing new" | "reconciled" };

export function buildQuery(acc: GAccount, since: Date | null): string {
  const window = since ? `after:${Math.floor(since.getTime() / 1000) - 86400}` : `newer_than:${Math.max(1, Math.min(90, acc.gmailLookbackDays))}d`;
  return `${acc.gmailQuery.trim()} ${window} -in:chats`.trim();
}

async function search(http: Http, q: string): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 2; page++) {
    const r = await http.get<{ messages?: { id: string }[]; nextPageToken?: string }>(`${GMAIL}/messages`, { q, maxResults: 50, pageToken });
    ids.push(...(r.messages ?? []).map((m) => m.id));
    pageToken = r.nextPageToken;
    if (!pageToken) break;
  }
  return ids;
}

export async function fetchGmail(http: Http, acc: GAccount, now: Date): Promise<GmailSync> {
  const profile = await http.get<{ historyId?: string }>(`${GMAIL}/profile`);
  let mode: GmailSync["mode"] = "first";
  let since: Date | null = null;
  if (acc.gmailHistoryId) {
    try {
      let anyNew = false;
      let pageToken: string | undefined;
      for (let page = 0; page < 5; page++) {
        const h = await http.get<{ history?: { messagesAdded?: unknown[] }[]; nextPageToken?: string }>(`${GMAIL}/history`, {
          startHistoryId: acc.gmailHistoryId,
          historyTypes: "messageAdded",
          maxResults: 100,
          pageToken,
        });
        if ((h.history ?? []).some((x) => (x.messagesAdded ?? []).length > 0)) anyNew = true;
        pageToken = h.nextPageToken;
        if (!pageToken || anyNew) break;
      }
      if (!anyNew) return { found: [], historyId: profile.historyId ?? acc.gmailHistoryId, seen: acc.gmailSeen, mode: "nothing new" };
      mode = "incremental";
      since = acc.gmailLastSync ? new Date(acc.gmailLastSync) : null;
    } catch (e) {
      if (!(e instanceof GoogleError && e.status === 404)) throw e;
      mode = "reconciled"; // history expired: bounded search over the lookback window
    }
  }
  const ids = await search(http, buildQuery(acc, since));
  const seen = new Set(acc.gmailSeen);
  const fresh = ids.filter((id) => !seen.has(id)).slice(0, MAX_PER_SYNC);
  const found: GmailFound[] = [];
  for (const id of fresh) {
    const m = await http.get<Message>(`${GMAIL}/messages/${encodeURIComponent(id)}`, { format: "full" });
    const subject = header(m.payload, "Subject");
    const from = header(m.payload, "From");
    const date = m.internalDate ? new Date(Number(m.internalDate)) : now;
    const candidates = extractCandidates({ subject, from, body: bodyText(m.payload) }, date);
    found.push({ messageId: id, link: `https://mail.google.com/mail/?authuser=${encodeURIComponent(acc.email)}#all/${id}`, candidates });
    seen.add(id);
  }
  return { found, historyId: profile.historyId ?? null, seen: [...seen].slice(-2000), mode };
}
