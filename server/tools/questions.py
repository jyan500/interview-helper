"""
Question-bank helpers (read-only) — SCAFFOLD. Fill in the TODOs.

Mirrors `mcp-helpdesk/server/tools/account.py`: the *bodies* live here, plain and
testable without any MCP/LLM involved; `mcp_server.py` is only the registration
layer that wraps these. The one simplification vs. the helpdesk: the "database"
is a JSON file (`data/questions.json`), not Postgres. So instead of opening a DB
session, these functions read the JSON. Everything else — the shape of "a body
takes plain args and returns a plain dict" — is identical.

Quick test once filled in (from server/):
    python -m tools.questions
"""
from __future__ import annotations

import json
from pathlib import Path

# The seed bank ships next to this package. Resolve it absolutely so it works no
# matter what CWD an MCP client launches the server from (same reasoning as the
# helpdesk's explicit .env path).
_DATA = Path(__file__).resolve().parent.parent / "data" / "questions.json"


def _load() -> dict:
    """Read and parse the whole question bank. (Cheap enough to re-read per call
    for a learning project; add caching later if you care.)"""
    return json.loads(_DATA.read_text(encoding="utf-8"))


def list_roles() -> dict:
    """Return the role keys the bank knows about, e.g. ['backend-engineer', ...].

    WORKED EXAMPLE — the shape every function below follows: read the bank, pull
    out the slice you need, return a plain JSON-safe dict.
    """
    bank = _load()
    return {"roles": list(bank.get("roles", {}).keys())}


def next_question(role: str, asked_ids: list[str] | None = None) -> dict:
    """Return the next unasked question for `role` (the Phase 0 worked tool).

    Returns {"status": "ok", "question": {...}} with the first question not in
    `asked_ids`, {"status": "exhausted", "role": role} once they're all asked, or
    {"status": "not_found", "role": role} for an unknown role.
    """
    asked = set(asked_ids or [])
    role_data = _load()["roles"].get(role)
    if role_data is None:
        return {"status": "not_found", "role": role}
    # first unasked question in bank order
    for q in role_data["questions"]:
        if q["id"] not in asked:
            return {"status": "ok", "question": q}
    # every question for this role has been asked
    return {"status": "exhausted", "role": role}



def get_question(question_id: str) -> dict:
    """Look up a single question by id across all roles (backs the question:// resource).

    Returns {"status": "ok", "question": {...}}, or
    {"status": "not_found", "question_id": question_id} if no question matches.
    """
    all_roles = _load()["roles"]
    for role in all_roles:
        for question in all_roles[role]["questions"]:
            if question["id"] == question_id:
                return {"status": "ok", "question": question}
    return {"status": "not_found", "question_id": question_id}


def get_rubric(role: str) -> dict:
    """Return the scoring rubric for a role (backs the rubric:// resource).

    Returns {"status": "ok", "role": role, "rubric": {...}}, or
    {"status": "not_found", "role": role} for an unknown role.
    """
    role_data = _load()["roles"].get(role)
    if role_data is None:
        return {"status": "not_found", "role": role}
    return {"status": "ok", "role": role, "rubric": role_data["rubric"]}


if __name__ == "__main__":
    # Smoke test with no LLM: prove the bank reads and the lookups work.
    print("roles:", list_roles())
    # TODO: once implemented, uncomment:
    print("next:", next_question("backend-engineer", asked_ids=["be-1"]))
    print("rubric:", get_rubric("backend-engineer"))
    print("q:", get_question("be-2"))
