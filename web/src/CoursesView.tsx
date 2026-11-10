import { useState, type FormEvent } from "react";
import { newCourse, newId, update, useData, WEEKDAYS, type AiUse, type Commitment, type Course, type CoverageKey, type Data } from "./store";
import { GradesPanel } from "./GradesPanel";
import { NotesPanel } from "./NotesPanel";
import { termGpa } from "./grades";
import { fmtTime, fmtWhen, fromLocalInput, numOrNull } from "./ui";

export function CoursesView() {
  const data = useData();
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  function addCourse(e: FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    const c = newCourse(code.trim().toUpperCase(), title.trim());
    update((d) => ({ ...d, courses: [...d.courses, c] }));
    setCode("");
    setTitle("");
    setOpen(c.id);
  }

  return (
    <main className="page" aria-labelledby="courses-title">
      <h1 id="courses-title">Courses</h1>
      {data.courses.length > 0 && <TermGpa data={data} />}
      <form className="card form" onSubmit={addCourse} aria-label="Add a course">
        <div className="two">
          <label>
            Course code
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="AEM 1101" required maxLength={32} />
          </label>
          <label>
            Name (optional)
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </label>
        </div>
        <button className="btn primary" type="submit">Add course</button>
      </form>
      {data.courses.length === 0 && <p className="muted">No courses yet.</p>}
      <ul className="list">
        {data.courses.map((c) => (
          <CourseCard key={c.id} course={c} data={data} open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)} />
        ))}
      </ul>
      <Commitments data={data} />
    </main>
  );
}

const COVERAGE: [CoverageKey, string][] = [
  ["dueDates", "Due dates (Canvas calendar, syllabus or manual)"],
  ["meetings", "Class meeting times"],
  ["grades", "Grade weights and scores"],
  ["syllabus", "Syllabus read and rules confirmed"],
];

const AI_USE: [AiUse, string][] = [
  ["unknown", "Unknown — check the syllabus"],
  ["metadata", "Organizing only (dates, titles)"],
  ["local", "Summaries allowed on my own device"],
  ["external", "An approved outside AI tool is allowed"],
];

function CourseCard({ course, data, open, onToggle }: { course: Course; data: Data; open: boolean; onToggle: () => void }) {
  const set = (patch: Partial<Course>) => update((d) => ({ ...d, courses: d.courses.map((c) => (c.id === course.id ? { ...c, ...patch } : c)) }));
  const meetings = data.meetings.filter((m) => m.courseId === course.id).sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));
  const [tab, setTab] = useState<"schedule" | "grades" | "notes" | "about">("schedule");
  const missing = COVERAGE.filter(([k]) => !course.coverage[k]).length;

  function removeCourse() {
    if (!window.confirm(`Delete ${course.code}, its class times, grades and notes, and unlink its tasks?`)) return;
    update((d) => ({
      ...d,
      courses: d.courses.filter((c) => c.id !== course.id),
      meetings: d.meetings.filter((m) => m.courseId !== course.id),
      gradeItems: d.gradeItems.filter((g) => g.courseId !== course.id),
      notes: d.notes.filter((n) => n.courseId !== course.id),
      tasks: d.tasks.map((t) => (t.courseId === course.id ? { ...t, courseId: null, gradeItemId: null } : t)),
    }));
  }

  return (
    <li className="card">
      <div className="row">
        <div>
          <p className="big">{course.code}</p>
          {course.title && <p className="muted">{course.title}</p>}
          <p className="small muted">
            {meetings.length} class {meetings.length === 1 ? "time" : "times"} · {data.tasks.filter((t) => t.courseId === course.id && !t.done).length} open tasks
            {missing > 0 && <> · {missing} source{missing === 1 ? "" : "s"} not covered</>}
          </p>
        </div>
        <button className="btn small-btn" onClick={onToggle} aria-expanded={open}>
          {open ? "Close" : "Open"}
        </button>
      </div>
      {open && (
        <>
          <div className="tabs" role="tablist" aria-label={`${course.code} sections`}>
            {(["schedule", "grades", "notes", "about"] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "seg active" : "seg"} onClick={() => setTab(t)}>
                {t === "schedule" ? "Schedule" : t === "grades" ? "Grades" : t === "notes" ? "Notes" : "Settings"}
              </button>
            ))}
          </div>
          {tab === "schedule" && <Schedule course={course} data={data} />}
          {tab === "grades" && <GradesPanel course={course} data={data} />}
          {tab === "notes" && <NotesPanel course={course} data={data} />}
          {tab === "about" && (
            <div className="form">
              <div className="two">
                <label>
                  Target grade (%)
                  <input type="number" inputMode="decimal" min={0} max={110} value={course.target ?? ""} onChange={(e) => set({ target: numOrNull(e.target.value) })} />
                </label>
                <label>
                  Importance
                  <select value={course.importance} onChange={(e) => set({ importance: Number(e.target.value) as 1 | 2 | 3 })}>
                    <option value={1}>Low</option>
                    <option value={2}>Normal</option>
                    <option value={3}>High</option>
                  </select>
                </label>
              </div>
              <fieldset>
                <legend>What’s covered for this course</legend>
                {COVERAGE.map(([k, l]) => (
                  <label key={k} className="check">
                    <input type="checkbox" checked={course.coverage[k]} onChange={(e) => set({ coverage: { ...course.coverage, [k]: e.target.checked } })} />
                    <span>{l}</span>
                  </label>
                ))}
                <p className="small muted">An empty calendar doesn’t mean there’s no coursework. Unticked items are unknown.</p>
              </fieldset>
              <label>
                AI use allowed by this course
                <select value={course.aiUse} onChange={(e) => set({ aiUse: e.target.value as AiUse })}>
                  {AI_USE.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Where the policy says so (syllabus page, date)
                <input value={course.aiPolicyNote} onChange={(e) => set({ aiPolicyNote: e.target.value })} maxLength={300} />
              </label>
              <p className="small muted">This app never sends course material to any AI. The setting is a reminder for when you use outside tools.</p>
              <button className="btn danger" onClick={removeCourse}>Delete course</button>
            </div>
          )}
        </>
      )}
    </li>
  );
}

function Schedule({ course, data }: { course: Course; data: Data }) {
  const meetings = data.meetings.filter((m) => m.courseId === course.id).sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));
  const [days, setDays] = useState<number[]>([]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [kind, setKind] = useState("lecture");
  const [location, setLocation] = useState("");
  const [error, setError] = useState<string | null>(null);

  function addMeeting(e: FormEvent) {
    e.preventDefault();
    if (days.length === 0 || !start || !end) return setError("Pick at least one day and both times.");
    if (end <= start) return setError("The end time must be after the start time.");
    setError(null);
    update((d) => ({
      ...d,
      meetings: [...d.meetings, ...days.map((weekday) => ({ id: newId(), courseId: course.id, kind, weekday, start, end, location: location.trim() }))],
      courses: d.courses.map((c) => (c.id === course.id ? { ...c, coverage: { ...c.coverage, meetings: true } } : c)),
    }));
    setDays([]);
  }

  return (
    <>
      <ul className="meetings">
        {meetings.map((m) => (
          <li key={m.id}>
            <span>
              {WEEKDAYS[m.weekday].slice(0, 3)} {m.start}–{m.end} · {m.kind}
              {m.location && ` · ${m.location}`}
            </span>
            <button
              className="icon-btn"
              onClick={() => update((d) => ({ ...d, meetings: d.meetings.filter((x) => x.id !== m.id) }))}
              aria-label={`Remove ${WEEKDAYS[m.weekday]} ${m.start} class time`}
            >
              ✕
            </button>
          </li>
        ))}
        {meetings.length === 0 && <li className="muted small">No class times yet.</li>}
      </ul>
      <form className="form compact" onSubmit={addMeeting} aria-label={`Add class time for ${course.code}`}>
        <fieldset className="days">
          <legend>Days</legend>
          {WEEKDAYS.map((name, i) => (
            <label key={name} className="day">
              <input type="checkbox" checked={days.includes(i)} onChange={(e) => setDays(e.target.checked ? [...days, i] : days.filter((d) => d !== i))} />
              <span>{name.slice(0, 3)}</span>
            </label>
          ))}
        </fieldset>
        <div className="two">
          <label>
            Starts
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label>
            Ends
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
        <div className="two">
          <label>
            Type
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="lecture">Lecture</option>
              <option value="section">Section</option>
              <option value="lab">Lab</option>
              <option value="discussion">Discussion</option>
            </select>
          </label>
          <label>
            Room (optional)
            <input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} />
          </label>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn" type="submit">Add class time</button>
      </form>
    </>
  );
}

function Commitments({ data }: { data: Data }) {
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [courseId, setCourseId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const upcoming = data.commitments.filter((c) => Date.parse(c.end) > Date.now()).sort((a, b) => a.start.localeCompare(b.start));

  function add(e: FormEvent) {
    e.preventDefault();
    const s = fromLocalInput(start);
    const en = fromLocalInput(end);
    if (!title.trim() || !s || !en) return setError("Add a title, start and end.");
    if (en <= s) return setError("The end must be after the start.");
    setError(null);
    const c: Commitment = { id: newId(), title: title.trim(), start: s, end: en, courseId: courseId || null, kind: /exam|prelim|midterm|final|quiz/i.test(title) ? "exam" : "fixed", source: "manual" };
    update((d) => ({ ...d, commitments: [...d.commitments, c] }));
    setTitle("");
    setStart("");
    setEnd("");
  }

  return (
    <section className="card" aria-labelledby="commit-title">
      <h2 id="commit-title">Other fixed commitments</h2>
      <p className="small muted">Exam sittings, work shifts, appointments: the planner keeps these free.</p>
      <ul className="meetings">
        {upcoming.map((c) => (
          <li key={c.id}>
            <span>
              {c.kind === "exam" && <span className="tag">Exam</span>} {c.title} · {fmtWhen(c.start)}–{fmtTime(c.end)}
            </span>
            <button className="icon-btn" aria-label={`Remove ${c.title}`} onClick={() => update((d) => ({ ...d, commitments: d.commitments.filter((x) => x.id !== c.id) }))}>
              ✕
            </button>
          </li>
        ))}
        {upcoming.length === 0 && <li className="muted small">None upcoming.</li>}
      </ul>
      <form className="form compact" onSubmit={add} aria-label="Add a commitment">
        <label>
          What
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. ECON prelim 2 / work shift" maxLength={200} />
        </label>
        <div className="two">
          <label>
            Starts
            <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label>
            Ends
            <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
        <label>
          Course (optional)
          <select value={courseId} onChange={(e) => setCourseId(e.target.value)}>
            <option value="">None</option>
            {data.courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn" type="submit">Add commitment</button>
      </form>
    </section>
  );
}

function TermGpa({ data }: { data: Data }) {
  const t = termGpa(data.courses, data.gradeItems);
  return (
    <section className="card" aria-labelledby="gpa-title">
      <div className="row">
        <h2 id="gpa-title">Term GPA</h2>
        <span className="stat">{t.gpa == null ? "—" : t.gpa.toFixed(2)}</span>
      </div>
      <p className="small muted">
        Credit-weighted over {t.credits} credits, using projected letters (confirmed + tentative scores). Cornell scale: A+ = 4.3.
      </p>
      <table className="list-table">
        <thead>
          <tr>
            <th scope="col">Course</th>
            <th scope="col">Credits</th>
            <th scope="col">Letter</th>
            <th scope="col">Points</th>
          </tr>
        </thead>
        <tbody>
          {t.rows.map((r) => (
            <tr key={r.code}>
              <td>
                {r.code}
                {r.note && <span className="small muted"> · {r.note}</span>}
              </td>
              <td>{r.credits ?? "—"}</td>
              <td>{r.letter ?? "—"}</td>
              <td>{r.gpa == null ? "—" : r.gpa.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
