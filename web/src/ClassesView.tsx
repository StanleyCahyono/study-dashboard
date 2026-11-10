import { useState, type FormEvent } from "react";
import { newId, update, useData, WEEKDAYS, type Course } from "./store";

export function ClassesView() {
  const data = useData();
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");

  function addCourse(e: FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    update((d) => ({ ...d, courses: [...d.courses, { id: newId(), code: code.trim().toUpperCase(), title: title.trim() }] }));
    setCode("");
    setTitle("");
  }

  return (
    <main className="page" aria-labelledby="classes-title">
      <h1 id="classes-title">Classes</h1>
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
          <CourseCard key={c.id} course={c} />
        ))}
      </ul>
    </main>
  );
}

function CourseCard({ course }: { course: Course }) {
  const data = useData();
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
    }));
    setDays([]);
  }

  function removeCourse() {
    if (!window.confirm(`Delete ${course.code}, its class times, and unlink its tasks?`)) return;
    update((d) => ({
      ...d,
      courses: d.courses.filter((c) => c.id !== course.id),
      meetings: d.meetings.filter((m) => m.courseId !== course.id),
      tasks: d.tasks.map((t) => (t.courseId === course.id ? { ...t, courseId: null } : t)),
    }));
  }

  return (
    <li className="card">
      <div className="row">
        <div>
          <p className="big">{course.code}</p>
          {course.title && <p className="muted">{course.title}</p>}
        </div>
        <button className="btn danger" onClick={removeCourse} aria-label={`Delete course ${course.code}`}>
          Delete
        </button>
      </div>
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
    </li>
  );
}
