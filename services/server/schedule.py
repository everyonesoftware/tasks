"""Constant-time calendar recurrence; no materialized missed backlog."""
from calendar import monthrange
from datetime import date, timedelta


def around(start, repeat, interval, on):
    """Return (latest scheduled date <= on, next scheduled date > on)."""
    if on < start:
        return None, start
    if repeat == 'once':
        return start, None
    if repeat in ('monthly', 'yearly'):
        months = interval * (12 if repeat == 'yearly' else 1)
        distance = (on.year - start.year) * 12 + on.month - start.month
        n = distance // months

        def occurrence(index):
            year, month = divmod(start.year * 12 + start.month - 1 + index * months, 12)
            month += 1
            if year > 9999:
                return None
            return date(year, month, min(start.day, monthrange(year, month)[1]))

        latest = occurrence(n)
        if latest > on:
            n -= 1
            latest = occurrence(n)
        return latest, occurrence(n + 1)
    days = interval * (7 if repeat == 'weekly' else 1)
    n = (on - start).days // days
    latest = start + timedelta(days=n * days)
    try:
        following = latest + timedelta(days=days)
    except OverflowError:
        following = None
    return latest, following
