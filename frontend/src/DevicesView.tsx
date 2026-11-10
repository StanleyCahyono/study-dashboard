import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Device } from "./api";

export function DevicesView({ onAuthLost }: { onAuthLost: () => void }) {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDevices((await api.devices()).devices);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onAuthLost();
      else setError("Couldn’t load devices.");
    }
  }, [onAuthLost]);

  useEffect(() => {
    load();
  }, [load]);

  async function revoke(d: Device) {
    if (!window.confirm(`Sign out “${d.device_label}”?`)) return;
    try {
      await api.revoke(d.session_id);
      if (d.current) onAuthLost();
      else load();
    } catch {
      setError("Couldn’t sign that device out.");
    }
  }

  return (
    <main className="page" aria-labelledby="devices-title">
      <h1 id="devices-title">Signed-in devices</h1>
      <p className="muted">Sign out anything you don’t recognise. If you lose a device, sign it out here or run <code>studyctl sessions revoke-all</code> on the host.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <ul className="list">
        {devices?.map((d) => (
          <li key={d.session_id} className="card row">
            <div>
              <p className="big">
                {d.device_label} {d.current && <span className="pill">This device</span>}
              </p>
              <p className="muted small">
                Last active {new Date(d.last_seen_at).toLocaleString()} · signed in {new Date(d.created_at).toLocaleDateString()}
              </p>
            </div>
            <button className="btn danger" onClick={() => revoke(d)} aria-label={`Sign out ${d.device_label}`}>
              Sign out
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
