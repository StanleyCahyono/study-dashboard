"""`studyctl`: host-side commands. Run these on the computer that hosts the app."""

from __future__ import annotations

import argparse
import base64
import getpass
import json
import shutil
import subprocess
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

from . import auth, backup, diskcheck
from .config import load_settings, save_settings
from .db import Database
from .keystore import (
    KeyStoreUnavailable,
    OSKeyStore,
    format_recovery_key,
    get_or_create_backup_key,
    parse_recovery_key,
)
from .paths import Profile, UnsafeDataLocation, profile_paths
from .timeutil import utcnow


def _profile(args) -> Profile:
    return Profile.DEMO if getattr(args, "demo", False) else Profile.REAL


def _fail(message: str, code: int = 2) -> int:
    print(f"ERROR: {message}", file=sys.stderr)
    return code


def _local(dt) -> str:
    return dt.astimezone().strftime("%Y-%m-%d %H:%M %Z")


# --- safety gates -----------------------------------------------------------

def disk_gate(paths, settings) -> tuple[bool, str]:
    status = diskcheck.detect(paths.dir)
    if status.state == "on":
        return True, status.detail
    if settings.disk_encryption_attestation:
        return True, f"{status.detail}; owner attestation on record: {settings.disk_encryption_attestation}"
    return False, status.detail


def preflight(profile: Profile) -> tuple[object, object] | None:
    paths = profile_paths(profile)
    try:
        paths.ensure()
    except UnsafeDataLocation as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return None
    settings = load_settings(paths)
    if profile is Profile.REAL:
        ok, detail = disk_gate(paths, settings)
        if not ok:
            print(
                "ERROR: Full-disk encryption could not be confirmed for the private data directory.\n"
                f"  {detail}\n"
                "  Turn on BitLocker / Device Encryption (Settings > Privacy & security > Device encryption),\n"
                "  or, if the drive is encrypted but detection fails, run `studyctl attest-disk-encryption`.",
                file=sys.stderr,
            )
            return None
        try:
            OSKeyStore(profile.value)
        except KeyStoreUnavailable as exc:
            print(f"ERROR: {exc}", file=sys.stderr)
            return None
    return paths, settings


# --- commands ---------------------------------------------------------------

def cmd_serve(args) -> int:
    import uvicorn

    from .app import FRONTEND_DIST, create_app

    profile = _profile(args)
    pre = preflight(profile)
    if pre is None:
        return 2
    paths, settings = pre
    port = args.port or settings.port
    if not (FRONTEND_DIST / "index.html").exists():
        return _fail("Frontend is not built. Run: npm --prefix frontend ci; npm --prefix frontend run build")
    app = create_app(profile, paths, port=port)
    banner = "DEMO profile (synthetic data)" if profile is Profile.DEMO else "REAL profile"
    print(f"Study Dashboard: {banner}")
    print(f"  Data:   {paths.dir}")
    print(f"  Listen: http://127.0.0.1:{port}  (loopback only; use Tailscale Serve for the phone)")
    # Loopback only. Proxy headers are ignored so no client can claim another address.
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=port,
        proxy_headers=False,
        server_header=False,
        date_header=True,
        log_level="info",
        access_log=False,
        workers=1,
    )
    return 0


def cmd_enroll(args) -> int:
    profile = _profile(args)
    pre = preflight(profile)
    if pre is None:
        return 2
    paths, settings = pre
    db = Database(paths)
    with db.session() as s:
        try:
            code, expires = auth.issue_bootstrap_code(s, utcnow, reset=args.reset)
        except auth.AuthError as exc:
            return _fail(exc.message)
    print("One-time enrollment code (single use, expires " + _local(expires) + "):\n")
    print(f"    {code}\n")
    print(f"Open http://127.0.0.1:{settings.port}/ on THIS computer, choose 'Enroll', enter the code,")
    print("and pick a passphrase of at least 12 characters. Do not paste this code into chats or notes.")
    if args.reset:
        print("All previous sessions were revoked. Your study data was kept.")
    return 0


def cmd_sessions(args) -> int:
    profile = _profile(args)
    paths = profile_paths(profile).ensure()
    db = Database(paths)
    with db.session() as s:
        if args.action == "list":
            rows = auth.active_sessions(s, utcnow)
            if not rows:
                print("No active sessions.")
            for r in rows:
                print(f"{r.public_id}  {r.device_label:<20}  last seen {_local(r.last_seen_at)}")
        elif args.action == "revoke":
            if not args.session_id:
                return _fail("Give a session id from `studyctl sessions list`.")
            ok = auth.revoke_session(s, utcnow, args.session_id, reason="revoked_on_host")
            print("Revoked." if ok else "No active session with that id.")
        elif args.action == "revoke-all":
            n = auth.revoke_all_sessions(s, utcnow, reason="revoked_all_on_host")
            print(f"Revoked {n} session(s).")
    return 0


def cmd_doctor(args) -> int:
    profile = _profile(args)
    paths = profile_paths(profile)
    problems = 0

    def report(ok: bool | None, label: str, detail: str = "") -> None:
        nonlocal problems
        mark = {True: "PASS", False: "FAIL", None: "INFO"}[ok]
        if ok is False:
            problems += 1
        print(f"[{mark}] {label}{': ' + detail if detail else ''}")

    try:
        paths.ensure()
        report(True, "Data directory outside any Git checkout", str(paths.dir))
    except UnsafeDataLocation as exc:
        report(False, "Data directory location", str(exc))
        return 1
    settings = load_settings(paths)
    if profile is Profile.REAL:
        ok, detail = disk_gate(paths, settings)
        report(ok, "Disk encryption", detail)
        try:
            OSKeyStore(profile.value)
            report(True, "OS key store reachable")
        except KeyStoreUnavailable as exc:
            report(False, "OS key store", str(exc))
    else:
        report(None, "Demo profile: disk encryption and key store checks skipped (synthetic data)")
    from .app import FRONTEND_DIST

    report((FRONTEND_DIST / "index.html").exists(), "Frontend built", str(FRONTEND_DIST))
    report(None, "Timezone", settings.timezone)
    report(None, "Tailnet host names", ", ".join(settings.tailnet_hostnames) or "(none yet)")
    if shutil.which("git"):
        rc = check_remote_visibility("origin", quiet=True)
        report(rc == 0 if rc != 3 else None, "Git remote 'origin' is private", {0: "verified PRIVATE", 3: "no origin remote configured"}.get(rc, "NOT verified - do not push"))
    return 1 if problems else 0


def cmd_attest(args) -> int:
    paths = profile_paths(Profile.REAL).ensure()
    settings = load_settings(paths)
    status = diskcheck.detect(paths.dir)
    print(f"Automatic check: {status.state} - {status.detail}")
    answer = input(f"Type 'encrypted' to confirm the drive holding {paths.dir} uses full-disk encryption: ")
    if answer.strip() != "encrypted":
        return _fail("Not confirmed; nothing changed.")
    settings.disk_encryption_attestation = f"owner attested {utcnow().isoformat()} (auto-check: {status.state})"
    save_settings(paths, settings)
    print("Attestation recorded in the profile config.")
    return 0


def cmd_config(args) -> int:
    profile = _profile(args)
    paths = profile_paths(profile).ensure()
    settings = load_settings(paths)
    if args.action == "show":
        print(json.dumps(settings.__dict__, indent=2))
        return 0
    if args.action == "set-timezone":
        ZoneInfo(args.value)
        settings.timezone = args.value
    elif args.action == "add-host":
        host = args.value.strip().lower().rstrip(".")
        if "://" in host or "/" in host:
            return _fail("Give a bare host name such as studyhost.example-tailnet.ts.net")
        if host not in settings.tailnet_hostnames:
            settings.tailnet_hostnames.append(host)
    elif args.action == "remove-host":
        settings.tailnet_hostnames = [h for h in settings.tailnet_hostnames if h != args.value]
    save_settings(paths, settings)
    print("Saved. Restart the app for changes to take effect.")
    return 0


def _backup_key(profile: Profile) -> bytes:
    return get_or_create_backup_key(OSKeyStore(profile.value))


def cmd_backup(args) -> int:
    profile = _profile(args)
    paths = profile_paths(profile).ensure()
    try:
        if args.action == "create":
            out = backup.create_backup(paths, _backup_key(profile), utcnow, Path(args.out) if args.out else None)
            print(f"Encrypted backup written: {out}")
        elif args.action == "recovery-key":
            print("Anyone with this key can decrypt your backups. Store it apart from the backups,")
            print("for example on paper. It is needed to restore on a different computer.\n")
            if input("Type 'show' to display it: ").strip() != "show":
                return _fail("Cancelled.")
            print("\n    " + format_recovery_key(_backup_key(profile)) + "\n")
        elif args.action == "restore":
            if not args.file:
                return _fail("Give the backup file path.")
            if args.recovery_key:
                key = parse_recovery_key(getpass.getpass("Recovery key: "))
                OSKeyStore(profile.value).set("backup-key-v1", base64.b64encode(key).decode())
            else:
                key = _backup_key(profile)
            backup.restore_backup(Path(args.file), key, paths)
            print(f"Restored into {paths.db}")
    except (backup.BackupError, KeyStoreUnavailable, ValueError) as exc:
        return _fail(str(exc))
    return 0


def github_slug(url: str) -> str | None:
    """Return OWNER/NAME for a github.com remote URL, else None."""
    import re

    m = re.match(r"^(?:https://(?:[^@/]+@)?github\.com/|git@github\.com:|ssh://git@github\.com/)([\w.-]+)/([\w.-]+?)(?:\.git)?/?$", url)
    return f"{m.group(1)}/{m.group(2)}" if m else None


def check_remote_visibility(remote: str, quiet: bool = False) -> int:
    """0 = verified private, 1 = public/unverifiable (fail closed), 3 = no such remote."""
    url = subprocess.run(["git", "remote", "get-url", remote], capture_output=True, text=True).stdout.strip()
    if not url:
        if not quiet:
            print(f"No '{remote}' remote is configured.")
        return 3
    slug = github_slug(url)

    def refuse(reason: str) -> int:
        if not quiet:
            print(f"Remote '{remote}' ({url}): {reason}. Refusing: it must be a verified PRIVATE GitHub repository.", file=sys.stderr)
        return 1

    if slug is None:
        return refuse("not a recognised github.com URL")
    if not shutil.which("gh"):
        return refuse("GitHub CLI (gh) is not installed, so visibility cannot be verified")
    result = subprocess.run(["gh", "api", f"repos/{slug}", "--jq", ".visibility"], capture_output=True, text=True)
    visibility = result.stdout.strip().lower()
    if result.returncode != 0:
        return refuse("visibility could not be verified (gh api failed)")
    if visibility != "private":
        return refuse(f"visibility is '{visibility or 'unknown'}'")
    if not quiet:
        print(f"Remote '{remote}' ({slug}) is PRIVATE.")
    return 0


def cmd_check_remote(args) -> int:
    rc = check_remote_visibility(args.remote)
    return 1 if rc == 3 else rc


def cmd_paths(args) -> int:
    for profile in Profile:
        p = profile_paths(profile)
        print(f"{profile.value:5} {p.dir}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="studyctl", description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    def with_demo(p):
        p.add_argument("--demo", action="store_true", help="use the synthetic demo profile")
        return p

    p = with_demo(sub.add_parser("serve", help="start the app on 127.0.0.1"))
    p.add_argument("--port", type=int)
    p.set_defaults(func=cmd_serve)

    p = with_demo(sub.add_parser("enroll", help="issue a one-time owner enrollment code"))
    p.add_argument("--reset", action="store_true", help="owner recovery: clear passphrase, revoke sessions")
    p.set_defaults(func=cmd_enroll)

    p = with_demo(sub.add_parser("sessions", help="list or revoke signed-in devices"))
    p.add_argument("action", choices=["list", "revoke", "revoke-all"])
    p.add_argument("session_id", nargs="?")
    p.set_defaults(func=cmd_sessions)

    p = with_demo(sub.add_parser("doctor", help="check privacy and deployment invariants"))
    p.set_defaults(func=cmd_doctor)

    p = sub.add_parser("attest-disk-encryption", help="record that the data drive is encrypted")
    p.set_defaults(func=cmd_attest)

    p = with_demo(sub.add_parser("config", help="show or change profile settings"))
    p.add_argument("action", choices=["show", "set-timezone", "add-host", "remove-host"])
    p.add_argument("value", nargs="?")
    p.set_defaults(func=cmd_config)

    p = with_demo(sub.add_parser("backup", help="encrypted backups"))
    p.add_argument("action", choices=["create", "restore", "recovery-key"])
    p.add_argument("file", nargs="?", help="backup file to restore")
    p.add_argument("--out", help="output path for create")
    p.add_argument("--recovery-key", action="store_true", help="restore using the recovery key")
    p.set_defaults(func=cmd_backup)

    p = sub.add_parser("check-remote", help="fail unless the git remote is a PRIVATE GitHub repo")
    p.add_argument("--remote", default="origin")
    p.set_defaults(func=cmd_check_remote)

    p = sub.add_parser("paths", help="show where each profile stores data")
    p.set_defaults(func=cmd_paths)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.cmd == "config" and args.action != "show" and not args.value:
        return _fail("This config action needs a value.")
    return args.func(args)


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
