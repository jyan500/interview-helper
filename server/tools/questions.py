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
    """Return the next unasked question for `role`, or done=True if exhausted.

    This is the Phase 0 worked tool. Pointers:
      - asked = set(asked_ids or [])
      - role_data = _load()["roles"].get(role)
      - if role_data is None: return {"found": False, "role": role}
      - for q in role_data["questions"]:
            if q["id"] not in asked:
                return {"found": True, "question": q}
      - return {"found": True, "done": True, "role": role}   # all asked
    """
    # TODO: implement per the pointers above.
    asked = set(asked_ids or [])
    role_data = _load()["roles"].get(role)
    if role_data is None:
        return {"found": False, "role": role}
    # this assumes that the questions are asked in sequential order
    for q in role_data["questions"]:
        if q["id"] not in asked:
            return {"found": True, "question": q}
    # all asked
    return {"found": True, "done": True, "role": role}



def get_question(question_id: str) -> dict:
    """Look up a single question by id across all roles (backs the question:// resource).

    Pointers:
      - walk every role's "questions" list; return the one whose id matches
      - not found -> {"found": False, "question_id": question_id}
    """
    # TODO: implement per the pointers above.
    all_roles = _load()["roles"]
    for role in all_roles:
        for question in all_roles[role]["questions"]:
            if question["id"] == question_id:
                return {"found": True, "question": question}
    return {"found": False, "question_id": question_id}


def get_rubric(role: str) -> dict:
    """Return the scoring rubric for a role (backs the rubric:// resource).

    Pointers:
      - role_data = _load()["roles"].get(role)
      - None -> {"found": False, "role": role}
      - else -> {"found": True, "role": role, "rubric": role_data["rubric"]}
    """
    # TODO: implement per the pointers above.
    role_data = _load()["roles"].get(role)
    if role_data is None:
        return {"found": False, "role": role}
    return {"found": True, "role": role, "rubric": role_data["rubric"]}


if __name__ == "__main__":
    # Smoke test with no LLM: prove the bank reads and the lookups work.
    print("roles:", list_roles())
    # TODO: once implemented, uncomment:
    print("next:", next_question("backend-engineer", asked_ids=["be-1"]))
    print("rubric:", get_rubric("backend-engineer"))
    print("q:", get_question("be-2"))
