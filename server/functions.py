"""Small shared helper functions — pure, no I/O, imported wherever they're needed.

The home for reusable one-purpose functions that would otherwise be defined privately in a route or
tool module and then copied. Keep them pure (no DB, no network) so any module can import this one
without pulling in an engine or a client.
"""
from __future__ import annotations

from datetime import date


# --- month-granular dates (the Profile page's roles: "Jan 2022 to present") -----------------------
def parse_month(value: str) -> date:
    """"YYYY-MM" -> the 1st of that month. The caller validates the format first (api.py's
    MonthField pattern), so this only splits."""
    year, month = value.split("-")
    return date(int(year), int(month), 1)


def format_month(value: date | None) -> str | None:
    """A month-granular date as the wire's "YYYY-MM" (None stays None, e.g. a current role)."""
    return value.strftime("%Y-%m") if value is not None else None


def month_label(value: date | None) -> str:
    """A month-granular date as prose for a prompt: "Jan 2022", or "present" for None."""
    return value.strftime("%b %Y") if value is not None else "present"
