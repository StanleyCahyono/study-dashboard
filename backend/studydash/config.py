"""Per-profile settings stored in the profile directory (never in Git)."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from zoneinfo import ZoneInfo

from .paths import DEFAULT_PORTS, ProfilePaths

DEFAULT_TIMEZONE = "America/New_York"


@dataclass
class Settings:
    timezone: str = DEFAULT_TIMEZONE
    port: int | None = None
    # Extra host names the app answers to, e.g. the Tailscale Serve name
    # "studyhost.example-tailnet.ts.net". Loopback names are always allowed.
    tailnet_hostnames: list[str] = field(default_factory=list)
    # Set only by `studyctl attest-disk-encryption` when automatic detection
    # cannot confirm encryption. Records what the owner attested and when.
    disk_encryption_attestation: str | None = None
    # "os" (Windows Credential Manager / macOS Keychain) or "file" (headless Linux server).
    keystore: str = "os"

    def zone(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)


def load_settings(paths: ProfilePaths) -> Settings:
    settings = Settings()
    if paths.config.exists():
        raw = json.loads(paths.config.read_text(encoding="utf-8"))
        for key, value in raw.items():
            if hasattr(settings, key):
                setattr(settings, key, value)
    if settings.port is None:
        settings.port = DEFAULT_PORTS[paths.profile]
    ZoneInfo(settings.timezone)  # validate
    return settings


def save_settings(paths: ProfilePaths, settings: Settings) -> None:
    paths.ensure()
    ZoneInfo(settings.timezone)
    tmp = paths.config.with_suffix(".tmp")
    tmp.write_text(json.dumps(asdict(settings), indent=2), encoding="utf-8")
    tmp.replace(paths.config)
