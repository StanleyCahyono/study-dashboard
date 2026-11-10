"""The Today summary: next class, next task, and sync status."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from .models import CourseMeeting, Task
from .paths import Profile
from .timeutil import iso

LOOKAHEAD_DAYS = 14


def _hhmm(value: str) -> time:
    hours, minutes = value.split(":")
    return time(int(hours), int(minutes))


def meeting_occurrences(meeting: CourseMeeting, start: date, days: int):
    """Yield (start_utc, end_utc) for a weekly meeting, honoring its own zone.

    Meetings are floating local times, so DST shifts the UTC instant while the
    local wall-clock time stays fixed.
    """
    zone = ZoneInfo(meeting.timezone)
    for offset in range(days):
        day = start + timedelta(days=offset)
        if day.weekday() != meeting.weekday or not (meeting.starts_on <= day <= meeting.ends_on):
            continue
        begin = datetime.combine(day, _hhmm(meeting.start_local), tzinfo=zone)
        end = datetime.combine(day, _hhmm(meeting.end_local), tzinfo=zone)
        yield begin, end


def next_class(db: Session, now: datetime, display_zone: ZoneInfo) -> dict | None:
    meetings = db.execute(select(CourseMeeting).options(joinedload(CourseMeeting.course))).scalars().all()
    start_day = now.astimezone(display_zone).date() - timedelta(days=1)
    best = None
    for meeting in meetings:
        for begin, end in meeting_occurrences(meeting, start_day, LOOKAHEAD_DAYS + 2):
            if end <= now:
                continue
            if best is None or begin < best[0]:
                best = (begin, end, meeting)
    if best is None:
        return None
    begin, end, meeting = best
    return {
        "course_code": meeting.course.code,
        "course_title": meeting.course.title,
        "kind": meeting.kind,
        "location": meeting.location,
        "starts_at": iso(begin),
        "ends_at": iso(end),
        "in_progress": begin <= now < end,
        "minutes_until_start": max(0, int((begin - now).total_seconds() // 60)),
    }


def next_task(db: Session, now: datetime) -> tuple[dict | None, int]:
    open_tasks = db.execute(
        select(Task).options(joinedload(Task.course)).where(Task.status == "open")
    ).scalars().all()
    overdue = [t for t in open_tasks if t.due_at is not None and t.due_at < now]
    upcoming = sorted((t for t in open_tasks if t.due_at is not None and t.due_at >= now), key=lambda t: t.due_at)
    undated = [t for t in open_tasks if t.due_at is None]
    chosen = upcoming[0] if upcoming else (undated[0] if undated else None)
    if chosen is None:
        return None, len(overdue)
    return (
        {
            "id": chosen.id,
            "title": chosen.title,
            "course_code": chosen.course.code if chosen.course else None,
            "due_at": iso(chosen.due_at),
            "due_known": chosen.due_at is not None,
            "estimated_minutes": chosen.estimated_minutes,
        },
        len(overdue),
    )


def sync_status(profile: Profile) -> dict:
    if profile is Profile.DEMO:
        return {
            "state": "demo",
            "label": "Synthetic demo data. Nothing is synced.",
            "sources_connected": 0,
            "last_success_at": None,
        }
    return {
        "state": "no_sources",
        "label": "No sources connected yet.",
        "sources_connected": 0,
        "last_success_at": None,
    }


def today_summary(db: Session, profile: Profile, now: datetime, display_zone: ZoneInfo) -> dict:
    task, overdue_count = next_task(db, now)
    return {
        "profile": profile.value,
        "now": iso(now),
        "timezone": display_zone.key,
        "next_class": next_class(db, now, display_zone),
        "next_task": task,
        "overdue_count": overdue_count,
        "sync": sync_status(profile),
    }
