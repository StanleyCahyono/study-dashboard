// Made-up example data so you can see how the app works.
import { newId, type Data } from "./store";

export function demoData(now = new Date()): Data {
  const ids = { a: newId(), b: newId(), c: newId() };
  const due = (days: number, h: number, m: number) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, h, m).toISOString();
  return {
    v: 1,
    demo: true,
    courses: [
      { id: ids.a, code: "AEM 1101", title: "[Demo] Intro to Business Ideas" },
      { id: ids.b, code: "AEM 2200", title: "[Demo] Business Management Practice" },
      { id: ids.c, code: "ECON 1120", title: "[Demo] Principles of Macro Thinking" },
    ],
    meetings: [
      ...[0, 2, 4].map((weekday) => ({ id: newId(), courseId: ids.a, kind: "lecture", weekday, start: "09:05", end: "09:55", location: "Demo Hall 101" })),
      ...[1, 3].map((weekday) => ({ id: newId(), courseId: ids.b, kind: "lecture", weekday, start: "11:40", end: "12:55", location: "Demo Hall 220" })),
      ...[0, 2].map((weekday) => ({ id: newId(), courseId: ids.c, kind: "lecture", weekday, start: "13:25", end: "14:15", location: "Demo Auditorium" })),
      { id: newId(), courseId: ids.c, kind: "section", weekday: 4, start: "14:30", end: "15:20", location: "Demo Room 12" },
    ],
    tasks: [
      { id: newId(), courseId: ids.a, title: "[Demo] Read chapter 4 and answer the review questions", due: due(1, 23, 59), allDay: false, estMinutes: 45, done: false, source: "demo" },
      { id: newId(), courseId: ids.c, title: "[Demo] Problem set 6: supply shocks", due: due(2, 17, 0), allDay: false, estMinutes: 120, done: false, source: "demo" },
      { id: newId(), courseId: ids.b, title: "[Demo] Team case outline", due: due(4, 12, 0), allDay: false, estMinutes: 90, done: false, source: "demo" },
      { id: newId(), courseId: ids.c, title: "[Demo] Review for Prelim 2", due: due(6, 19, 30), allDay: false, estMinutes: 180, done: false, source: "demo" },
    ],
  };
}
