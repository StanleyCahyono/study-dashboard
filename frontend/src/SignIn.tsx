import { useState, type FormEvent } from "react";
import { api, ApiError, NetworkError, setCsrf, type PublicStatus } from "./api";
import { createVault, wipeVault } from "./vault";

export function SignIn({ status, onSignedIn }: { status: PublicStatus; onSignedIn: () => void }) {
  const mode: "login" | "enroll" = status.enrolled ? "login" : "enroll";
  const [code, setCode] = useState("");
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [device, setDevice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [keepCopy, setKeepCopy] = useState(true);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "enroll" && pass !== pass2) {
      setError("The two passphrases don’t match.");
      return;
    }
    setBusy(true);
    try {
      const res = mode === "login" ? await api.login(pass, device) : await api.enroll(code, pass, device);
      setCsrf(res.csrf_token);
      try {
        if (keepCopy) await createVault(pass, res.snapshot_key, res.session_id, res.profile);
        else await wipeVault();
      } catch {
        /* offline copy is optional; sign-in still succeeds */
      }
      setPass("");
      setPass2("");
      onSignedIn();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.status === 429 ? `Too many attempts. Try again in ${Math.ceil((err.retryAfter ?? 60) / 60)} min.` : err.message);
      } else if (err instanceof NetworkError) {
        setError("Can’t reach your study computer.");
      } else throw err;
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page center">
      {status.profile === "demo" && (
        <div className="demo-banner" role="note">
          <strong>DEMO</strong> · synthetic data
        </div>
      )}
      <section className="card signin" aria-labelledby="signin-title">
        <h1 id="signin-title">{mode === "login" ? "Sign in" : "Enroll this app"}</h1>
        {mode === "enroll" && (
          <p className="muted">
            On the host computer run <code>studyctl enroll</code> to get a one-time code. It works once and expires in 10 minutes.
          </p>
        )}
        <form onSubmit={submit} noValidate>
          {mode === "enroll" && (
            <label>
              One-time code
              <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" autoCapitalize="off" spellCheck={false} required />
            </label>
          )}
          <label>
            Passphrase
            <input
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={12}
              required
            />
          </label>
          {mode === "enroll" && (
            <label>
              Repeat passphrase
              <input type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" minLength={12} required />
            </label>
          )}
          <label>
            Device name <span className="muted">(optional)</span>
            <input value={device} onChange={(e) => setDevice(e.target.value)} placeholder="e.g. My iPhone" maxLength={80} />
          </label>
          <label className="check">
            <input type="checkbox" checked={keepCopy} onChange={(e) => setKeepCopy(e.target.checked)} />
            <span>
              Keep a locked copy on this device
              <span className="muted small"> so I can see my latest plan when the server can’t be reached. Opens only with my passphrase; deleted when I sign out.</span>
            </span>
          </label>
          {error && (
            <p className="error" role="alert">
              <span aria-hidden="true">⚠ </span>
              {error}
            </p>
          )}
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "Working…" : mode === "login" ? "Sign in" : "Enroll"}
          </button>
        </form>
        {mode === "login" && (
          <p className="muted small">Locked out or lost a device? On the host run <code>studyctl enroll --reset</code>.</p>
        )}
      </section>
    </main>
  );
}
