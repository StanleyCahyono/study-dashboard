// "Add grades from file": merges a gradebook file into the app without touching
// tasks, notes, habits or other courses. Courses are matched by course code;
// a matched course's grading rules and graded items are replaced by the file's.
//
// File format (JSON):
// { "kind": "study-gradebook", "v": 1, "courses": [ {
//     "code": "ECON 1120", "title": "", "credits": 3,
//     "basis": "letter" | "pass_fail", "passThreshold": 60,
//     "cutoffs": [{ "letter": "A+", "min": 98 }, ...] | null,
//     "finalLetter": "A" | null,
//     "grading": { "mode": "weighted" | "points",
//                  "groups": [{ "key": "p1", "name": "Prelim 1", "weight": 15, "dropLowest": 0, "extraCredit": false }],
//                  "altSchemes": [{ "name": "Scheme 2", "weights": { "p1": 20 } }],
//                  "rulesConfirmed": false, "ruleSource": "" },
//     "items": [{ "name": "Prelim 1", "group": "p1", "possible": 100, "score": 89, "status": "graded" | "projected" | "pending" | "missing" | "excused" }]
// } ] }

import { newCourse, newId, type Course, type Cutoff, type Data, type GradeItem, type GradeStatus } from "./store";

type FileGroup = { key: string; name: string; weight: number | null; dropLowest?: number; extraCredit?: boolean };
type FileCourse = {
  code: string;
  title?: string;
  credits?: number | null;
  basis?: "letter" | "pass_fail";
  passThreshold?: number;
  cutoffs?: Cutoff[] | null;
  finalLetter?: string | null;
  grading?: { mode: "weighted" | "points"; groups?: FileGroup[]; altSchemes?: { name: string; weights: Record<string, number | null> }[]; rulesConfirmed?: boolean; ruleSource?: string };
  items?: { name: string; group?: string | null; possible: number; score: number | null; status?: GradeStatus; extraCredit?: boolean }[];
};
export type GradebookFile = { kind: "study-gradebook"; v: 1; courses: FileCourse[] };

const STATUSES: GradeStatus[] = ["pending", "graded", "projected", "missing", "excused"];

export function parseGradebook(x: unknown): GradebookFile {
  const f = x as GradebookFile;
  if (!f || f.kind !== "study-gradebook" || f.v !== 1 || !Array.isArray(f.courses)) throw new Error("This isn’t a gradebook file.");
  for (const c of f.courses) {
    if (typeof c.code !== "string" || !c.code.trim()) throw new Error("A course in the file has no code.");
    for (const i of c.items ?? []) {
      if (typeof i.name !== "string" || !(Number(i.possible) >= 0)) throw new Error(`An item in ${c.code} is missing a name or points possible.`);
      if (i.status && !STATUSES.includes(i.status)) throw new Error(`Unknown status “${i.status}” in ${c.code}.`);
    }
  }
  return f;
}

const norm = (code: string) => code.replace(/\s+/g, "").toUpperCase();

export function mergeGradebook(data: Data, file: GradebookFile): { data: Data; added: string[]; updated: string[]; items: number } {
  let courses = [...data.courses];
  let gradeItems = [...data.gradeItems];
  let tasks = data.tasks;
  const added: string[] = [];
  const updated: string[] = [];
  let itemCount = 0;

  for (const fc of file.courses) {
    const existing = courses.find((c) => norm(c.code) === norm(fc.code));
    const base: Course = existing ?? newCourse(fc.code.trim().toUpperCase(), fc.title ?? "");
    const keyToId = new Map<string, string>();
    const groups = (fc.grading?.groups ?? []).map((g) => {
      const id = newId();
      keyToId.set(g.key, id);
      return { id, name: g.name, weight: g.weight, dropLowest: g.dropLowest ?? 0, extraCredit: Boolean(g.extraCredit) };
    });
    const course: Course = {
      ...base,
      title: fc.title || base.title,
      credits: fc.credits ?? null,
      basis: fc.basis ?? "letter",
      passThreshold: fc.passThreshold ?? 60,
      cutoffs: fc.cutoffs && fc.cutoffs.length ? fc.cutoffs.map((c) => ({ letter: c.letter, min: Number(c.min) })) : null,
      finalLetter: fc.finalLetter ?? null,
      grading: {
        mode: fc.grading?.mode ?? "points",
        groups,
        altSchemes: (fc.grading?.altSchemes ?? []).map((s) => ({
          id: newId(),
          name: s.name,
          weights: Object.fromEntries(Object.entries(s.weights).filter(([k]) => keyToId.has(k)).map(([k, w]) => [keyToId.get(k)!, w])),
        })),
        rulesConfirmed: Boolean(fc.grading?.rulesConfirmed),
        ruleSource: fc.grading?.ruleSource ?? "",
      },
      coverage: { ...base.coverage, grades: true },
    };
    const oldItems = gradeItems.filter((i) => i.courseId === course.id);
    const newItems: GradeItem[] = (fc.items ?? []).map((i) => ({
      id: newId(),
      courseId: course.id,
      groupId: i.group ? keyToId.get(i.group) ?? null : null,
      name: i.name,
      possible: Number(i.possible),
      score: i.score == null ? null : Number(i.score),
      status: i.status ?? (i.score == null ? "pending" : "graded"),
      extraCredit: Boolean(i.extraCredit),
      gradedAt: i.score == null ? null : new Date().toISOString(),
    }));
    // Keep task links to items that still exist (matched by name).
    const relink = new Map(oldItems.map((o) => [o.id, newItems.find((n) => n.name.toLowerCase() === o.name.toLowerCase())?.id ?? null]));
    tasks = tasks.map((t) => (t.gradeItemId && relink.has(t.gradeItemId) ? { ...t, gradeItemId: relink.get(t.gradeItemId)! } : t));
    gradeItems = [...gradeItems.filter((i) => i.courseId !== course.id), ...newItems];
    itemCount += newItems.length;
    if (existing) {
      courses = courses.map((c) => (c.id === course.id ? course : c));
      updated.push(course.code);
    } else {
      courses.push(course);
      added.push(course.code);
    }
  }
  return { data: { ...data, courses, gradeItems, tasks, demo: false }, added, updated, items: itemCount };
}
