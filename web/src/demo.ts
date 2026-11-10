// Made-up example data so you can see how the app works. Nothing here is real.
import { emptyData, newCourse, newId, newTask, type Data } from "./store";

export function demoData(now = new Date()): Data {
  const at = (days: number, h: number, m: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, h, m).toISOString();
  const a = newCourse("AEM 1101", "[Demo] Intro to Business Ideas");
  const b = newCourse("AEM 2200", "[Demo] Business Management Practice");
  const c = newCourse("ECON 1120", "[Demo] Principles of Macro Thinking");
  a.target = 90;
  b.target = 85;
  c.target = 88;
  const g = (name: string, weight: number) => ({ id: newId(), name, weight, dropLowest: 0 });
  const aG = [g("Prelim", 30), g("Final", 70)];
  a.grading = { mode: "weighted", groups: aG, rulesConfirmed: true, ruleSource: "[Demo] syllabus p.2" };
  const bG = [g("Exams", 40), { ...g("Quizzes", 20), dropLowest: 1 }, g("Team case", 40)];
  b.grading = { mode: "weighted", groups: bG, rulesConfirmed: false, ruleSource: "" };
  c.grading = { mode: "points", groups: [], rulesConfirmed: true, ruleSource: "[Demo] syllabus" };
  for (const x of [a, b, c]) x.coverage = { dueDates: true, meetings: true, grades: x !== b, syllabus: x === a };

  const prelim = { id: newId(), courseId: a.id, groupId: aG[0].id, name: "[Demo] Prelim", possible: 100, score: 80, status: "graded" as const, extraCredit: false, gradedAt: at(-10, 12, 0) };
  const final = { id: newId(), courseId: a.id, groupId: aG[1].id, name: "[Demo] Final exam", possible: 100, score: null, status: "pending" as const, extraCredit: false, gradedAt: null };
  const caseItem = { id: newId(), courseId: b.id, groupId: bG[2].id, name: "[Demo] Team case", possible: 100, score: null, status: "pending" as const, extraCredit: false, gradedAt: null };
  const ps6 = { id: newId(), courseId: c.id, groupId: null, name: "[Demo] Problem set 6", possible: 20, score: null, status: "pending" as const, extraCredit: false, gradedAt: null };

  const project = newTask({ title: "[Demo] Team case: final memo", courseId: b.id, kind: "project", due: at(5, 12, 0), estMinutes: 60, importance: 3, source: "demo", gradeItemId: caseItem.id });
  const dataset = newTask({ title: "[Demo] Team case: get dataset", courseId: b.id, parentId: project.id, assignee: "teammate", handoff: at(2, 18, 0), estMinutes: 60, source: "demo" });
  const model = newTask({ title: "[Demo] Team case: Excel model", courseId: b.id, parentId: project.id, dependsOn: [dataset.id], needs: "computer", energy: "deep", estMinutes: 120, estLow: 90, estHigh: 180, handoff: at(4, 12, 0), source: "demo" });
  project.dependsOn = [model.id];

  return {
    ...emptyData(),
    demo: true,
    courses: [a, b, c],
    meetings: [
      ...[0, 2, 4].map((weekday) => ({ id: newId(), courseId: a.id, kind: "lecture", weekday, start: "09:05", end: "09:55", location: "Demo Hall 101" })),
      ...[1, 3].map((weekday) => ({ id: newId(), courseId: b.id, kind: "lecture", weekday, start: "11:40", end: "12:55", location: "Demo Hall 220" })),
      ...[0, 2].map((weekday) => ({ id: newId(), courseId: c.id, kind: "lecture", weekday, start: "13:25", end: "14:15", location: "Demo Auditorium" })),
      { id: newId(), courseId: c.id, kind: "section", weekday: 4, start: "14:30", end: "15:20", location: "Demo Room 12" },
    ],
    commitments: [{ id: newId(), title: "[Demo] ECON 1120 Prelim 2", start: at(6, 19, 30), end: at(6, 21, 0), courseId: c.id, kind: "exam", source: "manual" }],
    gradeItems: [prelim, final, caseItem, ps6, { id: newId(), courseId: c.id, groupId: null, name: "[Demo] Problem set 5", possible: 20, score: 17, status: "graded", extraCredit: false, gradedAt: at(-3, 9, 0) }],
    tasks: [
      newTask({ title: "[Demo] Read chapter 4 and answer the review questions", courseId: a.id, kind: "reading", energy: "light", due: at(1, 23, 59), estMinutes: 45, source: "demo" }),
      newTask({ title: "[Demo] Problem set 6: supply shocks", courseId: c.id, kind: "problem set", due: at(2, 17, 0), estMinutes: 120, estLow: 90, estHigh: 150, source: "demo", gradeItemId: ps6.id }),
      newTask({ title: "[Demo] Review for Prelim 2", courseId: c.id, kind: "exam prep", energy: "deep", due: at(6, 19, 30), estMinutes: 180, importance: 3, source: "demo" }),
      newTask({ title: "[Demo] Study for the final", courseId: a.id, kind: "exam prep", due: null, estMinutes: 240, source: "demo", gradeItemId: final.id }),
      project,
      dataset,
      model,
    ],
    habits: [
      { id: newId(), name: "[Demo] Start the first planned block", weekdays: [0, 1, 2, 3, 4], target: 1, unit: "times", paused: false, log: {}, createdAt: at(-14, 9, 0) },
      { id: newId(), name: "[Demo] Practice questions", weekdays: [0, 2, 4, 6], target: 10, unit: "questions", paused: false, log: {}, createdAt: at(-14, 9, 0) },
    ],
    notes: [
      { id: newId(), courseId: c.id, title: "[Demo] Lecture 12: supply shocks", body: "Objective: explain how a supply shock moves output and prices.\n\nAD–AS: a negative supply shock shifts SRAS left → price level up, output down (stagflation).\n\nRecall: what happens to unemployment in the short run?", source: "[Demo] slides 4–9", updatedAt: at(-2, 10, 0) },
    ],
  };
}
