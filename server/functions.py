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


# --- skill names (the resume importer's cross-check against the curated vocab) --------------------
def skill_key(value: str) -> str:
    """A skill name or slug folded to one comparable key: lowercase, the symbols that carry meaning
    spelled out ("+" -> "p", "#" -> "sharp", a leading "." -> "dot"), everything else non-alphanumeric
    dropped. So a vocab name, its slug and a resume's spelling of it all land on the same key.

        skill_key("C++")      -> "cpp"       (== skill_key("cpp"))
        skill_key("C#")       -> "csharp"
        skill_key(".NET")     -> "dotnet"
        skill_key("Node.js")  -> "nodejs"    (== skill_key("nodejs"))
        skill_key("CI/CD")    -> "cicd"
    """
    folded = value.strip().lower()
    if folded.startswith("."):
        folded = "dot" + folded[1:]
    folded = folded.replace("+", "p").replace("#", "sharp")
    return "".join(char for char in folded if char.isalnum())
