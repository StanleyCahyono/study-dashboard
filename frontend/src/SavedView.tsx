import { useState, type FormEvent } from "react";
import { TodayCards, TodayHeader, useNow } from "./TodayView";
import { unlockVault, wipeVault, WrongPassphrase, type Snapshot } from "./vault";
import { formatDay, formatTime, relative } from "./format";

/** Shown when the server can't be reached and this device has a saved copy. */
export function SavedView({ savedAt, onRetry, onDeleted }: { savedAt: string | null; onRetry: () => void; onDeleted: () => void }) {
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ snap: Snapshot; savedAt: string } | null>(null);
  const now = useNow();

  async function unlock(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await unlockVault(pass);
      setPass("");
      if (!res) setError("There’s no saved copy yet. It’s created the next time the app loads while connected.");
      else setOpened(res);
    } catch (err) {
      setError(err instanceof WrongPassphrase ? "Incorrect passphrase." : "The saved copy couldn’t be opened.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Delete the saved copy from this device?")) return;
    await wipeVault();
    onDeleted();
  }

  if (opened) {
    const tz = opened.snap.today.timezone;
    return (
      <div className="shell">
        <div className="saved-banner" role="note">
          <strong>Saved copy</strong> · not live · from {formatDay(opened.savedAt, tz)} {formatTime(opened.savedAt, tz)} ({relative(opened.savedAt, now)})
        </div>
        <main className="page" aria-labelledby="today-title">
          <TodayHeader now={now} tz={tz} />
          <p className="banner warn" role="status">
            <span aria-hidden="true">! </span>
            Your study server can’t be reached, so this is the last copy saved on this phone. New deadlines or changes since then are not shown.
          </p>
          <TodayCards data={opened.snap.today} now={now} tz={tz} fetchedAt={new Date(opened.savedAt)} />
          <div className="row actions">
            <button className="btn primary" onClick={onRetry}>Try to reconnect</button>
            <button className="btn" onClick={() => setOpened(null)}>Lock</button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <main className="page center">
      <section className="card signin" aria-labelledby="offline-title">
        <h1 id="offline-title">Can’t reach your study server</h1>
        <p>It may be down or offline, or Tailscale may be off on this device.</p>
        {savedAt && <p className="muted">A locked copy from {new Date(savedAt).toLocaleString()} is saved on this phone.</p>}
        <form onSubmit={unlock} noValidate>
          <label>
            Passphrase
            <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" required />
          </label>
          {error && (
            <p className="error" role="alert">
              <span aria-hidden="true">⚠ </span>
              {error}
            </p>
          )}
          <button className="btn primary" type="submit" disabled={busy || !pass}>
            {busy ? "Unlocking…" : "Open saved copy"}
          </button>
        </form>
        <div className="row actions">
          <button className="btn" onClick={onRetry}>Try again</button>
          <button className="btn danger" onClick={remove}>Delete saved copy</button>
        </div>
      </section>
    </main>
  );
}
