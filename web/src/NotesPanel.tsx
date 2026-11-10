import { useState } from "react";
import { newId, update, type Course, type Data, type Note } from "./store";
import { fmtWhen } from "./ui";

/**
 * Course notes you write or paste yourself, with search. Nothing is sent to any
 * AI. For each claim, note the source (slide/page) so you can find it again.
 */
export function NotesPanel({ course, data }: { course: Course; data: Data }) {
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const notes = data.notes
    .filter((n) => n.courseId === course.id)
    .filter((n) => !q || `${n.title}\n${n.body}\n${n.source}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  function add() {
    const n: Note = { id: newId(), courseId: course.id, title: "New note", body: "Objective:\n\nKey ideas:\n- \n\nDefinitions:\n- \n\nRecall questions:\n1. ", source: "", updatedAt: new Date().toISOString() };
    update((d) => ({ ...d, notes: [...d.notes, n] }));
    setEditing(n.id);
  }

  const set = (id: string, patch: Partial<Note>) => update((d) => ({ ...d, notes: d.notes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: new Date().toISOString() } : n)) }));

  return (
    <div className="notes">
      {course.aiUse === "unknown" && <p className="small muted">AI-use rule for this course is unknown (Settings tab). This app doesn’t use AI either way.</p>}
      <div className="row">
        <input type="search" aria-label={`Search ${course.code} notes`} placeholder="Search notes" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn" onClick={add}>New note</button>
      </div>
      {notes.length === 0 && <p className="muted small">{q ? "No notes match." : "No notes yet."}</p>}
      <ul className="plain">
        {notes.map((n) =>
          editing === n.id ? (
            <li key={n.id} className="note editing">
              <label>
                Title
                <input value={n.title} onChange={(e) => set(n.id, { title: e.target.value })} maxLength={200} />
              </label>
              <label>
                Source (e.g. Lecture 12 slides 4–9, version of Nov 3)
                <input value={n.source} onChange={(e) => set(n.id, { source: e.target.value })} maxLength={300} />
              </label>
              <label>
                Notes
                <textarea rows={10} value={n.body} onChange={(e) => set(n.id, { body: e.target.value })} maxLength={50000} />
              </label>
              <div className="row actions">
                <button className="btn primary" onClick={() => setEditing(null)}>Done</button>
                <button
                  className="btn danger"
                  onClick={() => {
                    if (window.confirm("Delete this note?")) update((d) => ({ ...d, notes: d.notes.filter((x) => x.id !== n.id) }));
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          ) : (
            <li key={n.id} className="note">
              <button className="note-open" onClick={() => setEditing(n.id)}>
                <span className="task-title">{n.title}</span>
                <span className="small muted">
                  {n.source ? `${n.source} · ` : ""}edited {fmtWhen(n.updatedAt)}
                </span>
                <span className="small preview">{n.body.slice(0, 160)}</span>
              </button>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
