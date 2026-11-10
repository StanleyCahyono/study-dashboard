# Owner-run physical tests

These need your real devices. They are **not** run by the automated tests and
must not be marked passed without your own observation. Record the date and
what you saw in `BUILD_STATUS.md`.

## T1. Cellular reachability (Tailscale off vs on)

Setup: host running `uv run studyctl serve`, `tailscale serve --bg 8765`
configured, `studyctl config add-host` done.

1. On the iPhone turn **Wi-Fi off** (cellular only).
2. **Tailscale off.** Open `https://<host>.<tailnet>.ts.net` in Safari.
   - Expected: no private data. You see either a browser "can't connect"
     error or, if the app was opened before, its cached offline screen
     ("Can't reach your study computer").
3. **Tailscale on.** Reload.
   - Expected: the **Sign in** page loads over HTTPS (padlock, no certificate warning).
4. Before signing in, open `https://<host>.<tailnet>.ts.net/api/today`.
   - Expected: `{"detail":"not_authenticated"}` (HTTP 401). No data.
5. Sign in with your passphrase.
   - Expected: Today shows **REAL** data (no DEMO banner); with no sources it
     says "No sources connected yet".
6. On the host run `uv run studyctl sessions list`.
   - Expected: the iPhone appears. Run `uv run studyctl sessions revoke <id>`
     for it; reload on the phone → back to **Sign in**.
7. Optional: from a second device that is **not** in your tailnet (or a
   friend's phone), try the URL → should not load.

Record: date, iOS version, results for steps 2–7.

## T2. Host restart

1. Restart Windows and sign in.
2. Without starting anything by hand, open the URL on the phone (Tailscale on).
   - Expected: Sign in page loads within a minute of signing in to Windows.

## T3. Layout on the phone

1. On the Today screen, the time ticks, no sideways scrolling, buttons are
   easy to tap with one thumb, text is readable with larger text size
   (Settings → Display → Text Size).

## T4. Works with the PC off (cloud server)

After following [CLOUD-SERVER.md](CLOUD-SERVER.md):

1. Shut down the PC completely.
2. On the iPhone (Tailscale on, cellular), open `https://<server>.<tailnet>.ts.net`.
   - Expected: the app loads live (no "Saved copy" banner) and shows Today.

## T5. Saved copy on the phone

1. Sign in on the iPhone with **Keep a locked copy on this device** ticked,
   and let Today load once.
2. Turn Tailscale **off** and reopen the app from the Home Screen.
   - Expected: "Can't reach your study server" with a passphrase box.
3. Type a wrong passphrase → "Incorrect passphrase". Type the right one →
   Today appears with the **Saved copy · not live** banner and its time.
4. Turn Tailscale on → **Try to reconnect** → live Today, no banner.
5. **Sign out**, turn Tailscale off, reopen.
   - Expected: "There's no saved copy on this device."
6. Sign in again (leave the box ticked) so the copy is back.
