import subprocess

from studydash import cli


def test_github_slug_parsing():
    assert cli.github_slug("https://github.com/someone/study-dashboard") == "someone/study-dashboard"
    assert cli.github_slug("https://github.com/someone/study-dashboard.git") == "someone/study-dashboard"
    assert cli.github_slug("git@github.com:someone/study-dashboard.git") == "someone/study-dashboard"
    assert cli.github_slug("https://gitlab.com/someone/x") is None
    assert cli.github_slug("https://github.com.evil.example/someone/x") is None


class _Result:
    def __init__(self, stdout, returncode=0):
        self.stdout = stdout
        self.returncode = returncode


def _fake_run(visibility, gh_rc=0, url="https://github.com/someone/study-dashboard"):
    def run(args, **kwargs):
        if args[:2] == ["git", "remote"]:
            return _Result(url + "\n")
        if args[0] == "gh":
            return _Result(visibility + "\n", gh_rc)
        raise AssertionError(args)

    return run


def test_remote_check_fails_closed(monkeypatch):
    monkeypatch.setattr(cli.shutil, "which", lambda name: "/usr/bin/" + name)
    monkeypatch.setattr(subprocess, "run", _fake_run("private"))
    assert cli.check_remote_visibility("origin", quiet=True) == 0
    monkeypatch.setattr(subprocess, "run", _fake_run("public"))
    assert cli.check_remote_visibility("origin", quiet=True) == 1
    monkeypatch.setattr(subprocess, "run", _fake_run("internal"))
    assert cli.check_remote_visibility("origin", quiet=True) == 1
    monkeypatch.setattr(subprocess, "run", _fake_run("", gh_rc=1))
    assert cli.check_remote_visibility("origin", quiet=True) == 1
    monkeypatch.setattr(subprocess, "run", _fake_run("private", url="https://gitlab.com/a/b"))
    assert cli.check_remote_visibility("origin", quiet=True) == 1
    monkeypatch.setattr(cli.shutil, "which", lambda name: None)
    monkeypatch.setattr(subprocess, "run", _fake_run("private"))
    assert cli.check_remote_visibility("origin", quiet=True) == 1
