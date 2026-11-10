"""Best-effort detection of full-disk encryption for the data directory."""

from __future__ import annotations

import platform
import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass
class DiskStatus:
    state: str  # "on" | "provider" | "off" | "unknown"
    detail: str


def _run(args: list[str]) -> str:
    return subprocess.run(args, capture_output=True, text=True, timeout=20, check=False).stdout.strip()


def _windows(path: Path) -> DiskStatus:
    drive = path.resolve().drive or "C:"
    # Works without administrator rights. Values: 1 = on, 2 = off,
    # 3 = encryption in progress, 4 = decrypting, 5 = suspended, 6 = on (locked).
    script = (
        f"(New-Object -ComObject Shell.Application).NameSpace('{drive}')"
        ".Self.ExtendedProperty('System.Volume.BitLockerProtection')"
    )
    try:
        out = _run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script])
    except (OSError, subprocess.SubprocessError) as exc:
        return DiskStatus("unknown", f"Could not query BitLocker: {exc}")
    if out in {"1", "6"}:
        return DiskStatus("on", f"BitLocker/Device Encryption protection is on for {drive}")
    if out in {"2", "4", "5"}:
        return DiskStatus("off", f"BitLocker protection is off or suspended for {drive} (code {out})")
    if out == "3":
        return DiskStatus("off", f"BitLocker encryption is still in progress on {drive}")
    return DiskStatus("unknown", f"BitLocker status for {drive} was not reported (got {out!r})")


def _mac() -> DiskStatus:
    try:
        out = _run(["fdesetup", "status"])
    except (OSError, subprocess.SubprocessError) as exc:
        return DiskStatus("unknown", f"Could not query FileVault: {exc}")
    if "FileVault is On" in out:
        return DiskStatus("on", out)
    if "FileVault is Off" in out:
        return DiskStatus("off", out)
    return DiskStatus("unknown", out or "fdesetup returned nothing")


def _cloud_provider() -> str | None:
    try:
        product = Path("/sys/class/dmi/id/product_name").read_text().strip()
    except OSError:
        return None
    return product if product == "Google Compute Engine" else None


def _linux(path: Path) -> DiskStatus:
    provider = _cloud_provider()
    if provider:
        return DiskStatus(
            "provider",
            f"{provider} persistent disk: encrypted at rest by the provider with provider-managed keys",
        )
    try:
        source = _run(["findmnt", "-no", "SOURCE", "--target", str(path)])
        if not source.startswith("/dev/"):
            return DiskStatus("unknown", f"Data directory is on {source or 'an unknown device'}")
        types = _run(["lsblk", "-s", "-no", "TYPE", source]).split()
    except (OSError, subprocess.SubprocessError) as exc:
        return DiskStatus("unknown", f"Could not inspect block devices: {exc}")
    if "crypt" in types:
        return DiskStatus("on", f"{source} is on a dm-crypt device")
    return DiskStatus("off", f"{source} is not on an encrypted device")


def detect(path: Path) -> DiskStatus:
    system = platform.system()
    if system == "Windows":
        return _windows(path)
    if system == "Darwin":
        return _mac()
    if system == "Linux":
        return _linux(path)
    return DiskStatus("unknown", f"Unsupported OS {system}")
