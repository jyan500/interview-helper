"""Voice edge adapters — the ONE genuinely new idea in this project.

The whole thesis: a voice app is a text app with adapters on the two ends. Phase 3
runs a complete interview through these functions while they are just print()/input().
Phase 4 swaps ONLY the bodies below for real TTS/STT — the agent, MCP server, tools,
and the loop in pydantic_agent.py never learn the difference.

Keep this interface tiny on purpose:
    speak(text)  -> render text to the user   (print now; TTS later)
    listen()     -> get the user's answer      (input now; STT later)
"""
from __future__ import annotations


def speak(text: str) -> None:
    """Render the agent's turn to the user.

    Phase 3 (now): print it.
    Phase 4 (TODO): synthesize speech. Local/free first to keep spend at zero, e.g.
        - piper (fast, good quality, offline), or
        - pyttsx3 (built-in, no downloads, robotic but works)
      Synthesize `text` to audio and play it. The signature does NOT change.
    """
    print(f"\n🧑‍💼 {text}\n")


def listen() -> str:
    """Get the candidate's answer.

    Phase 3 (now): read a typed line.
    Phase 4 (TODO): capture mic audio and transcribe it. Local/free first, e.g.
        - faster-whisper (Whisper, offline, good accuracy)
      Record until the user stops talking (endpointing is the genuinely NEW problem
      audio introduces — see build-plan Phase 5), transcribe, and return the text.
      The signature does NOT change.
    """
    return input("🗣️  your answer > ")
