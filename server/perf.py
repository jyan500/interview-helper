"""Performance logging, gated behind one debug flag.

Set `PERF_LOG=1` in server/.env to print per-stage latency + token lines for the voice pipeline
(transcribe, answer, tts) and the simulation LLM calls. Off by default, so production logs stay quiet.

The flag is read at CALL time, not import time: load_dotenv runs in pydantic_agent's module setup,
and an import-time read could run before it depending on import order.
"""
from __future__ import annotations

import logging
import os

# uvicorn's logger, so these lines land in the same console as the request log.
log = logging.getLogger("uvicorn.error")


def perf_enabled() -> bool:
    return os.environ.get("PERF_LOG") == "1"


def log_perf(msg: str, *args) -> None:
    """log.info(msg, *args), only when PERF_LOG=1. Same lazy %-args as logging, so a disabled
    call never formats the string."""
    if perf_enabled():
        log.info(msg, *args)
