import { useState, type FormEvent } from "react";
import { newId, update, type Course, type Data, type GradeItem, type GradeStatus } from "./store";
import { courseSummary, DEFAULT_CUTOFFS, finalIf, LETTERS, neededOnRemaining, parseGradeCsv, scenarios, type CsvRow } from "./grades";
import { Details, numOrNull } from "./ui";

const STATUS: [GradeStatus, string][] = [
  ["pending", "Not graded yet"],
  ["graded", "Graded (confirmed)"],
  ["projected", "Tentative (my estimate)"],
  ["missing", "Missing (counts as 0)"],
  ["excused", "Excused (doesn’t count)"],
];

export function GradesPanel({ course, data }: { course: Course; data: Data }) {
  const summary = courseSummary(course, data.gradeItems);
  const g = summary.official;
  const pg = summary.projected;
  const hasTentative = data.gradeItems.some((i) => i.courseId === course.id && i.status === "projected");
  const items = data.gradeItems.filter((i) => i.courseId === course.id);
  const [whatIf, setWhatIf] = useState("");
  const setCourse = (patch: Partial<Course>) => update((d) => ({ ...d, courses: d.courses.map((c) => (c.id === course.id ? { ...c, ...patch } : c)) }));
  const setGrading = (patch: Partial<Course["grading"]>) => setCourse({ grading: { ...course.grading, ...patch } });
  const setItem = (id: string, patch: Partial<GradeItem>) =>
    update((d) => ({ ...d, gradeItems: d.gradeItems.map((i) => (i.id === id ? { ...i, ...patch, gradedAt: patch.status === "graded" || patch.score != null ? new Date().toISOString() : i.gradedAt } : i)) }));
  const target = course.target;
  const need = target != null ? neededOnRemaining(g, target) : null;
  const sc = scenarios(g);
  const wi = numOrNull(whatIf);
  const graded = items.filter((i) => i.status === "graded" || i.status === "missing").length;

  return (
    <div className="grades">
      <div className="stats">
        <div>
          <span className="stat">
            {summary.letter ?? "—"}
            {summary.gpa != null && <span className="small"> ({summary.gpa.toFixed(1)})</span>}
          </span>
          <span className="small muted">
            {summary.basis === "final_letter" ? "Final letter" : summary.basis === "pass_fail" ? `Pass/Fail at ${course.passThreshold}%` : hasTentative ? "Projected letter" : "Letter so far"}
            {summary.assumedCutoffs && " (cutoffs assumed)"}
          </span>
        </div>
        <div>
          <span className="stat">{g.standing == null ? "—" : `${g.standing}%`}</span>
          <span className="small muted">Standing on confirmed work{hasTentative && pg.standing != null ? ` · ${pg.standing}% with tentative` : ""}</span>
        </div>
        <div>
          <span className="stat">{g.secured}</span>
          <span className="small muted">Course points secured</span>
        </div>
        <div>
          <span className="stat">{g.remainingWeight}%</span>
          <span className="small muted">Still to be graded</span>
        </div>
      </div>
      {summary.scheme && (
        <p className="small">
          Using <strong>{summary.scheme.name}</strong> (better of {summary.schemes.map((x) => `${x.name} ${x.projected.standing ?? "—"}%`).join(" vs ")}).
        </p>
      )}
      {need && target != null && (
        <p className={need.kind === "impossible" ? "banner warn" : "banner"}>
          {need.kind === "already" && `Your ${target}% target is already secured.`}
          {need.kind === "needed" && (
            <>
              To reach <strong>{target}%</strong> you need an average of <strong>{need.percent}%</strong> on the remaining {g.remainingWeight}%.
            </>
          )}
          {need.kind === "impossible" && `${target}% isn’t reachable: it would need ${need.percent}% on the remaining work (more than 100%).`}
          {need.kind === "final" && "Everything is graded."}
        </p>
      )}
      {target == null && <p className="small muted">Set a target grade in this course’s Settings to see what you need.</p>}
      {g.warnings.length > 0 && (
        <ul className="small warn-list">
          {g.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <Details summary="What-if and scenarios">
        <label>
          If I average this on everything left (%)
          <input type="number" inputMode="decimal" min={0} max={150} value={whatIf} onChange={(e) => setWhatIf(e.target.value)} />
        </label>
        {wi != null && (
          <p>
            Final grade: <strong>{finalIf(g, wi)}%</strong>
          </p>
        )}
        <p className="small muted">{sc.basis}</p>
        <ul>
          {sc.items.map((s) => (
            <li key={s.label}>
              {s.label}: {s.final}%
            </li>
          ))}
        </ul>
        <p className="small muted">
          Evidence: {graded} graded item{graded === 1 ? "" : "s"}, {Math.round(g.gradedFraction * 100)}% of the course graded, rules {course.grading.rulesConfirmed ? "confirmed" : "not confirmed"}.
          {graded < 3 && " Too little history for a calibrated prediction, so only scenarios are shown."} Time spent studying is not assumed to raise a grade.
        </p>
      </Details>

      <Details summary="Grading rules">
        <div className="form">
          <label>
            How this course is graded
            <select value={course.grading.mode} onChange={(e) => setGrading({ mode: e.target.value as "weighted" | "points" })}>
              <option value="weighted">Weighted groups (e.g. Exams 40%, Homework 20%)</option>
              <option value="points">Total points</option>
            </select>
          </label>
          {course.grading.mode === "weighted" && (
            <>
              <table className="list-table">
                <thead>
                  <tr>
                    <th scope="col">Group</th>
                    <th scope="col">Weight %</th>
                    <th scope="col">Drop lowest</th>
                    <th scope="col">
                      <span className="sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {course.grading.groups.map((grp) => (
                    <tr key={grp.id}>
                      <td>
                        <input aria-label="Group name" value={grp.name} onChange={(e) => setGrading({ groups: course.grading.groups.map((x) => (x.id === grp.id ? { ...x, name: e.target.value } : x)) })} />
                      </td>
                      <td>
                        <input
                          aria-label={`Weight of ${grp.name}`}
                          type="number"
                          inputMode="decimal"
                          min={0}
                          max={100}
                          placeholder="?"
                          value={grp.weight ?? ""}
                          onChange={(e) => setGrading({ groups: course.grading.groups.map((x) => (x.id === grp.id ? { ...x, weight: numOrNull(e.target.value) } : x)) })}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Drop lowest in ${grp.name}`}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={10}
                          value={grp.dropLowest}
                          onChange={(e) => setGrading({ groups: course.grading.groups.map((x) => (x.id === grp.id ? { ...x, dropLowest: Math.max(0, Number(e.target.value) || 0) } : x)) })}
                        />
                      </td>
                      <td>
                        <button className="icon-btn" aria-label={`Remove group ${grp.name}`} onClick={() => setGrading({ groups: course.grading.groups.filter((x) => x.id !== grp.id) })}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="btn" onClick={() => setGrading({ groups: [...course.grading.groups, { id: newId(), name: "New group", weight: null, dropLowest: 0 }] })}>
                Add group
              </button>
            </>
          )}
          {course.grading.mode === "weighted" && course.grading.groups.length > 0 && (
            <>
              {course.grading.groups.map((grp) => (
                <label key={grp.id} className="check small">
                  <input
                    type="checkbox"
                    checked={Boolean(grp.extraCredit)}
                    onChange={(e) => setGrading({ groups: course.grading.groups.map((x) => (x.id === grp.id ? { ...x, extraCredit: e.target.checked } : x)) })}
                  />
                  <span>“{grp.name}” is extra credit on top of 100%</span>
                </label>
              ))}
              <h3>Alternative schemes (the better one counts)</h3>
              {course.grading.altSchemes.map((sc2) => (
                <div key={sc2.id} className="scheme">
                  <div className="row">
                    <input aria-label="Scheme name" value={sc2.name} onChange={(e) => setGrading({ altSchemes: course.grading.altSchemes.map((x) => (x.id === sc2.id ? { ...x, name: e.target.value } : x)) })} />
                    <button className="icon-btn" aria-label={`Remove ${sc2.name}`} onClick={() => setGrading({ altSchemes: course.grading.altSchemes.filter((x) => x.id !== sc2.id) })}>
                      ✕
                    </button>
                  </div>
                  {course.grading.groups.map((grp) => (
                    <label key={grp.id} className="inline-weight">
                      <span>{grp.name} %</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={100}
                        value={sc2.weights[grp.id] ?? ""}
                        onChange={(e) =>
                          setGrading({ altSchemes: course.grading.altSchemes.map((x) => (x.id === sc2.id ? { ...x, weights: { ...x.weights, [grp.id]: numOrNull(e.target.value) } } : x)) })
                        }
                      />
                    </label>
                  ))}
                </div>
              ))}
              <button
                className="btn"
                onClick={() =>
                  setGrading({
                    altSchemes: [
                      ...course.grading.altSchemes,
                      { id: newId(), name: `Scheme ${course.grading.altSchemes.length + 2}`, weights: Object.fromEntries(course.grading.groups.map((x) => [x.id, x.weight])) },
                    ],
                  })
                }
              >
                Add alternative scheme
              </button>
            </>
          )}
          <div className="two">
            <label>
              Credits
              <input type="number" inputMode="decimal" min={0} max={12} value={course.credits ?? ""} onChange={(e) => setCourse({ credits: numOrNull(e.target.value) })} />
            </label>
            <label>
              Graded as
              <select value={course.basis} onChange={(e) => setCourse({ basis: e.target.value as Course["basis"] })}>
                <option value="letter">Letter grade</option>
                <option value="pass_fail">Pass / Fail</option>
              </select>
            </label>
          </div>
          {course.basis === "pass_fail" ? (
            <label>
              Pass at (%)
              <input type="number" inputMode="decimal" min={0} max={100} value={course.passThreshold} onChange={(e) => setCourse({ passThreshold: Number(e.target.value) || 0 })} />
            </label>
          ) : (
            <fieldset>
              <legend>Letter cutoffs (minimum %)</legend>
              {course.cutoffs == null ? (
                <p className="small muted">
                  Not entered: the usual scale (A ≥ 93, A- ≥ 90, …) is assumed.{" "}
                  <button className="link inline" onClick={() => setCourse({ cutoffs: DEFAULT_CUTOFFS.map((c) => ({ ...c })) })}>
                    Enter this course’s cutoffs
                  </button>
                </p>
              ) : (
                <div className="cutoffs">
                  {course.cutoffs.map((c, idx) => (
                    <label key={c.letter} className="inline-weight">
                      <span>{c.letter}</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={110}
                        value={c.min}
                        onChange={(e) => setCourse({ cutoffs: course.cutoffs!.map((x, j) => (j === idx ? { ...x, min: Number(e.target.value) || 0 } : x)) })}
                      />
                    </label>
                  ))}
                  <button className="link inline" onClick={() => setCourse({ cutoffs: null })}>
                    Use the assumed scale
                  </button>
                </div>
              )}
            </fieldset>
          )}
          <label>
            Final letter already known (course not tracked here)
            <select value={course.finalLetter ?? ""} onChange={(e) => setCourse({ finalLetter: e.target.value || null })}>
              <option value="">Not final yet</option>
              {LETTERS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Where these rules come from (e.g. syllabus p.3, dated)
            <input value={course.grading.ruleSource} onChange={(e) => setGrading({ ruleSource: e.target.value })} maxLength={300} />
          </label>
          <label className="check">
            <input type="checkbox" checked={course.grading.rulesConfirmed} onChange={(e) => setGrading({ rulesConfirmed: e.target.checked })} />
            <span>I checked these rules against the syllabus (curves, drops, replacement exams, late policy)</span>
          </label>
        </div>
      </Details>

      <h3>Graded items</h3>
      <ul className="plain grade-items">
        {items.map((i) => (
          <li key={i.id} className="grade-item">
            <input aria-label="Item name" value={i.name} onChange={(e) => setItem(i.id, { name: e.target.value })} />
            {course.grading.mode === "weighted" && (
              <select aria-label={`Group of ${i.name}`} value={i.groupId ?? ""} onChange={(e) => setItem(i.id, { groupId: e.target.value || null })}>
                <option value="">No group</option>
                {course.grading.groups.map((grp) => (
                  <option key={grp.id} value={grp.id}>
                    {grp.name}
                  </option>
                ))}
              </select>
            )}
            <span className="score">
              <input aria-label={`Score for ${i.name}`} type="number" inputMode="decimal" min={0} placeholder="score" value={i.score ?? ""} onChange={(e) => setItem(i.id, { score: numOrNull(e.target.value), status: numOrNull(e.target.value) == null ? i.status : "graded" })} />
              <span aria-hidden="true">/</span>
              <input aria-label={`Points possible for ${i.name}`} type="number" inputMode="decimal" min={0} value={i.possible} onChange={(e) => setItem(i.id, { possible: Number(e.target.value) || 0 })} />
            </span>
            <select aria-label={`Status of ${i.name}`} value={i.status} onChange={(e) => setItem(i.id, { status: e.target.value as GradeStatus })}>
              {STATUS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <label className="check small">
              <input type="checkbox" checked={i.extraCredit} onChange={(e) => setItem(i.id, { extraCredit: e.target.checked })} />
              <span>Extra credit</span>
            </label>
            <button className="icon-btn" aria-label={`Remove ${i.name}`} onClick={() => update((d) => ({ ...d, gradeItems: d.gradeItems.filter((x) => x.id !== i.id), tasks: d.tasks.map((t) => (t.gradeItemId === i.id ? { ...t, gradeItemId: null } : t)) }))}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <AddItem course={course} />
      <CsvImport course={course} />
    </div>
  );
}

function AddItem({ course }: { course: Course }) {
  const [name, setName] = useState("");
  const [possible, setPossible] = useState("100");
  const [groupId, setGroupId] = useState("");
  function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const item: GradeItem = { id: newId(), courseId: course.id, groupId: groupId || null, name: name.trim(), possible: Number(possible) || 100, score: null, status: "pending", extraCredit: false, gradedAt: null };
    update((d) => ({ ...d, gradeItems: [...d.gradeItems, item], courses: d.courses.map((c) => (c.id === course.id ? { ...c, coverage: { ...c.coverage, grades: true } } : c)) }));
    setName("");
  }
  return (
    <form className="row add-item" onSubmit={add} aria-label="Add a graded item">
      <input aria-label="New item name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Prelim 1" maxLength={200} />
      <input aria-label="New item points possible" type="number" inputMode="decimal" min={0} value={possible} onChange={(e) => setPossible(e.target.value)} />
      {course.grading.mode === "weighted" && (
        <select aria-label="New item group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          <option value="">No group</option>
          {course.grading.groups.map((grp) => (
            <option key={grp.id} value={grp.id}>
              {grp.name}
            </option>
          ))}
        </select>
      )}
      <button className="btn" type="submit">Add item</button>
    </form>
  );
}

function CsvImport({ course }: { course: Course }) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<CsvRow[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  function apply() {
    if (!rows) return;
    const good = rows.filter((r) => !r.error);
    update((d) => {
      let groups = [...(d.courses.find((c) => c.id === course.id)?.grading.groups ?? [])];
      const items: GradeItem[] = good.map((r) => {
        let groupId: string | null = null;
        if (r.group) {
          let grp = groups.find((x) => x.name.toLowerCase() === r.group.toLowerCase());
          if (!grp) {
            grp = { id: newId(), name: r.group, weight: null, dropLowest: 0 };
            groups = [...groups, grp];
          }
          groupId = grp.id;
        }
        return { id: newId(), courseId: course.id, groupId, name: r.name, possible: r.possible, score: r.score, status: r.status, extraCredit: false, gradedAt: r.score != null ? new Date().toISOString() : null };
      });
      return {
        ...d,
        gradeItems: [...d.gradeItems, ...items],
        courses: d.courses.map((c) => (c.id === course.id ? { ...c, grading: { ...c.grading, groups }, coverage: { ...c.coverage, grades: true } } : c)),
      };
    });
    setMsg(`Imported ${good.length} item(s)${rows.length - good.length ? `; skipped ${rows.length - good.length} with errors` : ""}. New groups have unknown weights until you set them.`);
    setRows(null);
    setText("");
  }
  return (
    <Details summary="Import scores from CSV">
      <p className="small muted">Paste rows like <code>name,score,possible,group,status</code> (header optional). Check the preview before importing.</p>
      <textarea aria-label="CSV text" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn" onClick={() => setRows(parseGradeCsv(text))} disabled={!text.trim()}>
        Preview
      </button>
      {rows && (
        <>
          <table className="list-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Score</th>
                <th scope="col">Possible</th>
                <th scope="col">Group</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={r.error ? "row-error" : undefined}>
                  <td>{r.name}</td>
                  <td>{r.score ?? "—"}</td>
                  <td>{r.possible || "—"}</td>
                  <td>{r.group || "—"}</td>
                  <td>{r.error ? <span className="error">⚠ {r.error}</span> : r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="btn primary" onClick={apply} disabled={!rows.some((r) => !r.error)}>
            Import {rows.filter((r) => !r.error).length} item(s)
          </button>
        </>
      )}
      {msg && <p role="status" className="small">{msg}</p>}
    </Details>
  );
}
