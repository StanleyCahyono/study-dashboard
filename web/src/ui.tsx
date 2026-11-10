import { useEffect, useState, type ReactNode } from "react";

export const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

export const fmtTime = (t: number | string) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
export const fmtDay = (t: number | string) => new Date(t).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
export const fmtWhen = (t: number | string) => `${fmtDay(t)} ${fmtTime(t)}`;

export function mins(n: number | null | undefined): string {
  if (n == null) return "unknown";
  const r = Math.round(n);
  if (r < 60) return `${r} min`;
  return `${Math.floor(r / 60)} h${r % 60 ? ` ${r % 60} min` : ""}`;
}

export function rel(t: number | string, now: Date): string {
  const diff = Math.round((new Date(t).getTime() - now.getTime()) / 60000);
  const a = Math.abs(diff);
  const txt = a < 1 ? "now" : a < 60 ? `${a} min` : a < 48 * 60 ? `${Math.floor(a / 60)} h${a % 60 ? ` ${a % 60} min` : ""}` : `${Math.round(a / 1440)} days`;
  if (txt === "now") return "now";
  return diff >= 0 ? `in ${txt}` : `${txt} ago`;
}

export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromLocalInput(v: string): string | null {
  return v ? new Date(v).toISOString() : null;
}

export function Details({ summary, children, open = false }: { summary: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="details" open={open}>
      <summary>{summary}</summary>
      <div className="details-body">{children}</div>
    </details>
  );
}

export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} className={value === o.value ? "seg active" : "seg"} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function numOrNull(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
