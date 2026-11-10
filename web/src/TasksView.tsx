import { useState, type FormEvent } from "react";
import { courseCode, newId, update, useData } from "./store";
import { openTasksSorted } from "./today";
import { formatDay, formatTime, minutes, relative } from "./format";
import { useNow } from "./TodayView";

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function TasksView() {
  const data = useData();
  const now = useNow(30_000);
  const [title, setTitle] = useState("");
  const [courseId, setCourseId] = useState("");
  const [due, setDue] = useState("");
  const [est, setEst] = useState("");
  const [showDone, setShowDone] = useState(false);

  function add(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    update((d) => ({
      ...d,
      tasks: [
        ...d.tasks,
        {
          id: newId(),
          title: title.trim(),
          courseId: courseId || null,
          due: due ? new Date(due).toISOString() : null,
          allDay: false,
          estMinutes: est ? Math.max(1, Math.round(Number(est))) : null,
          done: false,
          source: "manual",
        },
      ],
    }));
    setTitle("");
    setDue("");
    setEst("");
  }

  const setDone = (id: string, done: boolean) => update((d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === id ? { ...t, done } : t)) }));
  const remove = (id: string) => update((d) => ({ ...d, tasks: d.tasks.filter((t) => t.id !== id) }));

  const open = openTasksSorted(data);
  const done = data.tasks.filter((t) => t.done);

  return (
    <main className="page" aria-labelledby="tasks-title">
      <h1 id="tasks-title">Tasks</h1>

      <form className="card form" onSubmit={add} aria-label="Add a task">
        <label>
          What’s due
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Problem set 7" required maxLength={300} />
        </label>
        <div className="two">
          <label>
            Course
            <select value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              <option value="">No course</option>
              {data.courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}
                </option>
              ))}
            </select>
          </label>
          <label>
            Minutes (estimate)
            <input type="number" inputMode="numeric" min={1} max={2000} value={est} onChange={(e) => setEst(e.target.value)} placeholder="60" />
          </label>
        </div>
        <label>
          Due
          <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <button className="btn primary" type="submit">Add task</button>
      </form>

      <h2 className="section">Open ({open.length})</h2>
      {open.length === 0 && <p className="muted">Nothing open.</p>}
      <ul className="list">
        {open.map((t) => (
          <li key={t.id} className="card task-row">
            <input type="checkbox" checked={false} onChange={() => setDone(t.id, true)} aria-label={`Mark “${t.title}” done`} />
            <div className="grow">
              <p className="task-title">{t.title}</p>
              <p className="muted small">
                {courseCode(data, t.courseId) ?? "No course"} · {minutes(t.estMinutes)} ·{" "}
                {t.due ? (
                  <span className={new Date(t.due) < now ? "overdue" : undefined}>
                    {new Date(t.due) < now && <span aria-hidden="true">! </span>}
                    due {formatDay(t.due, tz)} {t.allDay ? "" : formatTime(t.due, tz)} ({relative(t.due, now)})
                  </span>
                ) : (
                  "due date unknown"
                )}
              </p>
            </div>
            <button className="icon-btn" onClick={() => remove(t.id)} aria-label={`Delete “${t.title}”`}>
              ✕
            </button>
          </li>
        ))}
      </ul>

      {done.length > 0 && (
        <>
          <button className="link" onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>
            {showDone ? "Hide" : "Show"} done ({done.length})
          </button>
          {showDone && (
            <ul className="list">
              {done.map((t) => (
                <li key={t.id} className="card task-row done">
                  <input type="checkbox" checked onChange={() => setDone(t.id, false)} aria-label={`Mark “${t.title}” not done`} />
                  <p className="grow task-title">{t.title}</p>
                  <button className="icon-btn" onClick={() => remove(t.id)} aria-label={`Delete “${t.title}”`}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
