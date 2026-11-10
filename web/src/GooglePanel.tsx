import { useState, type FormEvent } from "react";
import { getData, newAccount, update, useData, type CalRole, type Data, type GAccount } from "./store";
import { forgetToken, getToken, loadGis, revokeToken } from "./google/auth";
import { describeError } from "./google/http";
import { isPlanner, loadCalendars, signIn, syncAccount } from "./google/sync";
import { Details, fmtWhen } from "./ui";

const ROLES: [CalRole, string][] = [
  ["ignore", "Don’t use"],
  ["classes", "Classes / labs"],
  ["fixed", "Fixed events"],
  ["busy", "Busy only (hide titles)"],
  ["deadlines", "Deadlines → tasks (e.g. Canvas)"],
];

export const ORIGIN_HINT = typeof location === "undefined" ? "" : location.origin;

export function GooglePanel() {
  const data = useData();
  const [clientId, setClientId] = useState(data.googleClientId);
  const [email, setEmail] = useState("");
  const [cal, setCal] = useState(true);
  const [mail, setMail] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function saveClientId(e: FormEvent) {
    e.preventDefault();
    const v = clientId.trim();
    if (v && !/^[\w-]+\.apps\.googleusercontent\.com$/.test(v)) {
      setMsg("That doesn’t look like a Google client ID (it ends in .apps.googleusercontent.com).");
      return;
    }
    update((d) => ({ ...d, googleClientId: v }));
    if (v) loadGis().catch(() => undefined);
    setMsg(v ? "Client ID saved on this device." : "Client ID removed.");
  }

  async function addAccount(e: FormEvent) {
    e.preventDefault();
    const addr = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return setMsg("Enter the Google account’s email address.");
    if (data.accounts.some((a) => a.email === addr)) return setMsg("That account is already added.");
    if (!cal && !mail) return setMsg("Choose Calendar, Gmail or both.");
    const acc: GAccount = { ...newAccount(addr), useCalendar: cal, useMail: mail };
    update((d) => ({ ...d, accounts: [...d.accounts, acc], gplan: d.gplan.accountId ? d.gplan : { ...d.gplan, accountId: cal ? acc.id : null } }));
    setEmail("");
    setMsg(null);
    try {
      await signIn(getData().accounts.find((a) => a.id === acc.id)!, true);
      if (acc.useCalendar) await loadCalendars(getData().accounts.find((a) => a.id === acc.id)!);
      setMsg(`Connected ${addr}. Choose how each calendar is used, then Sync.`);
    } catch (err) {
      update((d) => ({ ...d, accounts: d.accounts.map((a) => (a.id === acc.id ? { ...a, lastError: describeError(err) } : a)) }));
      setMsg(`${addr}: ${describeError(err)}`);
    }
  }

  return (
    <section className="card" aria-labelledby="google-title">
      <h2 id="google-title">Google Calendar and Gmail</h2>
      <p className="small">
        Your browser talks to Google directly. Nothing passes through any other server, and sign-ins last about an hour (tap Sync to refresh). Calendar is
        read-only except a separate <strong>Study Plan</strong> calendar this app creates. Gmail is read-only: the app never sends mail or changes labels.
      </p>
      {msg && (
        <p className="banner small" role="status">
          {msg}
        </p>
      )}

      <Details summary={data.googleClientId ? "Google client ID (set)" : "Step 1: set up Google sign-in (one time, ~10 min)"} open={!data.googleClientId}>
        <ol className="small steps-list">
          <li>
            Open <strong>console.cloud.google.com</strong>, pick or create a project (e.g. “study”).
          </li>
          <li>
            <strong>APIs &amp; Services → Library</strong>: enable <strong>Google Calendar API</strong> and <strong>Gmail API</strong>.
          </li>
          <li>
            <strong>Google Auth Platform → Branding</strong>: app name “Study”, your email as support and developer contact. <strong>Audience</strong>: External,
            keep it in <strong>Testing</strong>, and add each Google address you’ll connect as a <strong>test user</strong>.
          </li>
          <li>
            <strong>Data Access</strong>: add the scopes <code>calendar.readonly</code>, <code>calendar.app.created</code>, <code>gmail.readonly</code>,{" "}
            <code>openid</code>, <code>email</code>.
          </li>
          <li>
            <strong>Clients → Create client</strong> → Web application. Under <strong>Authorized JavaScript origins</strong> add <code>{ORIGIN_HINT || "https://YOUR-NAME.github.io"}</code>. No
            redirect URI is needed.
          </li>
          <li>Copy the Client ID (ends in .apps.googleusercontent.com) and paste it below. It isn’t a secret.</li>
        </ol>
        <p className="small muted">
          Google will say the app is unverified: that’s expected for a personal app in Testing. In Testing, Google may ask you to approve again after 7 days.
          A school Google Workspace account may block unverified apps; if so, the exact error appears here and you can keep using .ics and email paste.
        </p>
        <form className="row" onSubmit={saveClientId}>
          <input aria-label="Google client ID" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="1234-abc.apps.googleusercontent.com" />
          <button className="btn" type="submit">Save</button>
        </form>
      </Details>

      {data.googleClientId && (
        <form className="form compact" onSubmit={addAccount} aria-label="Add a Google account">
          <h3>Add an account</h3>
          <label>
            Google account email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
          </label>
          <label className="check">
            <input type="checkbox" checked={cal} onChange={(e) => setCal(e.target.checked)} />
            <span>Calendar (read, plus the Study Plan calendar)</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={mail} onChange={(e) => setMail(e.target.checked)} />
            <span>Gmail (read-only; finds deadlines for you to review)</span>
          </label>
          <button className="btn primary" type="submit">Connect with Google</button>
        </form>
      )}

      <ul className="plain">
        {data.accounts.map((a) => (
          <AccountCard key={a.id} acc={a} data={data} onMsg={setMsg} />
        ))}
      </ul>

      {data.accounts.length > 0 && (
        <label className="check small">
          <input type="checkbox" checked={data.includeDeclined} onChange={(e) => update((d) => ({ ...d, includeDeclined: e.target.checked, accounts: d.accounts.map((x) => ({ ...x, calendars: x.calendars.map((c) => ({ ...c, syncToken: null })) })) }))} />
          <span>Treat invitations I declined as busy (normally they’re ignored)</span>
        </label>
      )}

      <Details summary={`Sync activity (${data.log.length})`}>
        {data.log.length === 0 && <p className="small muted">Nothing yet.</p>}
        <ul className="small log">
          {data.log.slice(0, 50).map((l, i) => (
            <li key={i}>
              <span className="muted">{fmtWhen(l.at)}</span> · <strong>{l.source}</strong>: {l.message}
            </li>
          ))}
        </ul>
      </Details>
    </section>
  );
}

function AccountCard({ acc, data, onMsg }: { acc: GAccount; data: Data; onMsg: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const token = getToken(acc.id);
  const set = (patch: Partial<GAccount>) => update((d) => ({ ...d, accounts: d.accounts.map((a) => (a.id === acc.id ? { ...a, ...patch } : a)) }));
  const lastCal = acc.calendars.map((c) => c.lastSync).filter(Boolean).sort().pop();

  async function run(fn: () => Promise<string | void>) {
    setBusy(true);
    try {
      const r = await fn();
      if (r) onMsg(r);
    } catch (e) {
      set({ lastError: describeError(e) });
      onMsg(`${acc.email}: ${describeError(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm(`Disconnect ${acc.email}? Its synced events and unfinished synced tasks are removed from this device; tasks you worked on are kept.`)) return;
    const t = getToken(acc.id);
    if (t) await revokeToken(t.token);
    forgetToken(acc.id);
    update((d) => ({
      ...d,
      accounts: d.accounts.filter((a) => a.id !== acc.id),
      commitments: d.commitments.filter((c) => c.accountId !== acc.id),
      tasks: d.tasks.filter((t2) => !(t2.accountId === acc.id && !t2.done && t2.spentMinutes === 0)),
      inbox: d.inbox.filter((i) => i.accountId !== acc.id),
      gplan: d.gplan.accountId === acc.id ? { ...d.gplan, accountId: null, auto: false } : d.gplan,
    }));
    onMsg(`${acc.email} disconnected and its synced data deleted from this device. The Study Plan calendar (if any) stays in Google until you delete it there.`);
  }

  return (
    <li className="account">
      <div className="row">
        <div>
          <p className="big">{acc.email}</p>
          <p className="small muted">
            {[acc.useCalendar && "Calendar", acc.useMail && "Gmail", isPlanner(data, acc) && "Study Plan"].filter(Boolean).join(" · ")} ·{" "}
            {token ? <span>✓ signed in until {new Date(token.exp).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span> : <span>○ signed out</span>}
          </p>
          <p className="small muted">
            {lastCal ? `Calendar synced ${fmtWhen(lastCal)}` : acc.useCalendar ? "Calendar not synced yet" : ""}
            {acc.useMail && ` · ${acc.gmailLastSync ? `Gmail checked ${fmtWhen(acc.gmailLastSync)}` : "Gmail not checked yet"}`}
          </p>
          {acc.lastError && (
            <p className="error small" role="alert">
              ⚠ {acc.lastError}
            </p>
          )}
          {acc.gmailError && <p className="error small">⚠ Gmail: {acc.gmailError}</p>}
        </div>
      </div>
      <div className="row actions">
        {token ? (
          <button className="btn primary" disabled={busy} onClick={() => run(() => syncAccount(acc.id))}>
            {busy ? "Syncing…" : "Sync now"}
          </button>
        ) : (
          <button
            className="btn primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await signIn(acc, !acc.sub);
                if (acc.useCalendar && acc.calendars.length === 0) await loadCalendars(getData().accounts.find((a) => a.id === acc.id)!);
                return syncAccount(acc.id);
              })
            }
          >
            Sign in and sync
          </button>
        )}
        {acc.useCalendar && token && (
          <button className="btn" disabled={busy} onClick={() => run(async () => (await loadCalendars(acc), "Calendar list refreshed."))}>
            Refresh calendar list
          </button>
        )}
        <button className="btn danger" onClick={disconnect}>Disconnect and delete</button>
      </div>

      {acc.useCalendar && acc.calendars.length > 0 && (
        <Details summary={`Calendars (${acc.calendars.filter((c) => c.role !== "ignore").length} used)`}>
          <ul className="plain">
            {acc.calendars.map((c) => (
              <li key={c.id} className="cal-row">
                <span>
                  {c.summary}
                  {c.primary && <span className="tag">Main</span>}
                  {c.id === data.gplan.calendarId && <span className="tag">Study Plan</span>}
                  {c.error && <span className="error small"> ⚠ {c.error}</span>}
                </span>
                <select
                  aria-label={`How to use ${c.summary}`}
                  value={c.role}
                  disabled={c.id === data.gplan.calendarId}
                  onChange={(e) => set({ calendars: acc.calendars.map((x) => (x.id === c.id ? { ...x, role: e.target.value as CalRole, syncToken: null } : x)) })}
                >
                  {ROLES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
          <p className="small muted">Tip: subscribe to your Canvas calendar feed in Google Calendar, then set it to “Deadlines → tasks”.</p>
        </Details>
      )}

      {acc.useMail && (
        <Details summary="Gmail filter">
          <p className="small">
            Only emails matching this Gmail search are opened (at most 30 per sync). Note: Google’s read-only permission technically covers your whole mailbox; this
            filter is what the app actually reads.
          </p>
          <label>
            Search
            <textarea rows={3} value={acc.gmailQuery} onChange={(e) => set({ gmailQuery: e.target.value })} />
          </label>
          <label>
            Look back (days, first sync)
            <input type="number" inputMode="numeric" min={1} max={90} value={acc.gmailLookbackDays} onChange={(e) => set({ gmailLookbackDays: Math.max(1, Math.min(90, Number(e.target.value) || 14)) })} />
          </label>
        </Details>
      )}
      <label className="check small">
        <input type="checkbox" checked={acc.useMail} onChange={(e) => set({ useMail: e.target.checked })} />
        <span>Use Gmail for this account (sign in again to grant it)</span>
      </label>
    </li>
  );
}
