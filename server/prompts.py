"""The interaction TEMPLATES — plain functions, importable by anything.

WHY THIS FILE EXISTS (Phase A refactor). The tool BODIES have always lived in `tools/*.py`
with `mcp_server.py` holding nothing but thin registration wrappers. Prompts never got that
split — their bodies sat inside `@mcp.prompt`-decorated functions in `mcp_server.py`, which
made them reachable *only* over MCP. Fine while the backend was an MCP client; not fine once
it stopped being one.

WHAT CHANGED — the backend stopped calling itself over a socket. In the client-driven design
the MODEL calls nothing: the client picks every question and records every answer. So
`api.py` was launching a subprocess, speaking MCP to it, and JSON-decoding the reply in order
to reach Python functions in the same repo. That's transport with no consumer on the other
side of it. Both `api.py` and `grading.py` now import from here directly.

WHAT DIDN'T CHANGE — the server still OWNS the templates. There is still exactly one
definition of the interviewer's persona and the grading instructions, and no caller carries a
local copy. That was always the real lesson; MCP was just one way to deliver it. `mcp_server.py`
still registers both as MCP prompts (thin wrappers, exactly like the tools), so an EXTERNAL
client — Claude Desktop, `mcp_client_demo.py` — gets the identical text over the protocol.
The MCP surface is now for other people's clients, not for ours.

    prompts.py            <- the one definition
      |-- mcp_server.py   -> @mcp.prompt wrappers  (external clients, over stdio)
      |-- api.py          -> direct call           (the interviewer persona)
      `-- grading.py      -> direct call           (the grading template)
"""
from __future__ import annotations

import textwrap


def behavioral_interview(role: str, seniority: str = "mid") -> str:
    """The interviewer PERSONA — seeds a consistent interviewer for a role and seniority.

    REDUCED ROLE (client-driven loop): the CLIENT (api.py) owns the question spine — it picks
    each bank question, records every answer, caps follow-ups, and ends the interview. So this
    persona no longer drives any of that; it describes only what the model still does each
    turn: REACT to the candidate's last answer and DECIDE whether to probe (the `ask_followup`
    field of the TurnReply output_type). All the old "use next_question / log with
    record_answer / run until exhausted" rules are gone BY DESIGN — the model can't invent a
    question or mislabel an id if it never touches either.
    """
    return textwrap.dedent(f"""
        You are an experienced interviewer conducting a {seniority}-level {role} interview.

        Each turn you get the candidate's latest MESSAGE. First decide what it is:

        - CLARIFYING QUESTION about the current question ("what do you mean by X?", "is this
          asking about Y?", "what are your thoughts?") — NOT an attempt to answer. Then set
          is_clarification = true and put a brief, helpful clarification in `reaction` that does
          NOT reveal the answer. Leave `followup` empty and ask_followup = false. (The candidate
          may go back and forth clarifying as much as they need — that's fine.)
        - Otherwise it's an ANSWER. Respond in two parts:
            - reaction: a short, substantive comment on what they actually said — an assessment,
              never phrased as a question, never with a question tacked on.
            - followup + ask_followup: if the answer is weak, vague, or shallow enough to warrant
              one more probe on the SAME topic, put that single question in `followup` and set
              ask_followup = true; otherwise leave `followup` empty and ask_followup = false.

        Never ask a NEW main question and never announce "moving on" — the system chooses and
        presents the next question. You never pick the topic. Keep it short; stay in character.

        Tone — supportive and professional, but not a pushover:
        - Engage with the SUBSTANCE of what they said. If it's vague, thin, or off-topic, probe
          for specifics with a follow-up (ask_followup = true) — curious, not accusatory.
        - Do NOT judge the candidate's overall ability, call out "gaps in their knowledge," or
          comment on whether their answer is (un)expected for the level. That assessment belongs
          in the end-of-interview scorecard, NOT the live conversation.
        - If they're unsure or can't answer, acknowledge it graciously and move on — no scolding.
        - No hollow praise for answers that didn't earn it, but a warm, encouraging tone is good.
          Never give away the answer; hints are fine.
    """).strip()


def evaluate_answer(question: str, answer: str, rubric: str) -> str:
    """The GRADING template: score, one strength, one gap, one fix.

    A PURE template — data in, instructions out. It does not read the DB and never should:
    the caller (grading.py) fetches the question text and rubric and passes them in. Keeping
    it pure is what makes the grader's input trivially inspectable when a grade looks wrong —
    print the string and you have seen everything the model saw.

    Phase E extends this signature with the reference brief + the interview's level, so
    scoring is grounded in authored material and calibrated to seniority.
    """
    return textwrap.dedent(f"""
        You are grading a candidate's answer.

        Given the question, answer, and rubric, score the answer on each rubric dimension (1 to 5),
        name one concrete strength, one gap, and one specific improvement.

        question: {question}
        answer: {answer}
        rubric: {rubric}
    """).strip()
