import { useState } from "react";
import { update, useData, type Data } from "./store";
import type { Plan } from "./plan";
import { desiredBlocks, diffPlan, type PlanDiff } from "./google/publish";
import { getToken } from "./google/auth";
import { describeError } from "./google/http";
import { publishNow, undoPublish } from "./google/sync";
import { fmtTime, fmtWhen } from "./ui";

/** Optional: publish planned blocks to a private "Study Plan" calendar in Google. */
export function PlanCalendar({ plan, now }: { plan: Plan; now: Date }) {
  const data = useData();
  const [preview, setPreview] = useState<PlanDiff | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const calAccounts = data.accounts.filter((a) => a.useCalendar);
  const acc = data.accounts.find((a) => a.id === data.gplan.accountId);
  const signedIn = acc ? !!getToken(acc.id) : false;

  if (!calAccounts.length) {
    return (
      <section className="card" aria-labelledby="gplan-title">
        <h2 id="gplan-title">Google Calendar</h2>
        <p className="small muted">Connect a Google account (More → Google Calendar and Gmail) to publish this plan to a private Study Plan calendar.</p>
      </section>
    );
  }

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    try {
      setMsg(await fn());
      setPreview(null);
    } catch (e) {
      setMsg(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="gplan-title">
      <h2 id="gplan-title">Google Calendar: Study Plan</h2>
      <p className="small">
        Puts your next 7 days of study blocks into a separate private calendar called <strong>Study Plan</strong>. It never changes your other calendars or invites
        anyone. If you move or delete a block in Google, the app keeps your change.
      </p>
      <label>
        Account
        <select value={data.gplan.accountId ?? ""} onChange={(e) => update((d) => ({ ...d, gplan: { ...d.gplan, accountId: e.target.value || null, calendarId: e.target.value === d.gplan.accountId ? d.gplan.calendarId : null, published: e.target.value === d.gplan.accountId ? d.gplan.published : [] } }))}>
          <option value="">Choose…</option>
          {calAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.email}
            </option>
          ))}
        </select>
      </label>
      {acc && !signedIn && <p className="small muted">Sign in to {acc.email} in More → Google Calendar and Gmail first (sign-ins last about an hour).</p>}
      <div className="row actions">
        <button className="btn" disabled={!acc} onClick={() => setPreview(diffPlan(data, desiredBlocks(data, plan, now), now))}>
          Preview changes
        </button>
        <button className="btn primary" disabled={!acc || !signedIn || busy} onClick={() => run(publishNow)}>
          {busy ? "Working…" : "Publish to Google"}
        </button>
        <button className="btn" disabled={!acc || !signedIn || busy || data.gplan.lastCreated.length === 0} onClick={() => run(async () => `Undo: removed ${await undoPublish()} block(s).`)}>
          Undo last publish
        </button>
      </div>
      <label className="check small">
        <input type="checkbox" checked={data.gplan.auto} disabled={!acc} onChange={(e) => update((d) => ({ ...d, gplan: { ...d.gplan, auto: e.target.checked } }))} />
        <span>Update automatically after each sync (only future blocks the app made, never ones you edited)</span>
      </label>
      {data.gplan.lastPublish && <p className="small muted">Last published {fmtWhen(data.gplan.lastPublish)}.</p>}
      {msg && (
        <p className="banner small" role="status">
          {msg}
        </p>
      )}
      {preview && <PreviewList diff={preview} data={data} />}
    </section>
  );
}

function PreviewList({ diff, data }: { diff: PlanDiff; data: Data }) {
  return (
    <div className="preview-list" role="status">
      <p>
        <strong>Preview</strong> (nothing changed yet): {diff.create.length} to add, {diff.remove.length} to remove, {diff.keep.length} unchanged
        {diff.suppressed ? `, ${diff.suppressed} you deleted before (won’t be re-added)` : ""}.
      </p>
      <ul className="small">
        {diff.create.map((c) => (
          <li key={c.key}>
            + {fmtWhen(c.start)}–{fmtTime(c.end)} {c.title}
          </li>
        ))}
        {diff.remove.map((r) => (
          <li key={r.key}>
            − {fmtWhen(r.start)}–{fmtTime(r.end)} {r.title}
          </li>
        ))}
      </ul>
      {data.gplan.published.some((p) => p.state === "user_moved") && <p className="small muted">Blocks you moved in Google are kept where you put them.</p>}
    </div>
  );
}
