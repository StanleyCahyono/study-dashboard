// Synthetic gradebook shaped like a typical student tracker spreadsheet
// (points courses with custom cutoffs, a weighted pass/fail course, a course
// graded by the better of two schemes with +1% extra credit, and a course with
// only a final letter). All numbers are made up.
import { describe, expect, it } from "vitest";
import { mergeGradebook, parseGradebook, type GradebookFile } from "./gradebook";
import { courseSummary, letterFor, termGpa } from "./grades";
import { emptyData, newCourse, newTask } from "./store";

const FILE: GradebookFile = {
  kind: "study-gradebook",
  v: 1,
  courses: [
    {
      code: "TEST 2000",
      credits: 4,
      basis: "letter",
      // Point cutoffs out of 200, converted to percent.
      cutoffs: [
        { letter: "A+", min: 97.5 },
        { letter: "A", min: 92.5 },
        { letter: "A-", min: 90 },
        { letter: "B+", min: 86.5 },
        { letter: "B", min: 81.5 },
        { letter: "F", min: 0 },
      ],
      grading: { mode: "points", rulesConfirmed: false, ruleSource: "tracker" },
      items: [
        { name: "Quiz 1", possible: 50, score: 45, status: "graded" },
        { name: "Project", possible: 150, score: 140, status: "projected" },
      ],
    },
    {
      code: "TEST 1000",
      credits: 3,
      cutoffs: [
        { letter: "A", min: 94 },
        { letter: "B", min: 84 },
        { letter: "F", min: 0 },
      ],
      grading: { mode: "points" },
      items: [
        { name: "Essay", possible: 100, score: 85, status: "graded" },
        { name: "Final", possible: 100, score: null, status: "pending" },
      ],
    },
    {
      code: "MATH 9999",
      basis: "pass_fail",
      passThreshold: 60,
      grading: {
        mode: "weighted",
        groups: [
          { key: "q", name: "Quizzes", weight: 40 },
          { key: "f", name: "Final", weight: 60 },
        ],
      },
      items: [
        { name: "Quiz 1", group: "q", possible: 10, score: 9, status: "graded" },
        { name: "Quiz 2", group: "q", possible: 10, score: 7, status: "graded" },
        { name: "Final", group: "f", possible: 100, score: 50, status: "projected" },
      ],
    },
    {
      code: "ECON 9000",
      credits: 3,
      cutoffs: [
        { letter: "A", min: 93 },
        { letter: "B", min: 83 },
        { letter: "F", min: 0 },
      ],
      grading: {
        mode: "weighted",
        groups: [
          { key: "p1", name: "Prelim 1", weight: 20 },
          { key: "p2", name: "Prelim 2", weight: 40 },
          { key: "fin", name: "Final", weight: 40 },
          { key: "ec", name: "Extra credit", weight: 1, extraCredit: true },
        ],
        altSchemes: [{ name: "Scheme 2", weights: { p1: 30, p2: 30, fin: 40, ec: 1 } }],
      },
      items: [
        { name: "Prelim 1", group: "p1", possible: 100, score: 70, status: "graded" },
        { name: "Prelim 2", group: "p2", possible: 100, score: 95, status: "graded" },
        { name: "Final", group: "fin", possible: 100, score: 90, status: "projected" },
        { name: "Extra credit", group: "ec", possible: 100, score: 100, status: "graded" },
      ],
    },
    { code: "HIST 1234", credits: 2, finalLetter: "A-" },
  ],
};

describe("gradebook file", () => {
  const merged = mergeGradebook(emptyData(), parseGradebook(FILE)).data;
  const byCode = (code: string) => merged.courses.find((c) => c.code === code)!;
  const sum = (code: string) => courseSummary(byCode(code), merged.gradeItems);

  it("points course with converted point cutoffs, counting a tentative score in the projection only", () => {
    const s = sum("TEST 2000");
    expect(s.projected.standing).toBe(92.5); // 185 / 200
    expect(s.letter).toBe("A");
    expect(s.gpa).toBe(4);
    expect(s.official.standing).toBe(90); // confirmed quiz only
  });
  it("letter on entered work only (pending items don't count yet)", () => {
    const s = sum("TEST 1000");
    expect(s.projected.standing).toBe(85);
    expect(s.letter).toBe("B");
  });
  it("weighted pass/fail course", () => {
    const s = sum("MATH 9999");
    expect(s.projected.standing).toBe(62); // 0.4*80 + 0.6*50
    expect(s.letter).toBe("PASS");
    expect(s.countsTowardGpa).toBe(false);
  });
  it("better of two schemes, with +1% extra credit on top", () => {
    const s = sum("ECON 9000");
    // Scheme 1: 0.2*70 + 0.4*95 + 0.4*90 + 1 = 89; Scheme 2: 0.3*70 + 0.3*95 + 0.4*90 + 1 = 86.5
    expect(s.schemes.map((x) => x.projected.standing)).toEqual([89, 86.5]);
    expect(s.scheme?.name).toBe("Scheme 1");
    expect(s.letter).toBe("B");
  });
  it("credit-weighted term GPA skips pass/fail and uses a known final letter", () => {
    const t = termGpa(merged.courses, merged.gradeItems);
    // TEST 2000 A (4.0×4) + TEST 1000 B (3.0×3) + ECON 9000 B (3.0×3) + HIST 1234 A- (3.7×2) = 41.4 / 12
    expect(t.credits).toBe(12);
    expect(t.gpa).toBe(3.45);
    expect(t.rows.find((r) => r.code === "MATH 9999")!.note).toMatch(/Pass\/Fail/);
  });
  it("merging again updates in place, keeps other data and relinks tasks by item name", () => {
    const d = emptyData();
    const c = newCourse("TEST 1000");
    d.courses = [c];
    d.gradeItems = [{ id: "old", courseId: c.id, groupId: null, name: "Final", possible: 100, score: null, status: "pending", extraCredit: false, gradedAt: null }];
    d.tasks = [newTask({ title: "Study for final", courseId: c.id, gradeItemId: "old" })];
    const r = mergeGradebook(d, FILE);
    expect(r.updated).toEqual(["TEST 1000"]);
    expect(r.added).toHaveLength(4);
    expect(r.data.courses.filter((x) => x.code === "TEST 1000")).toHaveLength(1);
    const final = r.data.gradeItems.find((i) => i.courseId === c.id && i.name === "Final")!;
    expect(r.data.tasks[0].gradeItemId).toBe(final.id);
  });
  it("rejects files that aren't gradebooks", () => {
    expect(() => parseGradebook({ v: 3, courses: [] })).toThrow();
    expect(() => parseGradebook({ kind: "study-gradebook", v: 1, courses: [{ code: "X 1", items: [{ name: "a", possible: 10, score: 1, status: "weird" }] }] })).toThrow();
  });
});

describe("letters", () => {
  it("uses the default scale only when no cutoffs are entered, and says so", () => {
    const c = newCourse("Z 1");
    expect(letterFor(c, 91)).toEqual({ letter: "A-", gpa: 3.7, assumed: true });
    expect(letterFor(c, 72).gpa).toBe(1.7);
    expect(letterFor(c, 10).letter).toBe("F");
  });
});
