# Phone access with Tailscale (private network only)

The app listens on `127.0.0.1` only. Tailscale Serve gives it an HTTPS address
that only devices in **your** tailnet can reach. Nothing is opened to the
internet: no Funnel, no router port forwarding, no Windows firewall rule.

## 1. Accounts and devices **(you)**

1. Create or sign in to a **free Personal** Tailscale account at
   https://login.tailscale.com/ (check the current Personal plan limits).
2. On the Windows host: Tailscale is installed (setup step 1). Open it from the
   tray and sign in.
3. On the iPhone: install **Tailscale** from the App Store and sign in with the
   **same** account. Don't invite other users into this tailnet.

## 2. Give the host a neutral name

HTTPS certificate names appear in public Certificate Transparency logs. Don't
use your name, school or "study". In the admin console → **Machines** → the
host → **⋯ → Edit machine name**, choose something neutral, for example
`desk-7`. Your address becomes `https://desk-7.<tailnet-name>.ts.net`.

In admin console → **DNS**, make sure **MagicDNS** is on and **HTTPS
Certificates** is enabled.

## 3. Restrict the access policy

Admin console → **Access controls**. Replace the default allow-all policy with
one that lets only your own devices reach the host on port 443, and has no
Funnel attribute. Find the host's `100.x.y.z` address on the Machines page.

```json
{
  "hosts": {
    "study-host": "100.64.0.1"
  },
  "grants": [
    { "src": ["autogroup:member"], "dst": ["study-host"], "ip": ["tcp:443"] }
  ],
  "ssh": []
}
```

Replace `100.64.0.1` with the host's real Tailscale address. Remove any
`nodeAttrs` entry that grants `funnel`. If your plan offers **Device approval**
(Settings → Device management), turn it on so a new device can't join without
you. Keep **key expiry** on.

## 4. Serve the app inside the tailnet

On the host (PowerShell):

```powershell
tailscale serve --bg 8765
tailscale serve status
tailscale funnel status
```

`serve status` should show `https://desk-7.<tailnet>.ts.net` → `http://127.0.0.1:8765`
and say it is available **within your tailnet only**. `funnel status` must not
list anything. Never run `tailscale funnel`.

Tell the app its tailnet name (needed for its Host and Origin checks), then restart it:

```powershell
uv run studyctl config add-host desk-7.<tailnet-name>.ts.net
Stop-ScheduledTask -TaskName StudyDashboard; Start-ScheduledTask -TaskName StudyDashboard
```

To serve the demo as well, use another HTTPS port:
`tailscale serve --bg --https=8443 8766` and
`uv run studyctl config add-host desk-7.<tailnet-name>.ts.net --demo`. (The
demo then lives at `https://desk-7.<tailnet>.ts.net:8443`; add `tcp:8443` to the
grant if you use it.)

To stop serving: `tailscale serve reset`.

## 5. On the iPhone

1. Turn Tailscale on.
2. Open Safari at `https://desk-7.<tailnet-name>.ts.net`.
3. Sign in with your passphrase. Give the device a name such as "iPhone".
4. Share → **Add to Home Screen** to install it as an app.

Then run the cellular test in [OWNER-TESTS.md](OWNER-TESTS.md).

## What is not exposed

- The app binds to `127.0.0.1`; other devices on your Wi-Fi can't reach it.
- No inbound firewall rule or router port forward is needed or wanted.
- Funnel (public internet access) stays off.
- Even inside the tailnet, the app still requires your passphrase.
