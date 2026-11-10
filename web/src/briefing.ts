// "Copy study briefing": a short text you can paste into any assistant.
// Built from an ALLOWLIST of fields; it never reads notes, email text, grades,
// evidence quotes, habits or screen-use data. Course names are replaced with
// "Course A/B/…" unless you choose to show them.

import type { Data } from "./store";
import type { Plan } from "./plan";

export type BriefingFields = {
  availableMinutes: boolean;
  nextBlocks: boolean;
  decision: boolean;
  unknowns: boolean;
  question: boolean;
  realCourseLabels: boolean;
};

export const DEFAULT_FIELDS: BriefingFields = { availableMinutes: true, nextBlocks: true, decision: true, unknowns: true, question: true, realCourseLabels: false };

export function buildBriefing(data: Data, plan: Plan, f: BriefingFields): string {
  const labels = new Map<string, string>();
  const label = (code: string) => {
    if (f.realCourseLabels) return code;
    if (!labels.has(code)) labels.set(code, `Course ${String.fromCharCode(65 + labels.size)}`);
    return labels.get(code)!;
  };
  const lines: string[] = ["Study briefing (shared by me, not a request to run anything):"];
  const freeNow = plan.free.find((x) => x.start <= plan.now && x.end > plan.now);
  const nextFixed = plan.busy.find((b) => b.start > plan.now && b.kind !== "sleep");
  if (f.availableMinutes) {
    const mins = freeNow ? Math.floor((freeNow.end - plan.now) / 60000) : 0;
    lines.push(mins > 0 ? `- I have about ${mins} minutes free${nextFixed ? ` before my next ${nextFixed.kind === "class" ? "class" : "commitment"}` : ""}.` : "- I'm not in a free window right now.");
  }
  const describe = (taskId: string) => {
    const pt = plan.tasks.find((t) => t.task.id === taskId);
    if (!pt) return "a task";
    const where = pt.task.needs === "any" ? "can be done on a phone" : pt.task.needs === "computer" ? "needs a computer" : "needs to be on campus";
    return `a ${pt.task.kind} for ${label(pt.course)} (about ${pt.remaining} min left, ${where})`;
  };
  if (f.nextBlocks) {
    const seen = new Set<string>();
    const next = plan.blocks.filter((b) => !seen.has(b.taskId) && seen.add(b.taskId)).slice(0, 2);
    next.forEach((b, i) => lines.push(`- Planned block ${i + 1}: ${describe(b.taskId)}, ${Math.round((b.end - b.start) / 60000)} min.`));
  }
  if (f.decision && plan.next && plan.alternatives[0]) {
    lines.push(`- Decision: Task A is ${describe(plan.next.pt.task.id)}; Task B is ${describe(plan.alternatives[0].task.id)}.`);
  }
  if (f.unknowns) {
    const unknownEst = plan.tasks.filter((t) => t.estimateUnknown).length;
    const risky = plan.atRisk.length;
    lines.push(`- Uncertainty: ${unknownEst} task(s) have no estimate; ${risky} deadline(s) look tight.`);
  }
  if (f.question) lines.push("- Please ask me where I am and how much energy I have, then help me choose.");
  void data;
  return lines.join("\n");
}
