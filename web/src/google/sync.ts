// Runs Google syncs for the screens. Each account and each source fails on its
// own: one expired sign-in or broken calendar never stops the others.

import { addCandidates } from "../inbox";
import { addLog, dayKey, getData, update, type Data, type GAccount } from "../store";
import { buildPlan } from "../plan";
import { checkIdentity, fetchIdentity, getToken, loadGis, requestToken, scopesFor, setToken, type Token } from "./auth";
import { applyCalendarChanges, fetchCalendarChanges, listCalendars } from "./calendar";
import { fetchGmail } from "./gmail";
import { describeError, makeHttp, type Http } from "./http";
import { publishPlan, undoLastPublish } from "./publish";

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function patchAccount(id: string, patch: Partial<GAccount>) {
  update((d) => ({ ...d, accounts: d.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
}

export function isPlanner(d: Data, acc: GAccount) {
  return d.gplan.accountId === acc.id;
}

/** Sign in (opens Google's window). Must be called straight from a tap. */
export async function signIn(acc: GAccount, firstTime: boolean): Promise<Token> {
  const d = getData();
  if (!d.googleClientId) throw new Error("Add your Google client ID first (More → Google).");
  await loadGis();
  const tok = await requestToken(d.googleClientId, acc, scopesFor(acc, isPlanner(d, acc)), firstTime);
  const id = await fetchIdentity(tok.token);
  const problem = checkIdentity(acc, id);
  if (problem) throw new Error(problem);
  setToken(acc.id, tok);
  patchAccount(acc.id, { sub: id.sub, lastError: null });
  return tok;
}

export function httpFor(acc: GAccount): Http | null {
  const t = getToken(acc.id);
  return t ? makeHttp(() => t.token) : null;
}

export async function loadCalendars(acc: GAccount): Promise<void> {
  const http = httpFor(acc);
  if (!http) throw new Error("Sign in first.");
  const list = await listCalendars(http);
  const planCal = getData().gplan.calendarId;
  update((d) => ({
    ...d,
    accounts: d.accounts.map((a) => {
      if (a.id !== acc.id) return a;
      const old = new Map(a.calendars.map((c) => [c.id, c]));
      return {
        ...a,
        calendars: list.map(
          (c) =>
            old.get(c.id) ?? {
              id: c.id,
              summary: c.summary,
              primary: c.primary,
              // The Study Plan calendar is never read back as busy time.
              role: c.id === planCal ? "ignore" : c.primary ? "fixed" : "ignore",
              syncToken: null,
              lastSync: null,
              error: null,
            },
        ),
      };
    }),
  }));
}

/** Syncs one account with the token it already has. Returns a short summary. */
export async function syncAccount(accountId: string, now = new Date()): Promise<string> {
  const acc = getData().accounts.find((a) => a.id === accountId);
  if (!acc) return "Account not found.";
  const http = httpFor(acc);
  if (!http) return `${acc.email}: sign in to sync.`;
  const parts: string[] = [];
  if (acc.useCalendar) {
    for (const cal of acc.calendars.filter((c) => c.role !== "ignore" && c.id !== getData().gplan.calendarId)) {
      try {
        const changes = await fetchCalendarChanges(http, acc, cal, now, getData().includeDeclined);
        update((d) => applyCalendarChanges(d, d.accounts.find((a) => a.id === acc.id)!, cal, changes, now));
        parts.push(`${cal.summary} ✓`);
      } catch (e) {
        const msg = describeError(e);
        update((d) =>
          addLog(
            { ...d, accounts: d.accounts.map((a) => (a.id !== acc.id ? a : { ...a, calendars: a.calendars.map((c) => (c.id === cal.id ? { ...c, error: msg } : c)) })) },
            `${acc.email} · ${cal.summary}`,
            `Sync failed: ${msg}`,
          ),
        );
        parts.push(`${cal.summary}: ${msg}`);
      }
    }
  }
  if (acc.useMail) {
    try {
      const g = await fetchGmail(http, getData().accounts.find((a) => a.id === acc.id)!, now);
      let added = 0;
      let merged = 0;
      update((d) => {
        let out = d;
        for (const f of g.found) {
          const r = addCandidates(out, f.candidates, { accountId: acc.id, link: f.link });
          out = r.data;
          added += r.added;
          merged += r.merged;
        }
        out = { ...out, accounts: out.accounts.map((a) => (a.id === acc.id ? { ...a, gmailHistoryId: g.historyId, gmailSeen: g.seen, gmailLastSync: now.toISOString(), gmailError: null } : a)) };
        return g.found.length ? addLog(out, `${acc.email} · Gmail`, `${g.found.length} new matching email(s): ${added} deadline(s) to review, ${merged} matched existing ones.`) : out;
      });
      parts.push(`Gmail ✓ (${g.mode})`);
    } catch (e) {
      const msg = describeError(e);
      update((d) => addLog({ ...d, accounts: d.accounts.map((a) => (a.id === acc.id ? { ...a, gmailError: msg } : a)) }, `${acc.email} · Gmail`, `Sync failed: ${msg}`));
      parts.push(`Gmail: ${msg}`);
    }
  }
  return `${acc.email}: ${parts.join(", ") || "nothing selected to sync"}`;
}

/** Syncs every account that's signed in; lists the others. Then auto-publishes if enabled. */
export async function syncAll(now = new Date()): Promise<string[]> {
  const out: string[] = [];
  for (const acc of getData().accounts) out.push(await syncAccount(acc.id, now));
  const d = getData();
  if (d.gplan.auto && d.gplan.accountId) {
    try {
      const r = await publishNow(new Date());
      out.push(`Study Plan: ${r}`);
    } catch (e) {
      out.push(`Study Plan: ${describeError(e)}`);
    }
  }
  return out;
}

export async function publishNow(now = new Date()): Promise<string> {
  const d = getData();
  const acc = d.accounts.find((a) => a.id === d.gplan.accountId);
  if (!acc) throw new Error("Choose which Google account holds the Study Plan calendar.");
  const http = httpFor(acc);
  if (!http) throw new Error(`Sign in to ${acc.email} first.`);
  const energy = d.days[dayKey(now)]?.energy;
  const plan = buildPlan(d, now, { energy });
  const r = await publishPlan(http, getData, update, plan, now, tz());
  return `${r.created} added, ${r.removed} removed, ${r.preserved} kept as you edited, ${r.suppressed} you deleted`;
}

export async function undoPublish(): Promise<number> {
  const d = getData();
  const acc = d.accounts.find((a) => a.id === d.gplan.accountId);
  if (!acc) return 0;
  const http = httpFor(acc);
  if (!http) throw new Error(`Sign in to ${acc.email} first.`);
  return undoLastPublish(http, getData, update);
}
