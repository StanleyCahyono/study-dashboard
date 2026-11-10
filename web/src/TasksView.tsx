import { useMemo, useState, type FormEvent } from "react";
import { courseCode, newTask, update, updateTask, useData, type Data, type Task, type TaskKind } from "./store";
import { buildPlan, type Plan } from "./plan";
import { guessKind } from "./ics";
import { copyText, Details, fmtWhen, fromLocalInput, mins, numOrNull, rel, toLocalInput, useNow } from "./ui";

const KINDS: TaskKind[] = ["reading", "problem set", "writing", "project", "exam prep", "other"];

export function TasksView() {
  const data = useData();
  const now = useNow(60_000);
  const plan = useMemo(() => buildPlan(data, now), [data, now]);
  const [title, setTitle] = useState("");
  const [courseId, setCourseId] = useState("");
  const [due, setDue] = useState("");
  const [est, setEst] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  function add(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const estMinutes = est ? Math.max(1, Math.round(Number(est))) : null;
    const t = newTask({ title: title.trim(), courseId: courseId || null, due: fromLocalInput(due), estMinutes, originalEstimate: estMinutes, kind: guessKind(title) });
    update((d) => ({ ...d, tasks: [...d.tasks, t] }));
    setTitle("");
    setDue("");
    setEst("");
  }

  const top = data.tasks.filter((t) => !t.parentId);
  const open = top
    .filter((t) => !t.done && (!filter || t.courseId === filter))
    .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.title.localeCompare(b.title));
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
            <input type="number" inputMode="numeric" min={1} max={5000} value={est} onChange={(e) => setEst(e.target.value)} placeholder="60" />
          </label>
        </div>
        <label>
          Due
          <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <button className="btn primary" type="submit">Add task</button>
      </form>

      <div className="row">
        <h2 className="section">Open ({open.length})</h2>
        {data.courses.length > 0 && (
          <label className="inline-label">
            <span className="sr-only">Filter by course</span>
            <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by course">
              <option value="">All courses</option>
              {data.courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {open.length === 0 && <p className="muted">Nothing open.</p>}
      <ul className="list">
        {open.map((t) => (
          <TaskRow key={t.id} t={t} data={data} plan={plan} now={now} editing={editing === t.id} onEdit={() => setEditing(editing === t.id ? null : t.id)} />
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
                  <input type="checkbox" checked onChange={() => updateTask(t.id, { done: false, doneAt: null })} aria-label={`Mark “${t.title}” not done`} />
                  <p className="grow task-title">{t.title}</p>
                  <span className="muted small">{t.spentMinutes ? `${mins(t.spentMinutes)} logged` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}

function TaskRow({ t, data, plan, now, editing, onEdit }: { t: Task; data: Data; plan: Plan; now: Date; editing: boolean; onEdit: () => void }) {
  const pt = plan.tasks.find((x) => x.task.id === t.id);
  const children = data.tasks.filter((c) => c.parentId === t.id);
  const overdue = t.due && new Date(t.due) < now;
  return (
    <li className="card">
      <div className="task-row flat">
        <input type="checkbox" checked={false} onChange={() => updateTask(t.id, { done: true, doneAt: new Date().toISOString() })} aria-label={`Mark “${t.title}” done`} />
        <div className="grow">
          <p className="task-title">{t.title}</p>
          <p className="muted small">
            {courseCode(data, t.courseId) ?? "No course"} · {t.estMinutes || t.estLow ? mins(pt?.remaining ?? t.estMinutes) + " left" : "no estimate"} ·{" "}
            {t.due ? (
              <span className={overdue ? "overdue" : undefined}>
                {overdue && <span aria-hidden="true">! </span>}
                due {fmtWhen(t.due)}
                {t.allDay ? " (time not given)" : ""} ({rel(t.due, now)})
              </span>
            ) : (
              "due date unknown"
            )}
            {children.length > 0 && ` · ${children.filter((c) => c.done).length}/${children.length} steps done`}
            {pt && pt.missing > 0 && <span className="overdue"> · {mins(pt.missing)} short</span>}
            {t.assignee === "teammate" && " · teammate"}
          </p>
        </div>
        <button className="btn small-btn" onClick={onEdit} aria-expanded={editing}>
          {editing ? "Close" : "Edit"}
        </button>
      </div>
      {editing && <TaskEditor t={t} data={data} plan={plan} />}
    </li>
  );
}

/** The single missing fact with the biggest effect on the schedule. */
export function mostImportantGap(t: Task, data: Data): string | null {
  const steps = data.tasks.filter((c) => c.parentId === t.id && !c.done);
  if (!t.due) return "When is this due? Without a date it’s scheduled after everything with a deadline.";
  const noOwner = steps.find((s) => s.assignee === "unassigned");
  if (noOwner) return `Who is doing “${noOwner.title}”? It changes whether it takes your time.`;
  const noHandoff = steps.find((s) => s.assignee === "teammate" && !s.handoff);
  if (noHandoff) return `When will a teammate hand off “${noHandoff.title}”? Work that depends on it can’t be scheduled yet.`;
  if (t.estMinutes == null && t.estLow == null && !steps.length) return "How long will this take? 60 minutes is assumed until you add an estimate.";
  const noEst = steps.find((s) => s.assignee !== "teammate" && s.estMinutes == null);
  if (noEst) return `How long will “${noEst.title}” take?`;
  return null;
}

/** Longest chain of unfinished steps (by remaining minutes) ending at the project. */
export function criticalPath(t: Task, data: Data, plan: Plan): Task[] {
  const byId = new Map(data.tasks.map((x) => [x.id, x]));
  const cost = (x: Task) => (x.assignee === "teammate" ? 0 : plan.tasks.find((p) => p.task.id === x.id)?.remaining ?? x.estMinutes ?? 60);
  const memo = new Map<string, { len: number; path: Task[] }>();
  const visit = (x: Task, depth = 0): { len: number; path: Task[] } => {
    if (memo.has(x.id)) return memo.get(x.id)!;
    let best = { len: 0, path: [] as Task[] };
    if (depth < 20)
      for (const id of x.dependsOn) {
        const dep = byId.get(id);
        if (!dep || dep.done) continue;
        const r = visit(dep, depth + 1);
        if (r.len > best.len || !best.path.length) best = r;
      }
    const out = { len: best.len + cost(x), path: [...best.path, x] };
    memo.set(x.id, out);
    return out;
  };
  return visit(t).path;
}

function TaskEditor({ t, data, plan }: { t: Task; data: Data; plan: Plan }) {
  const set = (patch: Partial<Task>) => updateTask(t.id, patch);
  const steps = data.tasks.filter((c) => c.parentId === t.id);
  const siblings = data.tasks.filter((x) => x.id !== t.id && !x.done && (x.parentId === t.id || x.parentId === t.parentId || x.courseId === t.courseId));
  const items = data.gradeItems.filter((g) => g.courseId === t.courseId);
  const [stepTitle, setStepTitle] = useState("");
  const [copied, setCopied] = useState(false);
  const gap = mostImportantGap(t, data);
  const path = steps.length ? criticalPath(t, data, plan) : [];
  const atRiskStep = steps
    .filter((s) => !s.done && s.handoff)
    .map((s) => ({ s, pt: plan.tasks.find((p) => p.task.id === s.id) }))
    .find(({ s, pt }) => (pt && pt.missing > 0) || (s.assignee === "teammate" && Date.parse(s.handoff!) < Date.now()));
  const teammateSteps = steps.filter((s) => s.assignee === "teammate" && !s.done);
  const message = `Hi team, quick check on ${t.title}${t.due ? ` (due ${fmtWhen(t.due)})` : ""}: ${teammateSteps
    .map((s) => `${s.title}${s.handoff ? ` by ${fmtWhen(s.handoff)}` : " (when can you hand this off?)"}`)
    .join("; ")}. I’m planning my part around those times. Thanks!`;

  function addStep(e: FormEvent) {
    e.preventDefault();
    if (!stepTitle.trim()) return;
    const step = newTask({ title: stepTitle.trim(), courseId: t.courseId, parentId: t.id, assignee: "unassigned", kind: t.kind });
    update((d) => ({ ...d, tasks: [...d.tasks.map((x) => (x.id === t.id ? { ...x, dependsOn: [...x.dependsOn, step.id] } : x)), step] }));
    setStepTitle("");
  }

  function remove() {
    if (!window.confirm(`Delete “${t.title}”${steps.length ? " and its steps" : ""}?`)) return;
    const ids = new Set([t.id, ...steps.map((s) => s.id)]);
    update((d) => ({ ...d, tasks: d.tasks.filter((x) => !ids.has(x.id)).map((x) => ({ ...x, dependsOn: x.dependsOn.filter((id) => !ids.has(id)) })) }));
  }

  return (
    <div className="editor">
      {gap && (
        <p className="banner small" role="note">
          <strong>One question:</strong> {gap}
        </p>
      )}
      <div className="form">
        <label>
          Title
          <input value={t.title} onChange={(e) => set({ title: e.target.value })} maxLength={300} />
        </label>
        <div className="two">
          <label>
            Course
            <select value={t.courseId ?? ""} onChange={(e) => set({ courseId: e.target.value || null })}>
              <option value="">No course</option>
              {data.courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}
                </option>
              ))}
            </select>
          </label>
          <label>
            Type
            <select value={t.kind} onChange={(e) => set({ kind: e.target.value as TaskKind })}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="two">
          <label>
            Due
            <input type="datetime-local" value={toLocalInput(t.due)} onChange={(e) => set({ due: fromLocalInput(e.target.value), allDay: false })} />
          </label>
          <label>
            Handoff (to the group)
            <input type="datetime-local" value={toLocalInput(t.handoff)} onChange={(e) => set({ handoff: fromLocalInput(e.target.value) })} />
          </label>
        </div>
        <fieldset className="three">
          <legend>Estimate in minutes (low / typical / high)</legend>
          <input aria-label="Low estimate" type="number" inputMode="numeric" min={0} value={t.estLow ?? ""} onChange={(e) => set({ estLow: numOrNull(e.target.value) })} />
          <input
            aria-label="Typical estimate"
            type="number"
            inputMode="numeric"
            min={0}
            value={t.estMinutes ?? ""}
            onChange={(e) => set({ estMinutes: numOrNull(e.target.value), originalEstimate: t.originalEstimate ?? numOrNull(e.target.value) })}
          />
          <input aria-label="High estimate" type="number" inputMode="numeric" min={0} value={t.estHigh ?? ""} onChange={(e) => set({ estHigh: numOrNull(e.target.value) })} />
        </fieldset>
        <p className="small muted">
          {t.originalEstimate != null && t.originalEstimate !== t.estMinutes ? `First estimate: ${mins(t.originalEstimate)} (kept for learning your pace). ` : ""}
          {t.spentMinutes ? `${mins(t.spentMinutes)} logged so far.` : ""}
        </p>
        <div className="two">
          <label>
            Importance
            <select value={t.importance} onChange={(e) => set({ importance: Number(e.target.value) as 1 | 2 | 3 })}>
              <option value={1}>Low</option>
              <option value={2}>Normal</option>
              <option value={3}>High</option>
            </select>
          </label>
          <label>
            Who does it
            <select value={t.assignee} onChange={(e) => set({ assignee: e.target.value as Task["assignee"] })}>
              <option value="me">Me</option>
              <option value="teammate">A teammate</option>
              <option value="unassigned">Not decided</option>
            </select>
          </label>
        </div>
        <div className="two">
          <label>
            Needs
            <select value={t.needs} onChange={(e) => set({ needs: e.target.value as Task["needs"] })}>
              <option value="any">Anything (phone is fine)</option>
              <option value="computer">A computer (e.g. Excel)</option>
              <option value="campus">Being on campus / a lab</option>
            </select>
          </label>
          <label>
            Focus needed
            <select value={t.energy} onChange={(e) => set({ energy: e.target.value as Task["energy"] })}>
              <option value="deep">Deep focus</option>
              <option value="normal">Normal</option>
              <option value="light">Light</option>
            </select>
          </label>
        </div>
        {items.length > 0 && (
          <label>
            Counts toward grade item
            <select value={t.gradeItemId ?? ""} onChange={(e) => set({ gradeItemId: e.target.value || null })}>
              <option value="">Not linked</option>
              {items.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {siblings.length > 0 && (
          <fieldset className="deps">
            <legend>Can’t start until these are done</legend>
            {siblings.map((s) => (
              <label key={s.id} className="check">
                <input
                  type="checkbox"
                  checked={t.dependsOn.includes(s.id)}
                  onChange={(e) => set({ dependsOn: e.target.checked ? [...t.dependsOn, s.id] : t.dependsOn.filter((x) => x !== s.id) })}
                />
                <span>{s.title}</span>
              </label>
            ))}
          </fieldset>
        )}
        <label>
          Notes
          <textarea value={t.notes} onChange={(e) => set({ notes: e.target.value })} rows={3} maxLength={5000} />
        </label>
        {t.evidence.length > 0 && (
          <Details summary={`Sources (${t.evidence.length})`}>
            <ul className="small">
              {t.evidence.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Details>
        )}
      </div>

      <section className="steps" aria-label="Steps">
        <h3>Steps {steps.length ? `(${steps.filter((s) => s.done).length}/${steps.length} done)` : ""}</h3>
        <p className="small muted">Break a project into steps. Each step can have its own owner, handoff time and estimate. The project waits for its steps.</p>
        {path.length > 1 && (
          <p className="small">
            <strong>Critical path:</strong> {path.map((p) => p.title).join(" → ")}
          </p>
        )}
        {atRiskStep && (
          <p className="banner warn small">
            <span aria-hidden="true">! </span>Handoff at risk: “{atRiskStep.s.title}” ({fmtWhen(atRiskStep.s.handoff!)}).
          </p>
        )}
        <ul className="plain">
          {steps.map((s) => (
            <li key={s.id} className="step">
              <label className="check">
                <input type="checkbox" checked={s.done} onChange={(e) => updateTask(s.id, { done: e.target.checked, doneAt: e.target.checked ? new Date().toISOString() : null })} />
                <span className={s.done ? "struck" : undefined}>{s.title}</span>
              </label>
              <select aria-label={`Who does ${s.title}`} value={s.assignee} onChange={(e) => updateTask(s.id, { assignee: e.target.value as Task["assignee"] })}>
                <option value="me">Me</option>
                <option value="teammate">Teammate</option>
                <option value="unassigned">Not decided</option>
              </select>
              <input aria-label={`Handoff for ${s.title}`} type="datetime-local" value={toLocalInput(s.handoff)} onChange={(e) => updateTask(s.id, { handoff: fromLocalInput(e.target.value) })} />
              <input
                aria-label={`Minutes for ${s.title}`}
                type="number"
                inputMode="numeric"
                min={0}
                placeholder="min"
                value={s.estMinutes ?? ""}
                onChange={(e) => updateTask(s.id, { estMinutes: numOrNull(e.target.value), originalEstimate: s.originalEstimate ?? numOrNull(e.target.value) })}
              />
            </li>
          ))}
        </ul>
        <form className="row" onSubmit={addStep}>
          <input aria-label="New step" value={stepTitle} onChange={(e) => setStepTitle(e.target.value)} placeholder="Add a step, e.g. Teammate review" maxLength={200} />
          <button className="btn" type="submit">Add step</button>
        </form>
        {teammateSteps.length > 0 && (
          <Details summary="Message for teammates (copy and send yourself)">
            <textarea readOnly rows={4} value={message} onFocus={(e) => e.currentTarget.select()} />
            <button className="btn" onClick={async () => setCopied(await copyText(message))}>
              Copy message
            </button>
            {copied && <span className="small"> Copied.</span>}
            <p className="small muted">Nothing is sent automatically.</p>
          </Details>
        )}
      </section>

      <div className="row actions">
        <button className="btn danger" onClick={remove}>Delete task</button>
        <span className="small muted">Changes save automatically.</span>
      </div>
    </div>
  );
}
