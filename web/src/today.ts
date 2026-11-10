import { courseCode, type Data, type Task } from "./store";

export type NextClass = {
  code: string;
  title: string;
  kind: string;
  location: string;
  start: Date;
  end: Date;
  inProgress: boolean;
};

const LOOKAHEAD_DAYS = 14;

function at(day: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  // Local wall-clock time, so daylight-saving changes are handled by the browser.
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
}

/** JS getDay(): Sunday = 0. Ours: Monday = 0. */
function weekdayMon0(d: Date): number {
  return (d.getDay() + 6) % 7;
}

export function nextClass(data: Data, now: Date): NextClass | null {
  let best: NextClass | null = null;
  for (let offset = -1; offset <= LOOKAHEAD_DAYS; offset++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    for (const m of data.meetings) {
      if (m.weekday !== weekdayMon0(day)) continue;
      const start = at(day, m.start);
      const end = at(day, m.end);
      if (end <= now) continue;
      if (!best || start < best.start) {
        const c = data.courses.find((x) => x.id === m.courseId);
        best = { code: c?.code ?? "?", title: c?.title ?? "", kind: m.kind, location: m.location, start, end, inProgress: start <= now };
      }
    }
  }
  return best;
}

export function openTasksSorted(data: Data): Task[] {
  return data.tasks
    .filter((t) => !t.done)
    .sort((a, b) => {
      if (a.due && b.due) return a.due.localeCompare(b.due);
      if (a.due) return -1;
      if (b.due) return 1;
      return a.title.localeCompare(b.title);
    });
}

export function nextTask(data: Data, now: Date): { task: Task | null; overdue: number } {
  const open = openTasksSorted(data);
  const overdue = open.filter((t) => t.due && new Date(t.due) < now).length;
  const task = open.find((t) => t.due && new Date(t.due) >= now) ?? open.find((t) => !t.due) ?? null;
  return { task, overdue };
}

export function taskCourse(data: Data, t: Task): string {
  return courseCode(data, t.courseId) ?? "No course";
}
