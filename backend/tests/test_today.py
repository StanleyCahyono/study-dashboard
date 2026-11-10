from datetime import date, datetime, timezone

from conftest import enroll

from studydash.models import Course, CourseMeeting, Task
from studydash.paths import Profile


def _add_class(app, weekday, start, end, starts_on=date(2026, 8, 1), ends_on=date(2026, 12, 31)):
    with app.state.sd.db.session() as s:
        c = Course(code="TEST 1000", title="Test course")
        s.add(c)
        s.flush()
        s.add(CourseMeeting(course_id=c.id, kind="lecture", weekday=weekday, start_local=start, end_local=end,
                            timezone="America/New_York", starts_on=starts_on, ends_on=ends_on))
        s.commit()


def test_next_class_and_in_progress(make, clock):
    app, client = make()
    enroll(app, client)
    _add_class(app, 0, "09:05", "09:55")  # Monday
    # 08:00 EST Monday -> class starts in 65 minutes, 14:05Z.
    nc = client.get("/api/today").json()["next_class"]
    assert nc["starts_at"] == "2026-11-09T14:05:00Z"
    assert nc["minutes_until_start"] == 65 and nc["in_progress"] is False
    clock.now = datetime(2026, 11, 9, 14, 30, tzinfo=timezone.utc)
    assert client.get("/api/today").json()["next_class"]["in_progress"] is True
    clock.now = datetime(2026, 11, 9, 15, 0, tzinfo=timezone.utc)
    assert client.get("/api/today").json()["next_class"]["starts_at"] == "2026-11-16T14:05:00Z"


def test_class_across_dst_keeps_local_time(make, clock):
    app, client = make()
    enroll(app, client)
    _add_class(app, 0, "09:05", "09:55")
    # Saturday Oct 31 2026, before US DST ends on Nov 1.
    clock.now = datetime(2026, 10, 31, 16, 0, tzinfo=timezone.utc)
    # Monday Nov 2 09:05 EST == 14:05Z (it would be 13:05Z under EDT).
    assert client.get("/api/today").json()["next_class"]["starts_at"] == "2026-11-02T14:05:00Z"


def test_next_task_prefers_soonest_and_counts_overdue(make, clock):
    app, client = make()
    enroll(app, client)
    with app.state.sd.db.session() as s:
        s.add_all([
            Task(title="Later", due_at=datetime(2026, 11, 12, tzinfo=timezone.utc), estimated_minutes=30),
            Task(title="Sooner", due_at=datetime(2026, 11, 10, tzinfo=timezone.utc), estimated_minutes=60),
            Task(title="Overdue", due_at=datetime(2026, 11, 1, tzinfo=timezone.utc)),
            Task(title="Done", due_at=datetime(2026, 11, 9, 20, tzinfo=timezone.utc), status="done"),
        ])
        s.commit()
    data = client.get("/api/today").json()
    assert data["next_task"]["title"] == "Sooner"
    assert data["overdue_count"] == 1
    assert data["timezone"] == "America/New_York"


def test_undated_task_reported_as_unknown_due(make):
    app, client = make()
    enroll(app, client)
    with app.state.sd.db.session() as s:
        s.add(Task(title="No date yet"))
        s.commit()
    t = client.get("/api/today").json()["next_task"]
    assert t["due_known"] is False and t["due_at"] is None


def test_demo_profile_seeds_each_start(make):
    app, client = make(Profile.DEMO)
    enroll(app, client)
    assert client.get("/api/today").json()["next_task"] is not None
