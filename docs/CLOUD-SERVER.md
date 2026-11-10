# Always-on server on Google Cloud's free tier

The app runs on a small free Linux server, so it works while your PC is off.
It is still private: the server has **no open ports for the app**. Only your
own devices reach it, through Tailscale, and you still sign in with your
passphrase.

**Cost:** $0 if you stay inside the free tier (one `e2-micro` server in
`us-east1`, `us-central1` or `us-west1`, with a 30 GB *standard* disk). Google
requires a card on file. Step 1 sets a $1 budget alert so a mistake can't
quietly cost money. Check the current free-tier terms when you sign up.

**Privacy tradeoff (your choice, 2026-11-10):** your study data is stored on
Google's disks. Google encrypts those disks, but with keys Google manages.

Time: about 45 minutes. Commands marked **(server)** are typed into the
server's terminal window from step 3.

---

## 1. Google Cloud account and a $1 alert

1. Open https://console.cloud.google.com/ and sign in with a Google account.
2. Accept the terms and set up billing with your card when asked. (You may be
   offered free trial credit. The free tier continues after it ends.)
3. Menu ☰ → **Billing** → **Budgets & alerts** → **Create budget**: amount
   **$1**, keep the email alerts at 50%, 90%, 100%. Save.

## 2. Create the server

Menu ☰ → **Compute Engine** → **VM instances**. Click **Enable** if asked, then
**Create instance**:

| Setting | Choose |
|---|---|
| Name | something neutral, e.g. `node-3` |
| Region | **us-east1** (or us-central1 / us-west1; other regions are **not** free) |
| Machine type | **E2** → **e2-micro** |
| Boot disk → Change | **Debian GNU/Linux 12**, disk type **Standard persistent disk**, size **30 GB** |
| Firewall | leave **Allow HTTP** and **Allow HTTPS** **unticked** |
| Backups / snapshots | none (they cost money) |

The default disk type ("Balanced") is **not** free. Change it to **Standard**.
If the cost estimate on the right isn't about $0 after free-tier credit, stop
and check the region, machine type and disk.

Click **Create** and wait for the green check.

## 3. Open the server's terminal

On the VM instances page, click **SSH** next to your server. A terminal opens
in a browser window. This is where the **(server)** commands go. Paste with
**Ctrl+Shift+V**, or right-click → Paste.

## 4. Join your Tailscale network

**(server)**

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

```bash
sudo tailscale up
```

It prints a login link. Open it on your PC and approve the new machine with
the same Tailscale account. Then, in the Tailscale admin console → **Machines**,
rename the new server to something neutral (for example `node-3`) and note its
**100.x.y.z** address.

## 5. Download the app (read-only key, this repository only)

**(server)** Install Git (the server image doesn't include it):

```bash
sudo apt-get update && sudo apt-get install -y git
```

Create a key the server will use to read the code:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/studydash_deploy -N "" -C "study server"
```

```bash
cat ~/.ssh/studydash_deploy.pub
```

Copy the line it prints. On your PC, open your repository on GitHub →
**Settings** → **Deploy keys** → **Add deploy key**. Title `cloud server`,
paste the key, leave **Allow write access unticked**, then click **Add key**.

**(server)**

```bash
printf 'Host github.com\n  IdentityFile ~/.ssh/studydash_deploy\n  IdentitiesOnly yes\n' >> ~/.ssh/config
```

```bash
git clone git@github.com:<your-github-user>/study-dashboard.git && cd study-dashboard
```

Type `yes` if it asks whether to trust github.com.

## 6. Install

**(server)**

```bash
bash scripts/server-setup.sh
```

This takes 5–15 minutes on the small server. It ends with **Setup complete**,
or stops with **SETUP STOPPED** and the error. The health check should show
`[PASS] Disk encryption: Google Compute Engine persistent disk: encrypted at
rest by the provider` and `[PASS] Key store reachable (file)`.

## 7. Share it privately over Tailscale

**(server)**

```bash
sudo tailscale serve --bg 8765
```

```bash
sudo tailscale serve status
```

It must say **(tailnet only)**. Then tell the app its name. Use the full name
shown by `serve status`, without `https://`:

```bash
uv run studyctl config add-host node-3.<your-tailnet>.ts.net
```

## 8. Enroll and start

**(server)**

```bash
uv run studyctl enroll
```

```bash
sudo systemctl start studydash
```

On your PC or phone (with Tailscale on), open
`https://node-3.<your-tailnet>.ts.net`, enter the code and your passphrase.
Leave **Keep a locked copy on this device** ticked on your phone.

## 9. Point the access policy at the new server

Tailscale admin console → **Access controls** → JSON editor. Change the address
in `"study-host"` to the **server's** 100.x.y.z address and save:

```json
{
  "hosts": {
    "study-host": "100.x.y.z"
  },
  "grants": [
    { "src": ["autogroup:member"], "dst": ["study-host"], "ip": ["tcp:443"] }
  ],
  "ssh": []
}
```

## 10. Retire the PC copy

On the **PC**, in PowerShell inside `study-dashboard`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-autostart.ps1 -Remove
```

```powershell
Stop-ScheduledTask -TaskName StudyDashboard -ErrorAction SilentlyContinue
```

```powershell
tailscale serve reset
```

The PC's own data held only your enrollment. Delete it:

```powershell
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\StudyDashboard"
```

Keep Tailscale on the PC so you can use the app from its browser.

## Everyday commands (server)

| What | Command |
|---|---|
| Is it running? | `systemctl status studydash` |
| Recent log | `journalctl -u studydash -n 50` |
| Restart | `sudo systemctl restart studydash` |
| Update to latest code | `bash scripts/server-update.sh` |
| Signed-in devices | `uv run studyctl sessions list` |
| Locked out | `uv run studyctl enroll --reset` |
| Encrypted backup | `uv run studyctl backup create` |
| Recovery key (store on paper) | `uv run studyctl backup recovery-key` |

To copy a backup to your PC: in the SSH window, click the gear/⚙ menu →
**Download file** and enter the path printed by `backup create`.

## What is and isn't exposed

- The app listens on `127.0.0.1` on the server. Google's firewall has no rule
  for it, and none is needed: Tailscale connects outward.
- Google's default rule allows SSH (port 22) with key-only login. That is how
  the browser **SSH** button works. Don't add password login.
- Google can technically access data on its disks; that's the tradeoff of
  cloud hosting. The phone's saved copy is encrypted with your passphrase.
