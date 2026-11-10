import { useEffect, useState } from "react";
import { useData } from "./store";
import { nextClass, nextTask, taskCourse } from "./today";
import { formatClock, formatDateLong, formatDay, formatTime, minutes, relative, sameDay } from "./format";

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function TodayView({ go }: { go: (tab: "Tasks" | "Classes" | "More") => void }) {
  const data = useData();
  const now = useNow();
  const nc = nextClass(data, now);
  const { task, overdue } = nextTask(data, now);
  const empty = data.courses.length === 0 && data.tasks.length === 0;
  const openCount = data.tasks.filter((t) => !t.done).length;

  return (
    <main className="page" aria-labelledby="today-title">
      <header className="today-header">
        <div>
          <h1 id="today-title">Today</h1>
          <p className="muted">{formatDateLong(now, tz)}</p>
        </div>
        <p className="clock" aria-label={`Current time ${formatClock(now, tz)}`}>
          <time dateTime={now.toISOString()}>{formatClock(now, tz)}</time>
          <span className="tz">{tz.replace("_", " ")}</span>
        </p>
      </header>

      {empty && (
        <section className="card intro" aria-labelledby="start-title">
          <h2 id="start-title">Get started</h2>
          <p>Add your classes and what’s due. Everything stays on this device only.</p>
          <div className="row actions">
            <button className="btn primary" onClick={() => go("Classes")}>Add classes</button>
            <button className="btn" onClick={() => go("Tasks")}>Add a task</button>
            <button className="btn" onClick={() => go("More")}>Import calendar or try demo</button>
          </div>
        </section>
      )}

      <div className="grid">
        <section className="card" aria-labelledby="next-class-title">
          <h2 id="next-class-title">Next class</h2>
          {nc ? (
            <>
              <p className="big">
                {nc.code} <span className="kind">{nc.kind}</span>
              </p>
              {nc.title && <p>{nc.title}</p>}
              <p className="when">
                {nc.inProgress ? (
                  <>
                    <span className="pill live">In progress</span> until {formatTime(nc.end.toISOString(), tz)}
                  </>
                ) : (
                  <>
                    {sameDay(nc.start.toISOString(), now, tz) ? "Today" : formatDay(nc.start.toISOString(), tz)} {formatTime(nc.start.toISOString(), tz)}–
                    {formatTime(nc.end.toISOString(), tz)} · <strong>{relative(nc.start.toISOString(), now)}</strong>
                  </>
                )}
              </p>
              {nc.location && <p className="muted">{nc.location}</p>}
            </>
          ) : (
            <p className="muted">No classes in the next two weeks. Add your weekly schedule under Classes.</p>
          )}
        </section>

        <section className="card" aria-labelledby="next-task-title">
          <h2 id="next-task-title">Next task</h2>
          {task ? (
            <>
              <p className="big task-title">{task.title}</p>
              <p>
                {taskCourse(data, task)} · {minutes(task.estMinutes)}
              </p>
              <p className="when">
                {task.due ? (
                  <>
                    Due {formatDay(task.due, tz)} {task.allDay ? "(time not given)" : formatTime(task.due, tz)} · <strong>{relative(task.due, now)}</strong>
                  </>
                ) : (
                  <span className="pill">Due date unknown</span>
                )}
              </p>
            </>
          ) : (
            <p className="muted">Nothing open. Add tasks under Tasks, or import a calendar file under More.</p>
          )}
          {overdue > 0 && (
            <p className="banner warn small">
              <span aria-hidden="true">! </span>
              {overdue} overdue {overdue === 1 ? "task" : "tasks"}
            </p>
          )}
        </section>

        <section className="card" aria-labelledby="data-title">
          <h2 id="data-title">Your data</h2>
          <p className="sync">
            <span className="sync-icon" aria-hidden="true">◇</span>
            Stored on this device only. Nothing is synced.
          </p>
          <p className="muted small">
            {data.courses.length} {data.courses.length === 1 ? "course" : "courses"} · {openCount} open {openCount === 1 ? "task" : "tasks"}. Export a backup under More.
          </p>
        </section>
      </div>
    </main>
  );
}
