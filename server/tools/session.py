"""
Session tools (SIDE EFFECTS) — SCAFFOLD. Fill in the TODOs.

The counterpart to `mcp-helpdesk/server/tools/action.py`: these tools CHANGE the
world (they persist interview turns and summaries) instead of just reading it.
The helpdesk wrote rows to Postgres; here we append to a JSON file per session
under `data/sessions/`. Same lesson, simpler store.

Nothing here is gated for approval — recording an answer is cheap and reversible,
so there's no `REQUIRES_APPROVAL` set like the helpdesk had. (If you later add a
real irreversible action — e.g. emailing a transcript — that's where an approval
gate / MCP elicitation would come back, exactly as in `mcp-helpdesk` Phase 5.)

Quick test once filled in (from server/):
    python -m tools.session
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

_SESSIONS = Path(__file__).resolve().parent.parent / "data" / "sessions"


def _session_path(session_id: str) -> Path:
    return _SESSIONS / f"{session_id}.json"


def _read(session_id: str) -> dict:
    """Load a session file, or a fresh skeleton if it doesn't exist yet."""
    p = _session_path(session_id)
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return {"session_id": session_id, "turns": [], "summary": None}


def _write(session_id: str, data: dict) -> None:
    """WORKED helper: ensure the dir exists and dump the session back to disk."""
    _SESSIONS.mkdir(parents=True, exist_ok=True)
    _session_path(session_id).write_text(
        json.dumps(data, indent=2), encoding="utf-8"
    )


def record_answer(session_id: str, question_id: str, answer: str) -> dict:
    """Persist one interview turn (question asked + the candidate's answer).

    WORKED EXAMPLE (the side-effecting pattern — read, mutate, write, report ok):
      - data = _read(session_id)
      - data["turns"].append({
            "question_id": question_id,
            "answer": answer,
            "at": datetime.now(timezone.utc).isoformat(),
        })
      - _write(session_id, data)
      - return {"ok": True, "session_id": session_id, "turn_count": len(data["turns"])}
    """
    # TODO: implement per the pointers above.
    ...


def save_session_summary(session_id: str, feedback: str) -> dict:
    """Persist the final wrap-up feedback for a session.

    Pointers (same read/mutate/write/report shape):
      - data = _read(session_id)
      - data["summary"] = feedback
      - _write(session_id, data)
      - return {"ok": True, "session_id": session_id, "status": "summarized"}
    """
    # TODO: implement per the pointers above.
    ...


if __name__ == "__main__":
    # Smoke test with no LLM:
    # TODO: once implemented, uncomment:
    # print(record_answer("demo", "be-1", "I once traced a memory leak to..."))
    # print(save_session_summary("demo", "Strong on debugging; work on brevity."))
    print("session store dir:", _SESSIONS)
