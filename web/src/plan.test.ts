import { describe, expect, it } from "vitest";
import { buildPlan, lessTimeToday, prioritize, planToIcs } from "./plan";
import { emptyData, newCourse, newTask, type Data } from "./store";

// Monday 9 Nov 2026, 18:00 local time.
const NOW = new Date(2026, 10, 9, 18, 0);
const at = (d: number, h: number, m = 0) => new Date(2026, 10, 9 + d, h, m).toISOString();

/** Only one free 90-minute window this evening (19:00–20:30); everything else tonight is busy. */
function eveningData(): Data {
  const d = emptyData();
  d.settings = { ...d.settings, sleepStart: "23:00", sleepEnd: "07:00", bufferMinutes: 0, minBlock: 25, maxBlock: 90, device: "computer" };
  const econ = newCourse("ECON 1120");
  const aem = newCourse("AEM 2200");
  d.courses = [econ, aem];
  d.commitments = [
    { id: "c1", title: "Dinner", start: at(0, 18, 0), end: at(0, 19, 0), courseId: null, kind: "fixed", source: "manual" },
    { id: "c2", title: "Club", start: at(0, 20, 30), end: at(0, 23, 0), courseId: null, kind: "fixed", source: "manual" },
    { id: "c3", title: "Morning busy", start: at(1, 7, 0), end: at(1, 12, 0), courseId: null, kind: "fixed", source: "manual" },
  ];
  d.tasks = [
    newTask({ id: "A", title: "Review for ECON prelim", courseId: econ.id, due: at(1, 9, 0), estMinutes: 90 }),
    newTask({ id: "B", title: "Review for AEM prelim", courseId: aem.id, due: at(1, 10, 0), estMinutes: 90 }),
  ];
  return d;
}

describe("two prelims compete for one 90-minute evening block", () => {
  it("the earlier prelim wins; the other is reported short by 90 minutes", () => {
    const p = buildPlan(eveningData(), NOW);
    expect(p.next?.pt.task.id).toBe("A");
    expect(p.blocks).toHaveLength(1);
    expect(p.blocks[0]).toMatchObject({ taskId: "A", start: new Date(2026, 10, 9, 19, 0).getTime(), end: new Date(2026, 10, 9, 20, 30).getTime() });
    const b = p.tasks.find((t) => t.task.id === "B")!;
    expect(b.missing).toBe(90);
    expect(p.atRisk.map((t) => t.task.id)).toEqual(["B"]);
    expect(p.next!.reasons.join(" ")).toMatch(/Due/);
    expect(p.next!.changes.join(" ")).toMatch(/Review for AEM prelim/);
  });
  it("the assumption that reverses it: if AEM were due first, AEM wins", () => {
    const d = eveningData();
    d.tasks[1].due = at(1, 8, 0);
    expect(buildPlan(d, NOW).next?.pt.task.id).toBe("B");
  });
  it("prioritizing the other prelim shows the tradeoff", () => {
    const { plan, delta } = prioritize(eveningData(), NOW, "B");
    expect(plan.next?.pt.task.id).toBe("B");
    expect(delta).toEqual(expect.arrayContaining([{ title: "Review for ECON prelim", before: 0, after: 90 }]));
  });
  it("“30 fewer minutes” shows what slips", () => {
    const { delta } = lessTimeToday(eveningData(), NOW, 30);
    expect(delta.find((x) => x.title === "Review for ECON prelim")).toEqual({ title: "Review for ECON prelim", before: 0, after: 30 });
  });
  it("is deterministic", () => {
    const d = eveningData();
    expect(JSON.stringify(buildPlan(d, NOW).blocks)).toBe(JSON.stringify(buildPlan(d, NOW).blocks));
  });
});

describe("extensions and group handoffs", () => {
  it("an individual extension moves the task later", () => {
    const d = eveningData();
    d.tasks[0].due = at(3, 9, 0); // extension for A
    const p = buildPlan(d, NOW);
    expect(p.next?.pt.task.id).toBe("B");
  });
  it("a group handoff before the formal deadline makes that task earlier", () => {
    const d = eveningData();
    d.tasks[1].due = at(5, 12, 0);
    d.tasks[1].handoff = at(1, 8, 0); // hand to teammates before A's deadline
    const p = buildPlan(d, NOW);
    expect(p.next?.pt.task.id).toBe("B");
    expect(p.next!.reasons[0]).toMatch(/handoff/);
  });
  it("waits for a teammate’s handoff before scheduling dependent work", () => {
    const d = eveningData();
    d.tasks = [
      newTask({ id: "data", title: "Get dataset", assignee: "teammate", handoff: at(1, 13, 0) }),
      newTask({ id: "model", title: "Excel model", dependsOn: ["data"], due: at(3, 12, 0), estMinutes: 60 }),
    ];
    const p = buildPlan(d, NOW);
    const model = p.tasks.find((t) => t.task.id === "model")!;
    expect(model.waitingOn).toMatch(/teammate/);
    expect(p.blocks[0].start).toBeGreaterThanOrEqual(new Date(2026, 10, 10, 13, 0).getTime());
    expect(p.next).toBeNull();
  });
  it("a subtask inherits the deadline of what depends on it", () => {
    const d = eveningData();
    d.tasks = [
      newTask({ id: "memo", title: "Final memo", dependsOn: ["model"], due: at(1, 9, 0), estMinutes: 30 }),
      newTask({ id: "model", title: "Excel model", estMinutes: 60, needs: "computer" }),
    ];
    const p = buildPlan(d, NOW);
    expect(p.tasks.find((t) => t.task.id === "model")!.effectiveDue).toBe(new Date(2026, 10, 10, 9, 0).getTime());
    expect(p.blocks[0].taskId).toBe("model");
  });
});

describe("device, energy and unknowns", () => {
  it("on a phone, a computer-only task is not the next action", () => {
    const d = eveningData();
    d.settings.device = "phone";
    d.tasks[0].needs = "computer";
    expect(buildPlan(d, NOW).next?.pt.task.id).toBe("B");
  });
  it("unknown estimate and weight are assumed, not zero", () => {
    const d = eveningData();
    d.tasks = [newTask({ id: "x", title: "Unknown task", due: at(2, 12, 0) })];
    const p = buildPlan(d, NOW);
    expect(p.tasks[0].remaining).toBe(60);
    expect(p.next!.reasons.join(" ")).toMatch(/estimate unknown/);
    expect(p.next!.reasons.join(" ")).toMatch(/not zero/);
  });
  it("low energy prefers a light task when nothing is urgent", () => {
    const d = eveningData();
    d.tasks = [
      newTask({ id: "deep", title: "Hard proof", energy: "deep", due: at(5, 12, 0), estMinutes: 60 }),
      newTask({ id: "light", title: "Skim reading", energy: "light", due: at(6, 12, 0), estMinutes: 30 }),
    ];
    expect(buildPlan(d, NOW).next?.pt.task.id).toBe("deep");
    const p = buildPlan(d, NOW, { energy: "light" });
    expect(p.next?.pt.task.id).toBe("light");
    expect(p.next!.minutes).toBeLessThanOrEqual(25);
  });
  it("exports planned blocks as a calendar file", () => {
    const d = eveningData();
    const ics = planToIcs(d, buildPlan(d, NOW));
    expect(ics).toMatch(/BEGIN:VCALENDAR/);
    expect(ics).toMatch(/SUMMARY:Study: Review for ECON prelim/);
  });
});
