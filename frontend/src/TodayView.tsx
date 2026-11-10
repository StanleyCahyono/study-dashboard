import { useCallback, useEffect, useState } from "react";
import { api, ApiError, NetworkError, type Today } from "./api";
import { formatClock, formatDateLong, formatDay, formatTime, minutes, relative, sameDay } from "./format";

const REFRESH_MS = 60_000;

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

const SYNC_ICON: Record<string, string> = { ok: "✓", demo: "◇", no_sources: "○", stale: "!", error: "✕" };

export function TodayView({ onAuthLost }: { onAuthLost: () => void }) {
  const [data, setData] = useState<Today | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const now = useNow();

  const load = useCallback(async () => {
    try {
      const d = await api.today();
      setData(d);
      setFetchedAt(new Date());
      setProblem(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onAuthLost();
      else if (e instanceof NetworkError) setProblem("Can’t reach your study computer. Showing nothing new until it’s back.");
      else if (e instanceof ApiError) setProblem(`The server returned an error (${e.status}).`);
      else throw e;
    }
  }, [onAuthLost]);

  useEffect(() => {
    load();
    const id = window.setInterval(load, REFRESH_MS);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const tz = data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

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

      {problem && (
        <p className="banner warn" role="status">
          <span aria-hidden="true">! </span>
          {problem}
        </p>
      )}

      {!data ? (
        <p className="muted" aria-busy="true">Loading your day…</p>
      ) : (
        <div className="grid">
          <section className="card" aria-labelledby="next-class-title">
            <h2 id="next-class-title">Next class</h2>
            {data.next_class ? (
              <>
                <p className="big">
                  {data.next_class.course_code} <span className="kind">{data.next_class.kind}</span>
                </p>
                <p>{data.next_class.course_title}</p>
                <p className="when">
                  {data.next_class.in_progress ? (
                    <>
                      <span className="pill live">In progress</span> until {formatTime(data.next_class.ends_at, tz)}
                    </>
                  ) : (
                    <>
                      {sameDay(data.next_class.starts_at, now, tz) ? "Today" : formatDay(data.next_class.starts_at, tz)}{" "}
                      {formatTime(data.next_class.starts_at, tz)}–{formatTime(data.next_class.ends_at, tz)} ·{" "}
                      <strong>{relative(data.next_class.starts_at, now)}</strong>
                    </>
                  )}
                </p>
                {data.next_class.location && <p className="muted">{data.next_class.location}</p>}
              </>
            ) : (
              <p className="muted">No classes found in the next two weeks. Class times appear here once a calendar or timetable is added.</p>
            )}
          </section>

          <section className="card" aria-labelledby="next-task-title">
            <h2 id="next-task-title">Next task</h2>
            {data.next_task ? (
              <>
                <p className="big task-title">{data.next_task.title}</p>
                <p>
                  {data.next_task.course_code ?? "No course"} · {minutes(data.next_task.estimated_minutes)}
                </p>
                <p className="when">
                  {data.next_task.due_at ? (
                    <>
                      Due {formatDay(data.next_task.due_at, tz)} {formatTime(data.next_task.due_at, tz)} ·{" "}
                      <strong>{relative(data.next_task.due_at, now)}</strong>
                    </>
                  ) : (
                    <span className="pill">Due date unknown</span>
                  )}
                </p>
              </>
            ) : (
              <p className="muted">No open tasks. That doesn’t mean there’s no coursework: no sources are connected yet.</p>
            )}
            {data.overdue_count > 0 && (
              <p className="banner warn small">
                <span aria-hidden="true">! </span>
                {data.overdue_count} overdue {data.overdue_count === 1 ? "task" : "tasks"}
              </p>
            )}
          </section>

          <section className="card" aria-labelledby="sync-title">
            <h2 id="sync-title">Sync status</h2>
            <p className={`sync sync-${data.sync.state}`}>
              <span className="sync-icon" aria-hidden="true">
                {SYNC_ICON[data.sync.state] ?? "?"}
              </span>
              {data.sync.label}
            </p>
            <p className="muted small">
              {data.sync.sources_connected} source{data.sync.sources_connected === 1 ? "" : "s"} connected
              {fetchedAt && <> · page refreshed {formatTime(fetchedAt.toISOString(), tz)}</>}
            </p>
            <button className="btn" onClick={load}>
              Refresh
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
