import { useCallback, useEffect, useState } from "react";
import { api, ApiError, NetworkError, setCsrf, type PublicStatus } from "./api";
import { SignIn } from "./SignIn";
import { TodayView, type SessionKeys } from "./TodayView";
import { DevicesView } from "./DevicesView";
import { SavedView } from "./SavedView";
import { vaultInfo, wipeVault } from "./vault";

type Phase =
  | { kind: "loading" }
  | { kind: "offline"; savedAt: string | null; hasCopy: boolean }
  | { kind: "signed-out"; status: PublicStatus }
  | { kind: "signed-in"; profile: "real" | "demo"; keys: SessionKeys };
type Tab = "today" | "devices";

export default function App() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [tab, setTab] = useState<Tab>("today");

  const boot = useCallback(async () => {
    try {
      const status = await api.publicStatus();
      try {
        const s = await api.session();
        setCsrf(s.csrf_token);
        const info = await vaultInfo();
        // A saved copy belongs to one profile; never show demo data as real or vice versa.
        if (info && info.profile !== status.profile) await wipeVault();
        setPhase({ kind: "signed-in", profile: status.profile, keys: { snapshotKey: s.snapshot_key, sessionId: s.session_id } });
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          // Signed out, expired or revoked: the saved copy goes too.
          await wipeVault();
          setCsrf(null);
          setPhase({ kind: "signed-out", status });
        } else throw e;
      }
    } catch (e) {
      if (e instanceof NetworkError || e instanceof ApiError) {
        const info = await vaultInfo();
        setPhase({ kind: "offline", savedAt: info?.savedAt ?? null, hasCopy: info !== null });
      } else throw e;
    }
  }, []);

  useEffect(() => {
    boot();
  }, [boot]);

  const onSignedOut = useCallback(() => {
    setCsrf(null);
    setTab("today");
    boot();
  }, [boot]);

  const retry = useCallback(() => {
    setPhase({ kind: "loading" });
    boot();
  }, [boot]);

  if (phase.kind === "loading") {
    return (
      <main className="page center" aria-busy="true">
        <p className="muted">Loading…</p>
      </main>
    );
  }
  if (phase.kind === "offline") {
    if (phase.hasCopy) {
      return <SavedView savedAt={phase.savedAt} onRetry={retry} onDeleted={retry} />;
    }
    return (
      <main className="page center">
        <section className="card" aria-labelledby="offline-title">
          <h1 id="offline-title">Can’t reach your study server</h1>
          <p>It may be down or offline, or Tailscale may be off on this device. There’s no saved copy on this device.</p>
          <button className="btn primary" onClick={retry}>Try again</button>
        </section>
      </main>
    );
  }
  if (phase.kind === "signed-out") {
    return <SignIn status={phase.status} onSignedIn={boot} />;
  }

  return (
    <div className="shell">
      {phase.profile === "demo" && (
        <div className="demo-banner" role="note">
          <strong>DEMO</strong> · synthetic data, not your real courses
        </div>
      )}
      {tab === "today" ? <TodayView onAuthLost={onSignedOut} keys={phase.keys} /> : <DevicesView onAuthLost={onSignedOut} />}
      <nav className="tabbar" aria-label="Main">
        <button className={tab === "today" ? "tab active" : "tab"} aria-current={tab === "today" ? "page" : undefined} onClick={() => setTab("today")}>
          Today
        </button>
        <button className={tab === "devices" ? "tab active" : "tab"} aria-current={tab === "devices" ? "page" : undefined} onClick={() => setTab("devices")}>
          Devices
        </button>
        <button
          className="tab"
          onClick={async () => {
            await wipeVault();
            try {
              await api.logout();
            } finally {
              onSignedOut();
            }
          }}
        >
          Sign out
        </button>
      </nav>
    </div>
  );
}
