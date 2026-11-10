"""The host is Windows on ARM: every package Windows installs must come as a wheel.

Walks the uv.lock dependency graph from this project (including dev deps),
evaluating environment markers for Windows, so Linux-only packages are skipped.
"""

import tomllib
from pathlib import Path

from packaging.markers import Marker

LOCK = Path(__file__).resolve().parents[2] / "uv.lock"
WINDOWS_ENVS = [
    {"sys_platform": "win32", "platform_system": "Windows", "os_name": "nt", "platform_machine": machine,
     "python_version": "3.13", "python_full_version": "3.13.0", "implementation_name": "cpython",
     "platform_python_implementation": "CPython", "extra": ""}
    for machine in ("ARM64", "AMD64")
]
PLATFORM_TAG = {"ARM64": "win_arm64", "AMD64": "win_amd64"}


def _applies(dep, env):
    return "marker" not in dep or Marker(dep["marker"]).evaluate(env)


def _windows_packages(lock, env):
    by_name = {p["name"]: p for p in lock["package"]}
    root = next(p for p in lock["package"] if p["name"] == "studydash")
    todo = list(root.get("dependencies", []))
    for group in root.get("dev-dependencies", {}).values():
        todo += group
    seen = {}
    while todo:
        dep = todo.pop()
        if not _applies(dep, env):
            continue
        pkg = by_name[dep["name"]]
        extras = set(dep.get("extra", []))
        key = pkg["name"]
        if key in seen and extras <= seen[key]:
            continue
        seen[key] = seen.get(key, set()) | extras
        todo += pkg.get("dependencies", [])
        for extra in extras:
            todo += pkg.get("optional-dependencies", {}).get(extra, [])
    return [by_name[n] for n in seen]


def test_every_windows_package_has_a_wheel():
    lock = tomllib.loads(LOCK.read_text(encoding="utf-8"))
    missing = []
    for env in WINDOWS_ENVS:
        tag = PLATFORM_TAG[env["platform_machine"]]
        for pkg in _windows_packages(lock, env):
            names = [w["url"].rsplit("/", 1)[1] for w in pkg.get("wheels", [])]
            if not any(n.endswith("-none-any.whl") or tag in n for n in names):
                missing.append(f"{pkg['name']}=={pkg['version']} ({tag})")
    assert not missing, "Would need a compiler on Windows: " + ", ".join(missing)


def test_graph_walk_sees_core_packages():
    lock = tomllib.loads(LOCK.read_text(encoding="utf-8"))
    names = {p["name"] for p in _windows_packages(lock, WINDOWS_ENVS[0])}
    assert {"fastapi", "pynacl", "argon2-cffi-bindings", "pywin32-ctypes", "pytest"} <= names
    assert "secretstorage" not in names and "cryptography" not in names
