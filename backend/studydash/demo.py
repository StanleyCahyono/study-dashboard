"""Fictitious demo data. Only ever written to the demo profile's database.

Course codes are real Cornell course numbers but every title, meeting time,
location and task below is invented for demonstration.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta

from sqlalchemy import delete
from sqlalchemy.orm import Session

from .models import Course, CourseMeeting, Task
from .paths import Profile
from .timeutil import Clock

DEMO_ZONE = "America/New_York"


class NotDemoProfile(RuntimeError):
    pass


def seed_demo(db: Session, profile: Profile, clock: Clock) -> None:
    """Replace academic rows with fresh synthetic ones. Auth tables are kept."""
    if profile is not Profile.DEMO:
        raise NotDemoProfile("Demo fixtures may only be written to the demo profile.")
    from zoneinfo import ZoneInfo

    zone = ZoneInfo(DEMO_ZONE)
    now_local = clock().astimezone(zone)
    term_start = now_local.date() - timedelta(days=60)
    term_end = now_local.date() + timedelta(days=60)

    db.execute(delete(Task))
    db.execute(delete(CourseMeeting))
    db.execute(delete(Course))

    courses = {
        "AEM 1101": Course(code="AEM 1101", title="[Demo] Intro to Business Ideas", is_synthetic=True),
        "AEM 2200": Course(code="AEM 2200", title="[Demo] Business Management Practice", is_synthetic=True),
        "ECON 1120": Course(code="ECON 1120", title="[Demo] Principles of Macro Thinking", is_synthetic=True),
    }
    db.add_all(courses.values())
    db.flush()

    schedule = [
        ("AEM 1101", "lecture", [0, 2, 4], "09:05", "09:55", "Demo Hall 101"),
        ("AEM 2200", "lecture", [1, 3], "11:40", "12:55", "Demo Hall 220"),
        ("ECON 1120", "lecture", [0, 2], "13:25", "14:15", "Demo Auditorium"),
        ("ECON 1120", "section", [4], "14:30", "15:20", "Demo Room 12"),
    ]
    for code, kind, weekdays, start, end, location in schedule:
        for weekday in weekdays:
            db.add(
                CourseMeeting(
                    course_id=courses[code].id,
                    kind=kind,
                    weekday=weekday,
                    start_local=start,
                    end_local=end,
                    timezone=DEMO_ZONE,
                    location=location,
                    starts_on=term_start,
                    ends_on=term_end,
                    is_synthetic=True,
                )
            )

    def due(days: int, hh: int, mm: int) -> datetime:
        local = datetime.combine(now_local.date() + timedelta(days=days), time(hh, mm), tzinfo=zone)
        return local

    tasks = [
        ("AEM 1101", "Read chapter 4 and answer the 5 review questions", due(1, 23, 59), 45),
        ("ECON 1120", "Problem set 6: supply shocks", due(2, 17, 0), 120),
        ("AEM 2200", "Team case outline (draft for teammates)", due(4, 12, 0), 90),
        ("ECON 1120", "Review for Prelim 2", due(6, 19, 30), 180),
        ("AEM 1101", "Reflection post", due(-1, 23, 59), 20),
    ]
    for code, title, due_at, minutes in tasks:
        db.add(
            Task(
                course_id=courses[code].id,
                title=f"[Demo] {title}",
                due_at=due_at,
                estimated_minutes=minutes,
                status="open",
                is_synthetic=True,
            )
        )
    db.commit()
