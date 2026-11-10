import { useMemo, useState } from "react";
import { dayKey, useData } from "./store";
import { buildPlan, lessTimeToday, planToIcs, prioritize, type Delta } from "./plan";
import { courseGrade, coursePressure } from "./grades";
import { download, fmtTime, fmtWhen, mins, useNow } from "./ui";

export function PlanView() {
  const data = useData();
  const now = useNow(60_000);
  const energy = data.days[dayKey(now)]?.energy ?? "normal";
  const plan = useMemo(() => buildPlan(data, now, { energy }), [data, now, energy]);
  const [whatIf, setWhatIf] = useState<{ title: string; delta: Delta[] } | null>(null);
  const maxFree = Math.max(60, ...plan.capacity.map((c) => c.free));

  const pressure = data.courses
    .map((c) => ({ c, g: courseGrade(c, data.gradeItems) }))
    .map(({ c, g }) => ({ code: c.code, ...coursePressure(c, g) }))
    .sort((a, b) => b.score - a.score);

  return (
    <main className="page" aria-labelledby="plan-title">
      <div className="row">
        <h1 id="plan-title">Plan</h1>
        <button className="btn" onClick={() => download("study-plan.ics", planToIcs(data, plan), "text/calendar")}>
          Export plan to calendar (.ics)
        </button>
      </div>
      <p className="muted small">
        Built from your free time (outside sleep {data.settings.sleepStart}–{data.settings.sleepEnd}, classes and commitments, with a {data.settings.bufferMinutes}-minute buffer), deadlines and estimates.{" "}
        {plan.pace.note}
      </p>

      {plan.atRisk.length > 0 && (
        <section className="card warn-card" aria-labelledby="risk-title">
          <h2 id="risk-title">Doesn’t fit</h2>
          <ul className="plain">
            {plan.atRisk.map((t) => {
              const competing = plan.tasks.filter((o) => o !== t && o.effectiveDue != null && t.effectiveDue != null && o.effectiveDue <= t.effectiveDue && o.scheduled > 0);
              return (
                <li key={t.task.id} className="risk">
                  <p>
                    <strong>{t.task.title}</strong> ({t.course}): <strong>{mins(t.missing)} short</strong> before {fmtWhen(t.effectiveDue!)}.
                  </p>
                  {competing.length > 0 && <p className="small muted">Competes with: {competing.map((c) => c.task.title).join(", ")}.</p>}
                  <button
                    className="btn"
                    onClick={() => setWhatIf({ title: `If you prioritize “${t.task.title}”`, delta: prioritize(data, now, t.task.id).delta })}
                  >
                    What if I prioritize this?
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="small muted">Options: lower an estimate, ask for an extension, free up time (Courses → commitments), or prioritize one and accept the tradeoff.</p>
        </section>
      )}

      <div className="row actions">
        <button className="btn" onClick={() => setWhatIf({ title: "If you have 30 fewer minutes today", delta: lessTimeToday(data, now, 30).delta })}>
          If I have 30 fewer minutes today
        </button>
      </div>
      {whatIf && (
        <section className="card" aria-labelledby="whatif-title" role="status">
          <h2 id="whatif-title">{whatIf.title}</h2>
          {whatIf.delta.length === 0 ? (
            <p>Nothing changes: every deadline still fits.</p>
          ) : (
            <ul>
              {whatIf.delta.map((d) => (
                <li key={d.title}>
                  {d.title}: {d.before ? `${mins(d.before)} short` : "fits"} → {d.after ? <strong>{mins(d.after)} short</strong> : "fits"}
                </li>
              ))}
            </ul>
          )}
          <p className="small muted">Preview only. Nothing was changed.</p>
          <button className="link" onClick={() => setWhatIf(null)}>Close</button>
        </section>
      )}

      <section className="card" aria-labelledby="cap-title">
        <h2 id="cap-title">Next 7 days</h2>
        <table className="cap">
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Free</th>
              <th scope="col">Planned</th>
              <th scope="col" className="bar-col">
                <span className="sr-only">Chart</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {plan.capacity.map((c) => (
              <tr key={c.date}>
                <th scope="row">{c.day}</th>
                <td>{mins(c.free)}</td>
                <td>{mins(c.planned)}</td>
                <td className="bar-col" aria-hidden="true">
                  <div className="bar">
                    <div className="bar-free" style={{ width: `${(c.free / maxFree) * 100}%` }} />
                    <div className="bar-plan" style={{ width: `${(c.planned / maxFree) * 100}%` }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card" aria-labelledby="deadlines-title">
        <h2 id="deadlines-title">Upcoming deadlines</h2>
        {plan.tasks.filter((t) => t.effectiveDue).length === 0 && <p className="muted">No dated tasks.</p>}
        <table className="list-table">
          <thead>
            <tr>
              <th scope="col">Task</th>
              <th scope="col">Due</th>
              <th scope="col">Left</th>
              <th scope="col">Spare</th>
            </tr>
          </thead>
          <tbody>
            {plan.tasks
              .filter((t) => t.effectiveDue)
              .sort((a, b) => a.effectiveDue! - b.effectiveDue!)
              .slice(0, 15)
              .map((t) => (
                <tr key={t.task.id}>
                  <td>
                    {t.task.title}
                    <span className="muted small"> · {t.course}</span>
                    {t.waitingOn && <span className="small muted"> · {t.waitingOn}</span>}
                  </td>
                  <td>{fmtWhen(t.effectiveDue!)}</td>
                  <td>{mins(t.remaining)}</td>
                  <td className={t.missing > 0 ? "overdue" : undefined}>{t.missing > 0 ? `−${mins(t.missing)}` : mins(t.slack)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </section>

      <section className="card" aria-labelledby="blocks-title">
        <h2 id="blocks-title">Planned study blocks</h2>
        {plan.blocks.length === 0 && <p className="muted">No blocks planned.</p>}
        <ol className="timeline">
          {plan.blocks.slice(0, 30).map((b) => (
            <li key={`${b.taskId}-${b.start}`} className="study">
              <span className="time">
                {fmtWhen(b.start)}–{fmtTime(b.end)}
              </span>
              <span>{data.tasks.find((t) => t.id === b.taskId)?.title}</span>
            </li>
          ))}
        </ol>
      </section>

      {pressure.length > 0 && (
        <section className="card" aria-labelledby="pressure-title">
          <h2 id="pressure-title">Which course needs attention</h2>
          <p className="small muted">Based on how much of each grade is still open and what you need to reach your target (set targets and weights under Courses).</p>
          <ol>
            {pressure.map((p) => (
              <li key={p.code}>
                <strong>{p.code}</strong>: {p.reason}
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
