export function formatTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date(iso));
}

export function formatDay(iso: string, tz: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: tz }).format(new Date(iso));
}

export function formatDateLong(date: Date, tz: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: tz }).format(date);
}

export function formatClock(date: Date, tz: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: tz }).format(date);
}

export function relative(iso: string, now: Date): string {
  const diffMin = Math.round((new Date(iso).getTime() - now.getTime()) / 60000);
  const abs = Math.abs(diffMin);
  let text: string;
  if (abs < 1) text = "now";
  else if (abs < 60) text = `${abs} min`;
  else if (abs < 60 * 48) text = `${Math.floor(abs / 60)} h ${abs % 60 ? `${abs % 60} min` : ""}`.trim();
  else text = `${Math.round(abs / 1440)} days`;
  if (text === "now") return "now";
  return diffMin >= 0 ? `in ${text}` : `${text} ago`;
}

export function minutes(n: number | null): string {
  if (n == null) return "estimate unknown";
  if (n < 60) return `about ${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `about ${h} h${m ? ` ${m} min` : ""}`;
}

export function sameDay(a: string, b: Date, tz: string): boolean {
  const f = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: tz });
  return f.format(new Date(a)) === f.format(b);
}
