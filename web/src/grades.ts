// Deterministic gradebook. All numbers are percentages of the final course grade
// (0–100) unless named otherwise.
//
// Weighted mode: each group has a weight (percent of the course). Inside a group
// items count by points. A group's weight is never given to one item unless the
// item is the group's only item.
// Points mode: the course grade is total points earned / total points possible.
//
// Status rules:
//   graded   → counts with its score
//   missing  → a posted zero: counts as 0
//   excused  → removed from every total (neither earned nor possible)
//   pending  → not graded yet: part of the remaining weight
//   projected→ your own estimate ("tentative"): treated as pending for official
//              numbers, and as graded for projected numbers
// Extra credit adds earned points without adding possible points. An
// extra-credit GROUP (e.g. "+1% extra credit") adds its weighted score on top
// and is not part of the 100%.
// Alternative schemes ("better of two"): each scheme re-weights the groups;
// the scheme with the higher projected total is used.
// "Drop lowest N" applies within a group among graded items (by percent).

import type { Course, Cutoff, GradeItem } from "./store";

export type GroupResult = {
  id: string | null;
  name: string;
  weight: number | null;
  earned: number;
  gradedPossible: number;
  totalPossible: number;
  dropped: string[];
  percent: number | null; // standing within the group on graded work
};

export type CourseGrade = {
  standing: number | null; // percent on graded work only
  secured: number; // course percentage points already earned
  remainingWeight: number; // course percentage points still to be graded
  gradedFraction: number; // share of the course that is graded (0–1)
  groups: GroupResult[];
  ruleCompleteness: number; // known weights / 100 (weighted mode)
  warnings: string[];
};

const r2 = (x: number) => Math.round(x * 100) / 100;

export type GradeOpts = { projected?: boolean; weights?: Record<string, number | null> };

function groupResult(items: GradeItem[], dropLowest: number, projected = false): Omit<GroupResult, "id" | "name" | "weight"> {
  const counted = items.filter((i) => i.status !== "excused");
  const graded = counted.filter((i) => ((i.status === "graded" || (projected && i.status === "projected")) && i.score != null) || i.status === "missing");
  const regular = graded.filter((i) => !i.extraCredit && i.possible > 0);
  const byPercent = [...regular].sort((a, b) => (a.status === "missing" ? 0 : a.score! / a.possible) - (b.status === "missing" ? 0 : b.score! / b.possible) || a.id.localeCompare(b.id));
  const dropped = byPercent.slice(0, Math.max(0, Math.min(dropLowest, regular.length - 1))).map((i) => i.id);
  const kept = counted.filter((i) => !dropped.includes(i.id));
  const earned = kept.filter((i) => graded.includes(i)).reduce((s, i) => s + (i.status === "missing" ? 0 : i.score ?? 0), 0);
  const gradedPossible = kept.filter((i) => graded.includes(i) && !i.extraCredit).reduce((s, i) => s + i.possible, 0);
  const totalPossible = kept.filter((i) => !i.extraCredit).reduce((s, i) => s + i.possible, 0);
  return { earned, gradedPossible, totalPossible, dropped, percent: gradedPossible > 0 ? (earned / gradedPossible) * 100 : null };
}

export function courseGrade(course: Course, allItems: GradeItem[], opts: GradeOpts = {}): CourseGrade {
  const items = allItems.filter((i) => i.courseId === course.id);
  const warnings: string[] = [];
  if (!course.grading.rulesConfirmed) warnings.push("Grading rules not confirmed against the syllabus.");

  if (course.grading.mode === "points") {
    const g = groupResult(items, 0, opts.projected);
    const total = g.totalPossible;
    if (total === 0) return { standing: null, secured: 0, remainingWeight: 100, gradedFraction: 0, groups: [], ruleCompleteness: 1, warnings: [...warnings, "No graded items yet."] };
    return {
      standing: g.percent == null ? null : r2(g.percent),
      secured: r2((g.earned / total) * 100),
      remainingWeight: r2(((total - g.gradedPossible) / total) * 100),
      gradedFraction: g.gradedPossible / total,
      groups: [{ id: null, name: "All items", weight: 100, ...g }],
      ruleCompleteness: 1,
      warnings,
    };
  }

  const groups: GroupResult[] = [];
  let secured = 0;
  let remaining = 0;
  let standNum = 0;
  let standDen = 0;
  let known = 0;
  let bonus = 0;
  for (const grp of course.grading.groups) {
    const res = groupResult(
      items.filter((i) => i.groupId === grp.id),
      grp.dropLowest,
      opts.projected,
    );
    const weight = opts.weights && grp.id in opts.weights ? opts.weights[grp.id] : grp.weight;
    groups.push({ id: grp.id, name: grp.name, weight, ...res });
    if (weight == null) {
      warnings.push(`Weight of “${grp.name}” is unknown.`);
      continue;
    }
    if (grp.extraCredit) {
      if (res.totalPossible > 0) bonus += weight * (res.earned / res.totalPossible);
      continue;
    }
    known += weight;
    if (res.totalPossible === 0) {
      remaining += weight; // no items entered yet: all of it is still open
      continue;
    }
    secured += weight * (res.earned / res.totalPossible);
    remaining += weight * ((res.totalPossible - res.gradedPossible) / res.totalPossible);
    if (res.gradedPossible > 0) {
      standNum += weight * (res.earned / res.gradedPossible);
      standDen += weight;
    }
  }
  secured += bonus;
  const unassigned = items.filter((i) => !i.groupId || !course.grading.groups.some((g) => g.id === i.groupId));
  if (unassigned.length) warnings.push(`${unassigned.length} item(s) not in any group are ignored.`);
  if (course.grading.groups.length === 0) warnings.push("No grade groups set up.");
  else if (Math.abs(known - 100) > 0.01) warnings.push(`Known group weights add up to ${r2(known)}%, not 100%.`);
  return {
    standing: standDen > 0 ? r2(((standNum + bonus) / standDen) * 100) : null,
    secured: r2(secured),
    remainingWeight: r2(remaining),
    gradedFraction: known > 0 ? (known - remaining) / known : 0,
    groups,
    ruleCompleteness: Math.min(1, known / 100),
    warnings,
  };
}

export type Needed = { kind: "already" | "needed" | "impossible" | "final"; percent: number | null };

/** Average score needed on everything not yet graded to reach `target`. */
export function neededOnRemaining(g: CourseGrade, target: number): Needed {
  if (g.secured >= target) return { kind: "already", percent: 0 };
  if (g.remainingWeight <= 0) return { kind: "final", percent: null };
  const pct = ((target - g.secured) / g.remainingWeight) * 100;
  return { kind: pct > 100 ? "impossible" : "needed", percent: r2(pct) };
}

/** Final grade if the remaining work is scored at `pct` percent. */
export function finalIf(g: CourseGrade, pct: number): number {
  return r2(g.secured + (g.remainingWeight * pct) / 100);
}

/** Share of the course grade (percent) that one item is worth. Null if unknown. */
export function itemWeight(course: Course, allItems: GradeItem[], itemId: string): number | null {
  const items = allItems.filter((i) => i.courseId === course.id && i.status !== "excused" && !i.extraCredit);
  const item = items.find((i) => i.id === itemId);
  if (!item) return null;
  if (course.grading.mode === "points") {
    const total = items.reduce((s, i) => s + i.possible, 0);
    return total > 0 ? r2((item.possible / total) * 100) : null;
  }
  const grp = course.grading.groups.find((g) => g.id === item.groupId);
  if (!grp || grp.weight == null) return null;
  const groupTotal = items.filter((i) => i.groupId === grp.id).reduce((s, i) => s + i.possible, 0);
  return groupTotal > 0 ? r2((grp.weight * item.possible) / groupTotal) : null;
}

export type Scenario = { label: string; final: number };

/** Explicit scenarios instead of a prediction when evidence is thin. */
export function scenarios(g: CourseGrade): { basis: string; items: Scenario[] } {
  if (g.standing == null) {
    return { basis: "No graded work yet: scenarios only.", items: [70, 80, 90, 100].map((p) => ({ label: `If you average ${p}%`, final: finalIf(g, p) })) };
  }
  const s = g.standing;
  return {
    basis: "Scenarios around your current standing. Not a prediction; accuracy is unverified.",
    items: [
      { label: `Keep current standing (${s}%)`, final: finalIf(g, s) },
      { label: `10 points better (${Math.min(100, r2(s + 10))}%)`, final: finalIf(g, Math.min(100, s + 10)) },
      { label: `10 points worse (${Math.max(0, r2(s - 10))}%)`, final: finalIf(g, Math.max(0, s - 10)) },
    ],
  };
}

/**
 * How much a course needs attention: remaining weight, scaled up when the
 * target is hard to reach. Used to compare courses (e.g. AEM 1101 vs AEM 2200).
 */
export function coursePressure(course: Course, g: CourseGrade): { score: number; reason: string } {
  if (g.remainingWeight <= 0) return { score: 0, reason: "Fully graded." };
  if (course.target == null) return { score: g.remainingWeight, reason: `${g.remainingWeight}% of the grade is still open; no target set.` };
  const need = neededOnRemaining(g, course.target);
  if (need.kind === "already") return { score: g.remainingWeight * 0.3, reason: `Target ${course.target}% is already secured.` };
  const p = need.percent ?? 100;
  return {
    score: r2(g.remainingWeight * (p / 100) * (need.kind === "impossible" ? 1.5 : 1)),
    reason: `Needs ${p}% on the remaining ${g.remainingWeight}% to reach ${course.target}%${need.kind === "impossible" ? " (not reachable)" : ""}.`,
  };
}

/** Parse "name,score,possible[,group][,status]" CSV text for the preview screen. */
export type CsvRow = { name: string; score: number | null; possible: number; group: string; status: GradeItem["status"]; error?: string };
export function parseGradeCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const split = (l: string) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  const header = split(lines[0]).map((h) => h.toLowerCase());
  const hasHeader = header.includes("name") || header.includes("assignment");
  const idx = (names: string[], fallback: number) => {
    const i = header.findIndex((h) => names.includes(h));
    return hasHeader ? i : fallback;
  };
  const iName = idx(["name", "assignment", "item"], 0);
  const iScore = idx(["score", "points", "earned"], 1);
  const iPossible = idx(["possible", "out of", "max", "total"], 2);
  const iGroup = idx(["group", "category"], 3);
  const iStatus = idx(["status"], 4);
  return lines.slice(hasHeader ? 1 : 0).map((l) => {
    const c = split(l);
    const rawScore = iScore >= 0 ? c[iScore] ?? "" : "";
    const status = (iStatus >= 0 && c[iStatus] ? c[iStatus].toLowerCase() : "") as GradeItem["status"];
    const possible = Number(iPossible >= 0 ? c[iPossible] : NaN);
    const score = rawScore === "" || rawScore === "-" ? null : Number(rawScore);
    const row: CsvRow = {
      name: c[iName] ?? "",
      score: score != null && Number.isFinite(score) ? score : null,
      possible: Number.isFinite(possible) ? possible : 0,
      group: iGroup >= 0 ? c[iGroup] ?? "" : "",
      status: ["graded", "missing", "excused", "pending"].includes(status) ? status : score == null ? "pending" : "graded",
    };
    if (!row.name) row.error = "No name";
    else if (!(row.possible > 0)) row.error = "Points possible must be a number above 0";
    else if (rawScore !== "" && rawScore !== "-" && row.score == null) row.error = "Score isn’t a number";
    return row;
  });
}

// ---------------------------------------------------------------------------
// Letters, GPA, pass/fail, schemes and term GPA.

/** Cornell's 4.3 scale (A+ = 4.3). */
export const GPA_POINTS: Record<string, number> = {
  "A+": 4.3, A: 4.0, "A-": 3.7, "B+": 3.3, B: 3.0, "B-": 2.7, "C+": 2.3, C: 2.0, "C-": 1.7, "D+": 1.3, D: 1.0, "D-": 0.7, F: 0,
};
export const LETTERS = Object.keys(GPA_POINTS);

/** Used only when a course has no cutoffs entered; shown as "assumed". */
export const DEFAULT_CUTOFFS: Cutoff[] = [
  { letter: "A+", min: 97 }, { letter: "A", min: 93 }, { letter: "A-", min: 90 }, { letter: "B+", min: 87 }, { letter: "B", min: 83 }, { letter: "B-", min: 80 },
  { letter: "C+", min: 77 }, { letter: "C", min: 73 }, { letter: "C-", min: 70 }, { letter: "D+", min: 67 }, { letter: "D", min: 63 }, { letter: "D-", min: 60 }, { letter: "F", min: 0 },
];

export function letterFor(course: Course, pct: number | null): { letter: string | null; gpa: number | null; assumed: boolean } {
  if (pct == null) return { letter: null, gpa: null, assumed: false };
  const assumed = !course.cutoffs || course.cutoffs.length === 0;
  const cut = [...(assumed ? DEFAULT_CUTOFFS : course.cutoffs!)].sort((a, b) => b.min - a.min);
  const hit = cut.find((c) => pct >= c.min - 1e-9);
  const letter = hit?.letter ?? "F";
  return { letter, gpa: GPA_POINTS[letter] ?? null, assumed };
}

export type SchemeResult = { id: string; name: string; official: CourseGrade; projected: CourseGrade };

export type CourseSummary = {
  official: CourseGrade; // confirmed scores only
  projected: CourseGrade; // confirmed + your tentative scores
  scheme: SchemeResult | null; // the scheme in use when there are alternatives
  schemes: SchemeResult[];
  basis: "letter" | "pass_fail" | "final_letter";
  letter: string | null; // projected letter (or the final letter you entered)
  gpa: number | null;
  pass: boolean | null;
  assumedCutoffs: boolean;
  countsTowardGpa: boolean;
};

export function courseSummary(course: Course, items: GradeItem[]): CourseSummary {
  const schemes: SchemeResult[] = [
    { id: "main", name: course.grading.altSchemes.length ? "Scheme 1" : "Main", official: courseGrade(course, items), projected: courseGrade(course, items, { projected: true }) },
    ...course.grading.altSchemes.map((sc, i) => ({
      id: sc.id,
      name: sc.name || `Scheme ${i + 2}`,
      official: courseGrade(course, items, { weights: sc.weights }),
      projected: courseGrade(course, items, { projected: true, weights: sc.weights }),
    })),
  ];
  // "Better of": the scheme with the higher projected standing (ties: the first).
  const best = schemes.reduce((a, b) => ((b.projected.standing ?? -1) > (a.projected.standing ?? -1) ? b : a));
  if (course.finalLetter) {
    return {
      official: best.official, projected: best.projected, scheme: schemes.length > 1 ? best : null, schemes, basis: "final_letter",
      letter: course.finalLetter, gpa: GPA_POINTS[course.finalLetter] ?? null, pass: null, assumedCutoffs: false, countsTowardGpa: course.credits != null && course.finalLetter in GPA_POINTS,
    };
  }
  if (course.basis === "pass_fail") {
    const s = best.projected.standing;
    return {
      official: best.official, projected: best.projected, scheme: schemes.length > 1 ? best : null, schemes, basis: "pass_fail",
      letter: s == null ? null : s >= course.passThreshold ? "PASS" : "FAIL", gpa: null, pass: s == null ? null : s >= course.passThreshold, assumedCutoffs: false, countsTowardGpa: false,
    };
  }
  const l = letterFor(course, best.projected.standing);
  return {
    official: best.official, projected: best.projected, scheme: schemes.length > 1 ? best : null, schemes, basis: "letter",
    letter: l.letter, gpa: l.gpa, pass: null, assumedCutoffs: l.assumed, countsTowardGpa: course.credits != null && l.gpa != null,
  };
}

export type TermGpa = { gpa: number | null; credits: number; rows: { code: string; credits: number | null; letter: string | null; gpa: number | null; counted: boolean; note: string }[] };

/** Credit-weighted GPA over letter-graded courses with credits; pass/fail courses don't count. */
export function termGpa(courses: Course[], items: GradeItem[]): TermGpa {
  let pts = 0;
  let credits = 0;
  const rows = courses.map((c) => {
    const s = courseSummary(c, items);
    const counted = s.countsTowardGpa;
    if (counted) {
      pts += s.gpa! * c.credits!;
      credits += c.credits!;
    }
    const note =
      s.basis === "pass_fail" ? "Pass/Fail: not in GPA" : c.credits == null ? "Add credits to include" : s.gpa == null ? "No grade yet" : s.basis === "final_letter" ? "Final letter entered" : s.assumedCutoffs ? "Cutoffs assumed" : "";
    return { code: c.code, credits: c.credits, letter: s.letter, gpa: s.gpa, counted, note };
  });
  return { gpa: credits > 0 ? Math.round((pts / credits) * 1000) / 1000 : null, credits, rows };
}
