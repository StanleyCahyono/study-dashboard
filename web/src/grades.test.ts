import { describe, expect, it } from "vitest";
import { courseGrade, finalIf, itemWeight, neededOnRemaining, parseGradeCsv, coursePressure, scenarios } from "./grades";
import { newCourse, type GradeItem } from "./store";

const item = (p: Partial<GradeItem> & { id: string; courseId: string }): GradeItem => ({
  groupId: null,
  name: p.id,
  possible: 100,
  score: null,
  status: "pending",
  extraCredit: false,
  gradedAt: null,
  ...p,
});

describe("prompt 8 fixture: individually weighted 30% prelim at 80%, 70% final remaining", () => {
  const c = newCourse("AEM 1101");
  c.grading = { mode: "weighted", rulesConfirmed: true, ruleSource: "", groups: [{ id: "p", name: "Prelim", weight: 30, dropLowest: 0 }, { id: "f", name: "Final", weight: 70, dropLowest: 0 }] };
  const items = [item({ id: "prelim", courseId: c.id, groupId: "p", score: 80, status: "graded" }), item({ id: "final", courseId: c.id, groupId: "f" })];
  const g = courseGrade(c, items);

  it("secures 24 course points with 80% standing", () => {
    expect(g.secured).toBe(24);
    expect(g.standing).toBe(80);
    expect(g.remainingWeight).toBe(70);
  });
  it("needs 94.29% on the final to reach 90%", () => {
    expect(neededOnRemaining(g, 90)).toEqual({ kind: "needed", percent: 94.29 });
    expect(finalIf(g, 94.29)).toBeCloseTo(90, 1);
  });
  it("reports infeasible targets", () => {
    expect(neededOnRemaining(g, 99).kind).toBe("impossible");
  });
});

describe("prelim inside a larger points-based group never gets the whole group weight", () => {
  const c = newCourse("AEM 2200");
  c.grading = { mode: "weighted", rulesConfirmed: true, ruleSource: "", groups: [{ id: "e", name: "Exams", weight: 40, dropLowest: 0 }, { id: "o", name: "Other", weight: 60, dropLowest: 0 }] };
  const items = [
    item({ id: "p1", courseId: c.id, groupId: "e", score: 80, status: "graded" }),
    item({ id: "p2", courseId: c.id, groupId: "e" }),
    item({ id: "hw", courseId: c.id, groupId: "o" }),
  ];
  it("counts the graded prelim as 20% of the course, not 40%", () => {
    const g = courseGrade(c, items);
    expect(g.secured).toBe(16);
    expect(g.standing).toBe(80);
    expect(g.remainingWeight).toBe(80);
    expect(itemWeight(c, items, "p1")).toBe(20);
  });
});

describe("status rules", () => {
  const c = newCourse("ECON 1120");
  c.grading = { mode: "points", rulesConfirmed: true, ruleSource: "", groups: [] };
  it("excused zero is removed; posted zero counts", () => {
    const excused = courseGrade(c, [item({ id: "a", courseId: c.id, score: 90, status: "graded" }), item({ id: "b", courseId: c.id, status: "excused" })]);
    const missing = courseGrade(c, [item({ id: "a", courseId: c.id, score: 90, status: "graded" }), item({ id: "b", courseId: c.id, status: "missing" })]);
    expect(excused.standing).toBe(90);
    expect(missing.standing).toBe(45);
  });
  it("unequal point totals weight by points", () => {
    const g = courseGrade(c, [item({ id: "small", courseId: c.id, possible: 10, score: 10, status: "graded" }), item({ id: "big", courseId: c.id, possible: 90, score: 45, status: "graded" })]);
    expect(g.standing).toBe(55);
  });
  it("a hidden (pending) future grade stays in the remaining weight", () => {
    const g = courseGrade(c, [item({ id: "a", courseId: c.id, score: 80, status: "graded" }), item({ id: "hidden", courseId: c.id })]);
    expect(g.secured).toBe(40);
    expect(g.remainingWeight).toBe(50);
  });
  it("drops the lowest graded score in a group", () => {
    const d = newCourse("D 1000");
    d.grading = { mode: "weighted", rulesConfirmed: true, ruleSource: "", groups: [{ id: "q", name: "Quizzes", weight: 100, dropLowest: 1 }] };
    const g = courseGrade(d, [
      item({ id: "q1", courseId: d.id, groupId: "q", possible: 10, score: 10, status: "graded" }),
      item({ id: "q2", courseId: d.id, groupId: "q", possible: 10, score: 2, status: "graded" }),
      item({ id: "q3", courseId: d.id, groupId: "q", possible: 10, score: 8, status: "graded" }),
    ]);
    expect(g.groups[0].dropped).toEqual(["q2"]);
    expect(g.standing).toBe(90);
  });
  it("extra credit adds points but not possible points", () => {
    const g = courseGrade(c, [item({ id: "a", courseId: c.id, score: 80, status: "graded" }), item({ id: "ec", courseId: c.id, possible: 5, score: 5, status: "graded", extraCredit: true })]);
    expect(g.standing).toBe(85);
  });
});

describe("unknown rules and scenarios", () => {
  it("warns about unknown weights and unconfirmed rules", () => {
    const c = newCourse("X 1000");
    c.grading.groups = [{ id: "a", name: "Exams", weight: null, dropLowest: 0 }];
    const g = courseGrade(c, []);
    expect(g.warnings.join(" ")).toMatch(/unknown/);
    expect(g.warnings.join(" ")).toMatch(/not confirmed/);
  });
  it("one quiz grade gives scenarios with a low-evidence label", () => {
    const c = newCourse("Y 1000");
    c.grading = { mode: "points", rulesConfirmed: true, ruleSource: "", groups: [] };
    const g = courseGrade(c, [item({ id: "quiz", courseId: c.id, possible: 10, score: 7, status: "graded" }), item({ id: "rest", courseId: c.id, possible: 90 })]);
    const s = scenarios(g);
    expect(s.basis).toMatch(/Not a prediction/);
    expect(s.items).toHaveLength(3);
  });
  it("course pressure ranks the course that needs more on more remaining weight higher", () => {
    const a = newCourse("AEM 1101");
    a.target = 90;
    a.grading = { mode: "weighted", rulesConfirmed: true, ruleSource: "", groups: [{ id: "p", name: "P", weight: 30, dropLowest: 0 }, { id: "f", name: "F", weight: 70, dropLowest: 0 }] };
    const b = newCourse("AEM 2200");
    b.target = 80;
    b.grading = { mode: "weighted", rulesConfirmed: true, ruleSource: "", groups: [{ id: "p", name: "P", weight: 70, dropLowest: 0 }, { id: "f", name: "F", weight: 30, dropLowest: 0 }] };
    const ga = courseGrade(a, [item({ id: "1", courseId: a.id, groupId: "p", score: 80, status: "graded" }), item({ id: "2", courseId: a.id, groupId: "f" })]);
    const gb = courseGrade(b, [item({ id: "3", courseId: b.id, groupId: "p", score: 85, status: "graded" }), item({ id: "4", courseId: b.id, groupId: "f" })]);
    expect(coursePressure(a, ga).score).toBeGreaterThan(coursePressure(b, gb).score);
  });
});

describe("CSV import preview", () => {
  it("maps headers and flags bad rows", () => {
    const rows = parseGradeCsv("name,score,possible,group\nQuiz 1,8,10,Quizzes\nQuiz 2,,10,Quizzes\nBad,abc,10,\nNo points,5,,");
    expect(rows[0]).toMatchObject({ name: "Quiz 1", score: 8, possible: 10, group: "Quizzes", status: "graded" });
    expect(rows[1]).toMatchObject({ status: "pending", score: null });
    expect(rows[2].error).toMatch(/number/);
    expect(rows[3].error).toMatch(/possible/);
  });
});
