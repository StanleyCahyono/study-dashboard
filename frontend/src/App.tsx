import { useCallback, useEffect, useState } from "react";
import { api, ApiError, NetworkError, setCsrf, type PublicStatus } from "./api";
import { SignIn } from "./SignIn";
import { TodayView } from "./TodayView";
import { DevicesView } from "./DevicesView";

type Phase = { kind: "loading" } | { kind: "offline" } | { kind: "signed-out"; status: PublicStatus } | { kind: "signed-in"; profile: "real" | "demo" };
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
        setPhase({ kind: "signed-in", profile: status.profile });
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          setCsrf(null);
          setPhase({ kind: "signed-out", status });
        } else throw e;
      }
    } catch (e) {
      if (e instanceof NetworkError || e instanceof ApiError) setPhase({ kind: "offline" });
      else throw e;
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

  if (phase.kind === "loading") {
    return (
      <main className="page center" aria-busy="true">
        <p className="muted">Loading…</p>
      </main>
    );
  }
  if (phase.kind === "offline") {
    return (
      <main className="page center">
        <section className="card" aria-labelledby="offline-title">
          <h1 id="offline-title">Can’t reach your study computer</h1>
          <p>It may be asleep or offline, or Tailscale may be off on this device. Private data is never stored on the phone, so nothing can be shown until the connection returns.</p>
          <button className="btn primary" onClick={() => { setPhase({ kind: "loading" }); boot(); }}>Try again</button>
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
      {tab === "today" ? <TodayView onAuthLost={onSignedOut} /> : <DevicesView onAuthLost={onSignedOut} />}
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
