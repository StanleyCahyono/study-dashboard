import { useMemo, useState } from "react";
import { dayKey, update, updateTask, useData, type Data, type Outcome } from "./store";
import { buildPlan, type Plan } from "./plan";
import { activeMs, activeSession, answerCheckin, cancelSession, finishSession, pauseSession, pendingCheckins, resumeSession, skipCheckin, startSession } from "./session";
import { isScheduled, doneOn } from "./habits";
import { buildBriefing, DEFAULT_FIELDS, type BriefingFields } from "./briefing";
import { copyText, Details, fmtTime, fmtWhen, mins, numOrNull, rel, Segmented, tz, useNow } from "./ui";
import { getToken } from "./google/auth";
import { syncAll } from "./google/sync";

export type Go = (tab: "Plan" | "Tasks" | "Courses" | "More") => void;

export function TodayView({ go }: { go: Go }) {
  const data = useData();
  const now = useNow(1000);
  const minute = Math.floor(now.getTime() / 60000);
  const energy = data.days[dayKey(now)]?.energy ?? "normal";
  // Recompute the plan once a minute or when data changes (not every second).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const plan = useMemo(() => buildPlan(data, new Date(minute * 60000), { energy }), [data, minute, energy]);
  const empty = data.courses.length === 0 && data.tasks.length === 0;
  const session = activeSession(data);
  const checkins = pendingCheckins(data, now.getTime());
  const pendingInbox = data.inbox.filter((i) => i.status === "pending").length;

  return (
    <main className="page" aria-labelledby="today-title">
      <header className="today-header">
        <div>
          <h1 id="today-title">Today</h1>
          <p className="muted">{now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
        </div>
        <p className="clock" aria-label={`Current time ${now.toLocaleTimeString()}`}>
          <time dateTime={now.toISOString()}>{now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })}</time>
          <span className="tz">{tz.replace("_", " ")}</span>
        </p>
      </header>

      {empty && (
        <section className="card intro" aria-labelledby="start-title">
          <h2 id="start-title">Get started</h2>
          <p>Add your classes and what’s due. Everything stays on this device only.</p>
          <div className="row actions">
            <button className="btn primary" onClick={() => go("Courses")}>Add courses</button>
            <button className="btn" onClick={() => go("Tasks")}>Add a task</button>
            <button className="btn" onClick={() => go("More")}>Import or try demo</button>
          </div>
        </section>
      )}

      {pendingInbox > 0 && (
        <p className="banner" role="status">
          {pendingInbox} suggested {pendingInbox === 1 ? "deadline" : "deadlines"} from email to review.{" "}
          <button className="link inline" onClick={() => go("More")}>Review</button>
        </p>
      )}
      {plan.atRisk.length > 0 && (
        <p className="banner warn" role="status">
          <span aria-hidden="true">! </span>
          {plan.atRisk.length} {plan.atRisk.length === 1 ? "deadline doesn’t" : "deadlines don’t"} fit your free time ({mins(plan.atRisk.reduce((s, t) => s + t.missing, 0))} short).{" "}
          <button className="link inline" onClick={() => go("Plan")}>See options</button>
        </p>
      )}

      {session ? <RunningBlock data={data} now={now} /> : null}
      {checkins.map((s) => (
        <CheckinCard key={s.id} data={data} sessionId={s.id} />
      ))}

      <div className="grid">
        <section className="card span2" aria-labelledby="next-title">
          <div className="row">
            <h2 id="next-title">Next action</h2>
            <Segmented
              label="Energy"
              value={energy}
              options={[
                { value: "deep", label: "Ready for deep work" },
                { value: "normal", label: "Normal" },
                { value: "light", label: "Prefer lighter" },
              ]}
              onChange={(v) => update((d) => ({ ...d, days: { ...d.days, [dayKey(new Date())]: { ...d.days[dayKey(new Date())], energy: v } } }))}
            />
          </div>
          <NextAction plan={plan} data={data} now={now} busy={!!session} />
        </section>

        <section className="card" aria-labelledby="fixed-title">
          <h2 id="fixed-title">Next fixed commitment</h2>
          <NextFixed plan={plan} now={now} />
        </section>

        <section className="card" aria-labelledby="rest-title">
          <h2 id="rest-title">Rest of today</h2>
          <RestOfToday plan={plan} data={data} now={now} />
        </section>

        <HabitsToday data={data} now={now} go={go} />

        <section className="card" aria-labelledby="data-title">
          <h2 id="data-title">Your data</h2>
          <SyncStatus data={data} go={go} />
          <p className="muted small">
            {data.courses.length} {data.courses.length === 1 ? "course" : "courses"} · {data.tasks.filter((t) => !t.done).length} open{" "}
            {data.tasks.filter((t) => !t.done).length === 1 ? "task" : "tasks"}. Export a backup under More.
          </p>
          <Briefing data={data} plan={plan} />
        </section>
      </div>
    </main>
  );
}

function NextAction({ plan, data, now, busy }: { plan: Plan; data: Data; now: Date; busy: boolean }) {
  const [swapOpen, setSwapOpen] = useState(false);
  const n = plan.next;
  if (!n) {
    const waiting = plan.tasks.find((t) => t.waitingOn);
    return (
      <p className="muted">
        {waiting ? `${waiting.waitingOn}.` : data.settings.device === "phone" && plan.tasks.some((t) => t.task.needs !== "any") ? "Nothing that fits a phone right now. Switch to Computer in More → Settings if you’re at one." : "Nothing to work on. Add tasks, or import a calendar file."}
      </p>
    );
  }
  const t = n.pt.task;
  const snooze = (until: Date) => updateTask(t.id, { snoozedUntil: until.toISOString() });
  return (
    <div className="next">
      <p className="muted small">{n.pt.course}</p>
      <p className="big task-title">{t.title}</p>
      <p>
        <strong>{mins(n.minutes)}</strong> block · {mins(n.pt.remaining)} left in total
        {n.pt.effectiveDue && <> · due {fmtWhen(n.pt.effectiveDue)} ({rel(n.pt.effectiveDue, now)})</>}
      </p>
      {n.pt.latestStart != null && (
        <p className="small">
          Latest sensible start: <strong>{n.pt.latestStart <= now.getTime() ? "now" : fmtWhen(n.pt.latestStart)}</strong>
        </p>
      )}
      <p className="small">{n.reasons[2]}</p>
      {n.conflict && (
        <p className="banner warn small" role="alert">
          <span aria-hidden="true">! </span>
          {n.conflict}
        </p>
      )}
      <div className="row actions">
        <button className="btn primary" disabled={busy} onClick={() => startSession(t.id, n.minutes)}>
          Start {mins(n.minutes)}
        </button>
        <button className="btn" onClick={() => setSwapOpen(!swapOpen)} aria-expanded={swapOpen}>
          Swap
        </button>
        <button className="btn" onClick={() => snooze(new Date(now.getTime() + 60 * 60000))}>
          Snooze 1 h
        </button>
        <button className="btn" onClick={() => snooze(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 8, 0))}>
          Tomorrow
        </button>
      </div>
      {swapOpen && (
        <div className="swap">
          <p className="small muted">Pick something else for now. “{t.title}” is snoozed for an hour.</p>
          {plan.alternatives.length === 0 && <p className="muted small">No other task can start now.</p>}
          {plan.alternatives.map((a, idx) => (
            <button
              key={a.task.id}
              className="btn option"
              onClick={() => {
                // Snooze everything ranked above the choice so the choice becomes the next action.
                const until = new Date(now.getTime() + 60 * 60000).toISOString();
                for (const ahead of [n.pt, ...plan.alternatives.slice(0, idx)]) updateTask(ahead.task.id, { snoozedUntil: until });
                setSwapOpen(false);
              }}
            >
              <span className="task-title">{a.task.title}</span>
              <span className="muted small">
                {a.course} · {mins(a.remaining)} left{a.effectiveDue ? ` · due ${fmtWhen(a.effectiveDue)}` : ""}
              </span>
            </button>
          ))}
        </div>
      )}
      <Details summary="Why this now?">
        <ul>
          {n.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        {plan.strictEdfUsed && <p className="small muted">Deadlines are tight, so importance and grade weight were ignored to fit as much as possible.</p>}
      </Details>
      <Details summary="What would change this?">
        <ul>
          {n.changes.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </Details>
    </div>
  );
}

function NextFixed({ plan, now }: { plan: Plan; now: Date }) {
  const next = plan.busy.find((b) => b.kind !== "sleep" && b.kind !== "session" && b.kind !== "whatif" && b.end > now.getTime());
  if (!next) return <p className="muted">No classes or commitments in the next two weeks.</p>;
  const realStart = next.realStart ?? next.start;
  const realEnd = next.realEnd ?? next.end;
  const inProgress = realStart <= now.getTime();
  return (
    <>
      <p className="big">{next.label}</p>
      <p>
        {inProgress ? (
          <>
            <span className="pill live">Now</span> until {fmtTime(realEnd)}
          </>
        ) : (
          <>
            {fmtWhen(realStart)} · <strong>{rel(realStart, now)}</strong>
          </>
        )}
      </p>
    </>
  );
}

function RestOfToday({ plan, data, now }: { plan: Plan; data: Data; now: Date }) {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  const items = [
    ...plan.blocks.filter((b) => b.start < end).map((b) => ({ start: b.start, end: b.end, label: data.tasks.find((t) => t.id === b.taskId)?.title ?? "Study", kind: "study" as const })),
    ...plan.busy.filter((b) => b.start < end && b.end > now.getTime() && (b.kind === "class" || b.kind === "commitment")).map((b) => ({ start: b.start, end: b.end, label: b.label, kind: "fixed" as const })),
  ].sort((a, b) => a.start - b.start);
  if (!items.length) return <p className="muted">Nothing else planned today.</p>;
  return (
    <ol className="timeline">
      {items.map((i) => (
        <li key={`${i.kind}-${i.start}-${i.label}`} className={i.kind}>
          <span className="time">
            {fmtTime(i.start)}–{fmtTime(i.end)}
          </span>
          <span>
            <span className="tag">{i.kind === "study" ? "Study" : "Fixed"}</span> {i.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function RunningBlock({ data, now }: { data: Data; now: Date }) {
  const s = activeSession(data)!;
  const t = data.tasks.find((x) => x.id === s.taskId);
  const active = Math.floor(activeMs(s, now.getTime()) / 1000);
  const elapsed = Math.floor((now.getTime() - Date.parse(s.startedAt)) / 1000);
  const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  return (
    <section className="card running" aria-labelledby="running-title">
      <h2 id="running-title">{s.status === "paused" ? "Paused" : "Studying"}</h2>
      <p className="big task-title">{t?.title ?? "Task"}</p>
      <p className="timer" aria-live="off">
        <span className="big-num">{mmss(active)}</span> active of {s.plannedMinutes} min planned · {mmss(elapsed)} elapsed
      </p>
      <div className="row actions">
        {s.status === "running" ? (
          <button className="btn" onClick={() => pauseSession(s.id)}>Pause</button>
        ) : (
          <button className="btn primary" onClick={() => resumeSession(s.id)}>Resume</button>
        )}
        <button className="btn primary" onClick={() => finishSession(s.id, true)}>Task done</button>
        <button className="btn" onClick={() => finishSession(s.id, false)}>Stop (partial)</button>
        <button className="btn danger" onClick={() => cancelSession(s.id)}>Cancel</button>
      </div>
    </section>
  );
}

const OUTCOMES: { value: Outcome; label: string }[] = [
  { value: "early", label: "Finished early" },
  { value: "on_time", label: "On time" },
  { value: "longer", label: "Needed longer" },
  { value: "other", label: "Did something else" },
];

function CheckinCard({ data, sessionId }: { data: Data; sessionId: string }) {
  const s = data.sessions.find((x) => x.id === sessionId)!;
  const t = data.tasks.find((x) => x.id === s.taskId);
  const [more, setMore] = useState(false);
  const [actual, setActual] = useState(String(s.activeMinutes ?? ""));
  const [focus, setFocus] = useState("");
  const [conf, setConf] = useState("");
  const [blocker, setBlocker] = useState("");
  const save = (outcome: Outcome) =>
    answerCheckin(s.id, { outcome, actualMinutes: numOrNull(actual), focus: numOrNull(focus), confidence: numOrNull(conf), blocker: blocker.trim().slice(0, 200) });
  return (
    <section className="card checkin" aria-labelledby={`ci-${s.id}`}>
      <h2 id={`ci-${s.id}`}>How did this block go?</h2>
      <p className="small muted">
        {t?.title ?? "Task"} · {s.activeMinutes} min active{s.partial ? " · partial" : " · task done"}
      </p>
      <div className="row actions">
        {OUTCOMES.map((o) => (
          <button key={o.value} className="btn" onClick={() => save(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
      <button className="link" onClick={() => setMore(!more)} aria-expanded={more}>
        {more ? "Fewer details" : "Add details (optional)"}
      </button>
      {more && (
        <div className="form">
          <div className="two">
            <label>
              Actual minutes
              <input type="number" inputMode="numeric" min={0} value={actual} onChange={(e) => setActual(e.target.value)} />
            </label>
            <label>
              Focus (1–5)
              <input type="number" inputMode="numeric" min={1} max={5} value={focus} onChange={(e) => setFocus(e.target.value)} />
            </label>
          </div>
          <div className="two">
            <label>
              Confidence recalling it (1–5)
              <input type="number" inputMode="numeric" min={1} max={5} value={conf} onChange={(e) => setConf(e.target.value)} />
            </label>
            <label>
              Blocker
              <input value={blocker} onChange={(e) => setBlocker(e.target.value)} maxLength={200} />
            </label>
          </div>
        </div>
      )}
      <button className="link" onClick={() => skipCheckin(s.id)}>Not now</button>
      <p className="small muted">Skipping is fine: an unanswered check-in is just a missing observation, not a failure.</p>
    </section>
  );
}

function HabitsToday({ data, now, go }: { data: Data; now: Date; go: Go }) {
  const today = data.habits.filter((h) => isScheduled(h, now));
  const key = dayKey(now);
  return (
    <section className="card" aria-labelledby="habits-title">
      <h2 id="habits-title">Habits today</h2>
      {today.length === 0 && <p className="muted small">No habits scheduled today.</p>}
      <ul className="plain">
        {today.map((h) => {
          const v = h.log[key] ?? 0;
          return (
            <li key={h.id} className="row">
              <span>
                {doneOn(h, now) && <span aria-label="done">✓ </span>}
                {h.name}{" "}
                <span className="muted small">
                  {v}/{h.target} {h.unit}
                </span>
              </span>
              <button
                className="btn small-btn"
                aria-label={`Log one for ${h.name}`}
                onClick={() => update((d) => ({ ...d, habits: d.habits.map((x) => (x.id === h.id ? { ...x, log: { ...x.log, [key]: (x.log[key] ?? 0) + 1 } } : x)) }))}
              >
                +1
              </button>
            </li>
          );
        })}
      </ul>
      <button className="link" onClick={() => go("More")}>Manage habits</button>
    </section>
  );
}

function Briefing({ data, plan }: { data: Data; plan: Plan }) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<BriefingFields>(DEFAULT_FIELDS);
  const [copied, setCopied] = useState<null | boolean>(null);
  const text = buildBriefing(data, plan, fields);
  const toggle = (k: keyof BriefingFields) => setFields({ ...fields, [k]: !fields[k] });
  const LABELS: [keyof BriefingFields, string][] = [
    ["availableMinutes", "Available minutes"],
    ["nextBlocks", "Next two study blocks"],
    ["decision", "Pending decision"],
    ["unknowns", "Unknowns"],
    ["question", "A question for the assistant"],
    ["realCourseLabels", "Show real course codes (off = Course A/B)"],
  ];
  return (
    <>
      <button className="btn" onClick={() => setOpen(!open)} aria-expanded={open}>
        Copy study briefing…
      </button>
      {open && (
        <div className="briefing">
          <p className="small muted">
            For pasting into any assistant. Only the fields you tick are included; it never contains notes, email text, grades, habits or screen time.
          </p>
          {LABELS.map(([k, l]) => (
            <label key={k} className="check">
              <input type="checkbox" checked={fields[k]} onChange={() => toggle(k)} />
              <span>{l}</span>
            </label>
          ))}
          <label>
            Preview
            <textarea readOnly value={text} rows={7} onFocus={(e) => e.currentTarget.select()} />
          </label>
          <button className="btn primary" onClick={async () => setCopied(await copyText(text))}>
            Copy
          </button>
          {copied === true && <p className="small" role="status">Copied.</p>}
          {copied === false && (
            <p className="small" role="status">
              Couldn’t copy automatically. Select the preview text above and copy it.
            </p>
          )}
        </div>
      )}
    </>
  );
}

function SyncStatus({ data, go }: { data: Data; go: Go }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string[] | null>(null);
  if (data.accounts.length === 0) {
    return (
      <p className="sync">
        <span className="sync-icon" aria-hidden="true">◇</span>
        Stored on this device only. No accounts connected.
      </p>
    );
  }
  const signedIn = data.accounts.filter((a) => getToken(a.id));
  const times = data.accounts.flatMap((a) => [...a.calendars.map((c) => c.lastSync), a.gmailLastSync]).filter((x): x is string => !!x);
  const last = times.sort().pop();
  const errors = data.accounts.filter((a) => a.lastError || a.gmailError || a.calendars.some((c) => c.error)).length;
  const stale = !last || Date.now() - Date.parse(last) > 6 * 3600_000;
  return (
    <>
      <p className={`sync ${errors ? "sync-error" : stale ? "sync-stale" : "sync-ok"}`}>
        <span className="sync-icon" aria-hidden="true">{errors ? "✕" : stale ? "!" : "✓"}</span>
        {last ? `Google synced ${rel(last, new Date())}` : "Google not synced yet"}
        {errors ? ` · ${errors} account(s) need attention` : ""}
      </p>
      <p className="small muted">
        {signedIn.length}/{data.accounts.length} account(s) signed in. Syncing only happens while the app is open.
      </p>
      <div className="row actions">
        {signedIn.length > 0 && (
          <button
            className="btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setResult(await syncAll());
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Syncing…" : "Sync now"}
          </button>
        )}
        {signedIn.length < data.accounts.length && (
          <button className="btn" onClick={() => go("More")}>
            Sign in
          </button>
        )}
      </div>
      {result && (
        <ul className="small" role="status">
          {result.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </>
  );
}
