import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { dayKey, emptyData, getData, migrate, newId, newTask, replaceAll, update, useData, WEEKDAYS, type Data, type Habit, type InboxItem, type Settings } from "./store";
import { findOrCreateCourse, guessKind, importIcs } from "./ics";
import { extractCandidates, looksLikeSame, parseEml } from "./email";
import { computePace } from "./pace";
import { streak, weeklyRates } from "./habits";
import { demoData } from "./demo";
import { mergeGradebook, parseGradebook } from "./gradebook";
import { Details, download, fmtWhen, fromLocalInput, numOrNull, toLocalInput } from "./ui";

export function MoreView() {
  const data = useData();
  const [msg, setMsg] = useState<string | null>(null);
  const icsRef = useRef<HTMLInputElement>(null);
  const backupRef = useRef<HTMLInputElement>(null);
  const gradebookRef = useRef<HTMLInputElement>(null);

  async function onGradebook(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const r = mergeGradebook(getData(), parseGradebook(JSON.parse(await file.text())));
      replaceAll(r.data);
      setMsg(`Gradebook added: ${r.added.length} new course(s)${r.added.length ? ` (${r.added.join(", ")})` : ""}, ${r.updated.length} updated, ${r.items} graded items. Tasks, notes and other courses were not changed.`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "That file couldn’t be read.");
    }
  }

  async function onIcs(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const r = importIcs(getData(), await file.text());
      replaceAll({ ...r.data, demo: false });
      setMsg(
        `Imported ${file.name}: ${r.addedTasks} new tasks, ${r.updatedTasks} updated, ${r.addedMeetings} class times, ${r.addedCommitments} commitments, ${r.addedCourses} new courses${r.skipped ? `, ${r.skipped} skipped` : ""}.`,
      );
    } catch {
      setMsg("That calendar file couldn’t be read.");
    }
  }

  function exportBackup() {
    download(`study-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(getData(), null, 2), "application/json");
    setMsg("Backup downloaded. Keep it somewhere private: it contains your courses, tasks, grades and notes.");
  }

  async function onBackup(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const restored = migrate(JSON.parse(await file.text()));
      if (!window.confirm("Replace everything on this device with this backup?")) return;
      replaceAll(restored);
      setMsg("Backup restored.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "That backup couldn’t be read.");
    }
  }

  function loadDemo() {
    if ((data.courses.length || data.tasks.length) && !window.confirm("Replace your data on this device with demo data?")) return;
    replaceAll(demoData());
    setMsg("Demo data loaded.");
  }

  function clearAll() {
    if (!window.confirm("Delete all courses, tasks, grades, notes and habits from this device? This can’t be undone.")) return;
    replaceAll({ ...emptyData(), settings: getData().settings });
    setMsg("Everything on this device was deleted.");
  }

  return (
    <main className="page" aria-labelledby="more-title">
      <h1 id="more-title">More</h1>
      {msg && (
        <p className="banner" role="status">
          {msg}
        </p>
      )}

      <EmailInbox data={data} />

      <section className="card" aria-labelledby="import-title">
        <h2 id="import-title">Import a calendar file (.ics)</h2>
        <p>
          For example your Canvas calendar: in Canvas open <strong>Calendar → Calendar Feed</strong>, download the file, then choose it here. Weekly events become
          class times, timed one-off events (like an exam sitting) become fixed commitments, and other events become tasks. Importing the same file again updates
          instead of duplicating.
        </p>
        <input ref={icsRef} type="file" accept=".ics,text/calendar" hidden onChange={onIcs} aria-label="Calendar file" />
        <button className="btn primary" onClick={() => icsRef.current?.click()}>Choose .ics file</button>
      </section>

      <section className="card" aria-labelledby="gradebook-title">
        <h2 id="gradebook-title">Add grades from a file</h2>
        <p className="small">Adds or updates courses from a gradebook file (credits, cutoffs, groups, schemes, scores). Your tasks, notes and other courses stay as they are.</p>
        <input ref={gradebookRef} type="file" accept="application/json,.json" hidden onChange={onGradebook} aria-label="Gradebook file" />
        <button className="btn" onClick={() => gradebookRef.current?.click()}>Choose gradebook file</button>
      </section>

      <SettingsCard data={data} />
      <PaceCard data={data} />
      <HabitsCard data={data} />
      <WellnessCard data={data} />
      <ConnectionsCard />

      <section className="card" aria-labelledby="backup-title">
        <h2 id="backup-title">Backup</h2>
        <p>Your data is only on this device. If you delete the app or clear Safari data, it’s gone. Export a backup now and then (e.g. to Files or iCloud Drive).</p>
        <div className="row actions">
          <button className="btn" onClick={exportBackup}>Export backup</button>
          <input ref={backupRef} type="file" accept="application/json,.json" hidden onChange={onBackup} aria-label="Backup file" />
          <button className="btn" onClick={() => backupRef.current?.click()}>Restore backup</button>
        </div>
        <p className="small muted">To move data between phone and computer: export on one, restore on the other.</p>
      </section>

      <section className="card" aria-labelledby="privacy-title">
        <h2 id="privacy-title">Privacy</h2>
        <p>
          This website is public, but your data is not: it’s saved in this browser on this device and never sent anywhere. The page blocks all network requests
          except loading its own files. Other people who open the site see their own empty app.
        </p>
        <Details summary="Where data can go">
          <ul className="small">
            <li>GitHub Pages: serves the app’s files. It receives normal web-server metadata (your IP address, browser), not your data.</li>
            <li>Backups and calendar exports: only where you save them.</li>
            <li>Copy study briefing / teammate message: only where you paste them.</li>
            <li>No analytics, no AI services, no accounts.</li>
          </ul>
        </Details>
      </section>

      <section className="card" aria-labelledby="demo-title">
        <h2 id="demo-title">Demo and reset</h2>
        <div className="row actions">
          <button className="btn" onClick={loadDemo}>Load demo data</button>
          <button className="btn danger" onClick={clearAll}>Delete all data</button>
        </div>
      </section>
    </main>
  );
}

function EmailInbox({ data }: { data: Data }) {
  const [text, setText] = useState("");
  const [subject, setSubject] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const emlRef = useRef<HTMLInputElement>(null);
  const pending = data.inbox.filter((i) => i.status === "pending");

  function addCandidates(input: { subject: string; from: string; body: string }) {
    const cands = extractCandidates(input, new Date());
    if (!cands.length) {
      setNote("No deadline with a date was found. Add it under Tasks instead.");
      return;
    }
    update((d) => {
      const courses = [...d.courses];
      const items: InboxItem[] = cands.map((c) => {
        const courseId = c.courseCode ? findOrCreateCourse(courses, c.courseCode) : null;
        const due = c.due?.toISOString() ?? null;
        const dup = [...d.tasks, ...d.inbox.filter((i) => i.status !== "dismissed")].find((t) => looksLikeSame({ title: c.title, due, courseId }, { title: t.title, due: t.due, courseId: t.courseId }));
        return {
          id: newId(),
          createdAt: new Date().toISOString(),
          title: c.title,
          due,
          allDay: c.allDay,
          courseId,
          quote: c.quote,
          sender: c.sender,
          status: dup ? "duplicate" : "pending",
          taskId: dup && "done" in dup ? dup.id : null,
        };
      });
      // A duplicate adds its quote as extra evidence on the existing task.
      const tasks = d.tasks.map((t) => {
        const extra = items.filter((i) => i.status === "duplicate" && i.taskId === t.id).map((i) => `Email: “${i.quote.slice(0, 160)}”`);
        return extra.length ? { ...t, evidence: [...t.evidence, ...extra] } : t;
      });
      return { ...d, courses, tasks, inbox: [...d.inbox, ...items] };
    });
    setNote(`Found ${cands.length} possible deadline(s). Review them below; nothing is added until you accept.`);
    setText("");
    setSubject("");
  }

  async function onEml(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    addCandidates(parseEml(await file.text()));
  }

  function accept(i: InboxItem) {
    const t = newTask({ title: i.title, courseId: i.courseId, due: i.due, allDay: i.allDay, source: "email", kind: guessKind(i.title), evidence: [`Email${i.sender ? ` from ${i.sender}` : ""}: “${i.quote.slice(0, 200)}”`] });
    update((d) => ({ ...d, tasks: [...d.tasks, t], inbox: d.inbox.map((x) => (x.id === i.id ? { ...x, status: "accepted", taskId: t.id } : x)) }));
  }
  const setItem = (id: string, patch: Partial<InboxItem>) => update((d) => ({ ...d, inbox: d.inbox.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));

  return (
    <section className="card" aria-labelledby="inbox-title">
      <h2 id="inbox-title">Deadlines from email</h2>
      <p className="small">
        Paste an email from any of your inboxes (or open a saved .eml file). The app suggests deadlines for you to review. It never follows instructions written in
        an email, and the email itself isn’t kept, only a short quote.
      </p>
      <label>
        Subject (optional)
        <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} />
      </label>
      <label>
        Email text
        <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="row actions">
        <button className="btn primary" disabled={!text.trim()} onClick={() => addCandidates({ subject, from: "", body: text })}>
          Find deadlines
        </button>
        <input ref={emlRef} type="file" accept=".eml,message/rfc822" hidden onChange={onEml} aria-label="Email file" />
        <button className="btn" onClick={() => emlRef.current?.click()}>Open .eml file</button>
      </div>
      {note && (
        <p className="small" role="status">
          {note}
        </p>
      )}
      {pending.length > 0 && <h3>To review ({pending.length})</h3>}
      <ul className="plain">
        {pending.map((i) => (
          <li key={i.id} className="inbox-item">
            <label>
              Task
              <input value={i.title} onChange={(e) => setItem(i.id, { title: e.target.value })} />
            </label>
            <div className="two">
              <label>
                Due
                <input type="datetime-local" value={toLocalInput(i.due)} onChange={(e) => setItem(i.id, { due: fromLocalInput(e.target.value), allDay: false })} />
              </label>
              <label>
                Course
                <select value={i.courseId ?? ""} onChange={(e) => setItem(i.id, { courseId: e.target.value || null })}>
                  <option value="">No course</option>
                  {data.courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <blockquote className="small">“{i.quote}”</blockquote>
            {i.allDay && <p className="small muted">No time given; 11:59 PM assumed.</p>}
            <div className="row actions">
              <button className="btn primary" onClick={() => accept(i)}>Add as task</button>
              <button className="btn" onClick={() => setItem(i.id, { status: "dismissed" })}>Dismiss</button>
            </div>
          </li>
        ))}
      </ul>
      {data.inbox.some((i) => i.status === "duplicate") && (
        <p className="small muted">{data.inbox.filter((i) => i.status === "duplicate").length} reminder(s) matched an existing task and were attached to it as extra sources.</p>
      )}
    </section>
  );
}

function SettingsCard({ data }: { data: Data }) {
  const s = data.settings;
  const set = (patch: Partial<Settings>) => update((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  return (
    <section className="card" aria-labelledby="settings-title">
      <h2 id="settings-title">Planner settings</h2>
      <div className="form">
        <label>
          I’m using
          <select value={s.device} onChange={(e) => set({ device: e.target.value as Settings["device"] })}>
            <option value="phone">My phone (hide computer-only tasks from “next action”)</option>
            <option value="computer">A computer</option>
          </select>
        </label>
        <div className="two">
          <label>
            Sleep from
            <input type="time" value={s.sleepStart} onChange={(e) => set({ sleepStart: e.target.value || s.sleepStart })} />
          </label>
          <label>
            Wake at
            <input type="time" value={s.sleepEnd} onChange={(e) => set({ sleepEnd: e.target.value || s.sleepEnd })} />
          </label>
        </div>
        <div className="two">
          <label>
            Buffer around classes (min)
            <input type="number" inputMode="numeric" min={0} max={60} value={s.bufferMinutes} onChange={(e) => set({ bufferMinutes: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
          <label>
            Daily study cap (min, optional)
            <input type="number" inputMode="numeric" min={0} value={s.dailyCapMinutes ?? ""} onChange={(e) => set({ dailyCapMinutes: numOrNull(e.target.value) })} />
          </label>
        </div>
        <div className="two">
          <label>
            Shortest block (min)
            <input type="number" inputMode="numeric" min={5} max={120} value={s.minBlock} onChange={(e) => set({ minBlock: Math.max(5, Number(e.target.value) || 25) })} />
          </label>
          <label>
            Longest block (min)
            <input type="number" inputMode="numeric" min={15} max={240} value={s.maxBlock} onChange={(e) => set({ maxBlock: Math.max(15, Number(e.target.value) || 90) })} />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={s.preferLongBlocks} onChange={(e) => set({ preferLongBlocks: e.target.checked })} />
          <span>Prefer longer uninterrupted blocks (otherwise blocks are kept to 50 minutes)</span>
        </label>
      </div>
    </section>
  );
}

function PaceCard({ data }: { data: Data }) {
  const p = computePace(data);
  return (
    <section className="card" aria-labelledby="pace-title">
      <h2 id="pace-title">Your pace</h2>
      <p>{p.note}</p>
      {Object.entries(p.byKind).length > 0 && (
        <ul className="small">
          {Object.entries(p.byKind).map(([k, v]) => (
            <li key={k}>
              {k}: ×{v.factor} from {v.n} tasks
            </li>
          ))}
        </ul>
      )}
      <p className="small muted">Learned from tasks you finish that had an estimate and logged time (timer or check-in). Skipped check-ins don’t count against you.</p>
      <button className="btn" onClick={() => update((d) => ({ ...d, paceResetAt: new Date().toISOString() }))}>
        Reset pace learning
      </button>
      {data.paceResetAt && <p className="small muted">Last reset {fmtWhen(data.paceResetAt)}.</p>}
    </section>
  );
}

function HabitsCard({ data }: { data: Data }) {
  const [name, setName] = useState("");
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [target, setTarget] = useState("1");
  const [unit, setUnit] = useState("times");
  const now = new Date();

  function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !days.length) return;
    const h: Habit = { id: newId(), name: name.trim(), weekdays: days, target: Math.max(1, Number(target) || 1), unit: unit.trim() || "times", paused: false, log: {}, createdAt: new Date().toISOString() };
    update((d) => ({ ...d, habits: [...d.habits, h] }));
    setName("");
  }
  const setHabit = (id: string, patch: Partial<Habit>) => update((d) => ({ ...d, habits: d.habits.map((h) => (h.id === id ? { ...h, ...patch } : h)) }));

  return (
    <section className="card" aria-labelledby="habits-manage-title">
      <h2 id="habits-manage-title">Habits</h2>
      <ul className="plain">
        {data.habits.map((h) => {
          const rates = weeklyRates(h, now, 4);
          const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
          return (
            <li key={h.id} className="habit">
              <p>
                <strong>{h.name}</strong> · {h.target} {h.unit} on {h.weekdays.map((d) => WEEKDAYS[d].slice(0, 3)).join(", ")}
                {h.paused && " · paused"}
              </p>
              <p className="small">
                Streak: {streak(h, now)} (1 grace day) · Last 4 weeks:{" "}
                {rates.map((r, i) => (
                  <span key={i} className="rate">
                    {r == null ? "—" : `${Math.round(r * 100)}%`}
                  </span>
                ))}
              </p>
              <div className="row actions">
                <button className="btn small-btn" onClick={() => setHabit(h.id, { log: { ...h.log, [yesterday]: (h.log[yesterday] ?? 0) + 1 } })}>
                  +1 for yesterday
                </button>
                <button className="btn small-btn" onClick={() => setHabit(h.id, { log: { ...h.log, [dayKey(now)]: 0 } })}>
                  Reset today
                </button>
                <button className="btn small-btn" onClick={() => setHabit(h.id, { paused: !h.paused })}>
                  {h.paused ? "Resume" : "Pause"}
                </button>
                <button className="btn small-btn danger" onClick={() => window.confirm(`Delete habit “${h.name}”?`) && update((d) => ({ ...d, habits: d.habits.filter((x) => x.id !== h.id) }))}>
                  Delete
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <form className="form compact" onSubmit={add} aria-label="Add a habit">
        <label>
          New habit
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Start the first planned block" maxLength={120} />
        </label>
        <fieldset className="days">
          <legend>Days</legend>
          {WEEKDAYS.map((n, i) => (
            <label key={n} className="day">
              <input type="checkbox" checked={days.includes(i)} onChange={(e) => setDays(e.target.checked ? [...days, i] : days.filter((d) => d !== i))} />
              <span>{n.slice(0, 3)}</span>
            </label>
          ))}
        </fieldset>
        <div className="two">
          <label>
            Target per day
            <input type="number" inputMode="numeric" min={1} value={target} onChange={(e) => setTarget(e.target.value)} />
          </label>
          <label>
            Unit
            <input value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={30} />
          </label>
        </div>
        <button className="btn" type="submit">Add habit</button>
      </form>
    </section>
  );
}

function WellnessCard({ data }: { data: Data }) {
  const key = dayKey(new Date());
  const today = data.days[key] ?? {};
  const setDay = (patch: Partial<Data["days"][string]>) => update((d) => ({ ...d, days: { ...d.days, [key]: { ...d.days[key], ...patch } } }));
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    return { k: dayKey(d), label: d.toLocaleDateString(undefined, { weekday: "short" }) };
  }).reverse();
  return (
    <section className="card" aria-labelledby="wellness-title">
      <h2 id="wellness-title">Screen use check-in</h2>
      <p className="small">
        A website can’t read Screen Time. Enter it yourself if you like (Settings → Screen Time on your iPhone shows it). This never affects grades or the plan.
      </p>
      <div className="two">
        <label>
          Social apps during study today (min)
          <input type="number" inputMode="numeric" min={0} value={today.screenMinutes ?? ""} onChange={(e) => setDay({ screenMinutes: numOrNull(e.target.value) })} />
        </label>
        <label>
          Note (optional)
          <input value={today.screenNote ?? ""} onChange={(e) => setDay({ screenNote: e.target.value.slice(0, 120) })} />
        </label>
      </div>
      <p className="small">
        Last 7 days:{" "}
        {last7.map(({ k, label }) => (
          <span key={k} className="rate">
            {label} {data.days[k]?.screenMinutes ?? "—"}
          </span>
        ))}
      </p>
      <Details summary="Set a limit with iPhone’s built-in App Limits">
        <ol className="small">
          <li>Settings → Screen Time → App Limits → Add Limit.</li>
          <li>Pick Social (or specific apps), then Next.</li>
          <li>Set e.g. 20 minutes, choose “Customize Days” for study days, then Add.</li>
        </ol>
        <p className="small muted">iPhone shows its own reminder when you reach the limit. This website can’t see or change it.</p>
      </Details>
    </section>
  );
}

function ConnectionsCard() {
  const rows: [string, string, string][] = [
    ["Canvas due dates", "Manual", "Download the Calendar Feed .ics and import it above."],
    ["Canvas grades", "Manual", "Enter scores or paste CSV under Courses → Grades."],
    ["Gmail / Cornell email", "Manual", "Paste an email or open a .eml file above."],
    ["Google / Outlook calendar", "Manual", "Export .ics and import; export your plan as .ics."],
    ["Push notifications", "Unavailable", "Needs a server. Reminders show inside the app while it’s open."],
    ["Apple Health / Fitbit", "Unavailable", "Needs a native app. Not used for planning or grades."],
    ["Strava", "Unavailable", "Use the Strava app. Its data is never imported here."],
    ["Screen Time", "Manual", "Self-reported check-in above; iPhone App Limits for nudges."],
  ];
  return (
    <section className="card" aria-labelledby="conn-title">
      <h2 id="conn-title">Connections</h2>
      <p className="small muted">This is a website with no server, so it can’t sign in to other services. Here’s what works and how.</p>
      <table className="list-table">
        <thead>
          <tr>
            <th scope="col">Source</th>
            <th scope="col">Status</th>
            <th scope="col">How</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([a, b, c]) => (
            <tr key={a}>
              <td>{a}</td>
              <td>
                <span className={`tag ${b === "Unavailable" ? "tag-off" : ""}`}>{b === "Unavailable" ? "✕ " : "✎ "}{b}</span>
              </td>
              <td className="small">{c}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
