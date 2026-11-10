import { useRef, useState, type ChangeEvent } from "react";
import { getData, replaceAll, useData, validate } from "./store";
import { importIcs } from "./ics";
import { demoData } from "./demo";

export function MoreView() {
  const data = useData();
  const [msg, setMsg] = useState<string | null>(null);
  const icsRef = useRef<HTMLInputElement>(null);
  const backupRef = useRef<HTMLInputElement>(null);

  async function onIcs(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const r = importIcs(getData(), await file.text());
      replaceAll({ ...r.data, demo: false });
      setMsg(
        `Imported ${file.name}: ${r.addedTasks} new tasks, ${r.updatedTasks} updated, ${r.addedMeetings} class times, ${r.addedCourses} new courses${r.skipped ? `, ${r.skipped} skipped` : ""}.`,
      );
    } catch {
      setMsg("That calendar file couldn’t be read.");
    }
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify(getData(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `study-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMsg("Backup downloaded. Keep it somewhere private: it contains your courses and tasks.");
  }

  async function onBackup(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const restored = validate(JSON.parse(await file.text()));
      if (!window.confirm("Replace everything on this device with this backup?")) return;
      replaceAll(restored);
      setMsg("Backup restored.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "That backup couldn’t be read.");
    }
  }

  function loadDemo() {
    if ((data.courses.length || data.tasks.length) && !window.confirm("Replace your data on this device with demo data?")) return;
    replaceAll(demoData());
    setMsg("Demo data loaded.");
  }

  function clearAll() {
    if (!window.confirm("Delete all courses, class times and tasks from this device? This can’t be undone.")) return;
    replaceAll({ v: 1, courses: [], meetings: [], tasks: [], demo: false });
    setMsg("Everything on this device was deleted.");
  }

  return (
    <main className="page" aria-labelledby="more-title">
      <h1 id="more-title">More</h1>
      {msg && (
        <p className="banner" role="status">
          {msg}
        </p>
      )}

      <section className="card" aria-labelledby="import-title">
        <h2 id="import-title">Import a calendar file (.ics)</h2>
        <p>
          For example your Canvas calendar: in Canvas open <strong>Calendar → Calendar Feed</strong>, download the file, then choose it here. Weekly repeating
          events become class times; other events become tasks. Importing the same file again updates instead of duplicating.
        </p>
        <input ref={icsRef} type="file" accept=".ics,text/calendar" hidden onChange={onIcs} aria-label="Calendar file" />
        <button className="btn primary" onClick={() => icsRef.current?.click()}>Choose .ics file</button>
      </section>

      <section className="card" aria-labelledby="backup-title">
        <h2 id="backup-title">Backup</h2>
        <p>Your data is only on this device. If you delete the app or clear Safari data, it’s gone. Export a backup now and then.</p>
        <div className="row actions">
          <button className="btn" onClick={exportBackup}>Export backup</button>
          <input ref={backupRef} type="file" accept="application/json,.json" hidden onChange={onBackup} aria-label="Backup file" />
          <button className="btn" onClick={() => backupRef.current?.click()}>Restore backup</button>
        </div>
      </section>

      <section className="card" aria-labelledby="privacy-title">
        <h2 id="privacy-title">Privacy</h2>
        <p>
          This website is public, but your courses and tasks are not: they’re saved in this browser on this device and never sent anywhere. The page blocks
          all network requests except loading its own files. Other people who open the site see their own empty app.
        </p>
      </section>

      <section className="card" aria-labelledby="demo-title">
        <h2 id="demo-title">Demo and reset</h2>
        <div className="row actions">
          <button className="btn" onClick={loadDemo}>Load demo data</button>
          <button className="btn danger" onClick={clearAll}>Delete all data</button>
        </div>
      </section>
    </main>
  );
}
