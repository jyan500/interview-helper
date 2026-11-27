"""The voice edge adapters, server side: speech-to-text in, text-to-speech out.

The interview loop never learns that an answer was spoken or that a reply was read aloud: these two
routes are the whole server-side cost of voice. Both spend money on the caller's behalf, so both are
wallet-gated behind require_user.
"""
from __future__ import annotations

import os
import time

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from openai import AsyncOpenAI
from pydantic import BaseModel

from auth import require_user
from perf import log_perf

router = APIRouter(tags=["audio"])


# Phase F — the /api/tts request. Unlike /api/transcribe (whose request is raw multipart audio,
# so it has no BaseModel), TTS goes the OTHER way: a plain JSON body carrying the text to speak.
class TtsRequest(BaseModel):
    text: str
    # OPTIONAL later: let the client pick the voice/model per session. Leave it out for now —
    # a fixed default keeps the speak(text) contract dead simple. (If you add it, thread it into
    # the create() call below and mirror the field in api.ts's TtsRequest.)
    # voice: str = "alloy"


# ===========================================================================
# WORKED EXAMPLE — POST /api/transcribe : the robust-STT INPUT edge adapter, server side.
#
# THE THESIS, ONE MORE TIME: the browser's built-in Web Speech API was swapped for a pipeline
# we own — capture in the browser, transcribe HERE. The interview loop (routers/interviews.py) never learns
# which STT produced the text; `record_answer`, the agent, the transcript are all untouched.
# This route is the entire server-side cost of that swap: audio bytes in, text out.
#
# Why CLOUD Whisper (OpenAI) and not self-hosted faster-whisper? Deployability. Self-hosting
# means a GPU (or slow CPU), a multi-GB model in RAM, and a concurrency queue. Proxying one
# HTTP call to OpenAI keeps THIS server a thin, deploy-friendly relay — same $/min tradeoff
# an interview coach happily makes. The seam is identical either way (that's the point): the
# body of this function is the ONLY thing that would change to go self-hosted.

# Lazy singleton: AsyncOpenAI() reads OPENAI_API_KEY from the env (loaded by pydantic_agent's
# load_dotenv, which grading.py's import chain triggers). Built on first use, not at module
# load, so the app still boots for the text-only flow if the key isn't set yet — you only hit
# the error when you actually transcribe. AsyncOpenAI so the call `await`s without blocking
# the event loop.
_openai_client: AsyncOpenAI | None = None


def get_openai_client() -> AsyncOpenAI:
    global _openai_client
    if _openai_client is None:
        if not os.environ.get("OPENAI_API_KEY"):
            raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not set in server/.env")
        _openai_client = AsyncOpenAI()
    return _openai_client


# add `user_id: str = Depends(require_user)` here too, and note this one is
# NOT about protecting data: there's no row and no owner, so there's nothing to authorize.
# It's about protecting your WALLET. An open transcribe endpoint is a stranger's free
# Whisper account billed to your OPENAI_API_KEY, found by anyone who scans your deployed
# origin. Any route that spends money on someone's behalf needs to know whose behalf.
# (`user_id` will be unused in the body — that's fine and normal for a gate. Once Phase F
# adds /api/tts, it gets the same treatment for the same reason.)
# The STT model. whisper-1 and the gpt-4o-*-transcribe family shut down 2027-02-26 (OpenAI
# deprecations page); gpt-transcribe is the listed drop-in: same /v1/audio/transcriptions call
# shape, $0.0045/min vs whisper's $0.006.
STT_MODEL = "gpt-transcribe"


@router.post("/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    user_id: str = Depends(require_user)
) -> dict:
    # The browser records ONE utterance (MediaRecorder -> a webm/opus Blob) and POSTs it as
    # multipart form-data under the field name "audio". FastAPI hands it to us as an UploadFile.
    data = await audio.read()

    if len(data) == 0:
        return {"text": ""}

    megabytes = len(data) / (1024**2)   # data is bytes -> len() IS the payload size in bytes
    if megabytes > 10:
        raise HTTPException(status_code=413, detail="Audio file is too large to transcribe")

    # The file arg takes a (filename, bytes, content_type) tuple. The filename's extension
    # is how the API infers the container, so keep the browser's (e.g. "answer.webm").
    started = time.perf_counter()
    result = await get_openai_client().audio.transcriptions.create(
        model=STT_MODEL,
        file=(audio.filename or "answer.webm", data, audio.content_type or "audio/webm"),
        language="en"
    )
    log_perf("transcribe: model=%s stt=%.2fs bytes=%s", STT_MODEL, time.perf_counter() - started, len(data))

    # Same shape the client's onResult(text) expects — mirrors the Web Speech path's output.
    return {"text": result.text}


# ===========================================================================
# SCAFFOLD (Phase F) — POST /api/tts : the neural-TTS OUTPUT edge adapter, server side.
#
# THIS IS THE MIRROR OF /api/transcribe. Transcribe is audio-in / text-out (the INPUT seam);
# this is text-in / audio-out (the OUTPUT seam). The thesis one more time: the interview loop
# (routers/interviews.py) never learns that the interviewer's turn was SPOKEN. In the browser `speak(text)` used
# to lean on the OS's robotic SpeechSynthesis; now it POSTs text HERE and plays the neural audio
# that comes back. The entire server-side cost of that swap is this one route — text in, mp3 out.
#
# REUSE what transcribe already stood up, don't reinvent it:
#   - get_openai_client()  — the same lazy AsyncOpenAI singleton (reads OPENAI_API_KEY on first use).
#   - Depends(require_user) — the same WALLET gate. An open TTS proxy is a stranger's OpenAI bill
#     billed to your key, found by scanning your deployed origin. `user_id` goes unused in the body
#     (there's no row to own) — that's fine and normal for a money-spending gate, exactly like
#     transcribe. Any route that spends money on someone's behalf must know whose behalf.
#
# VERIFIED CALL SHAPE (openai 2.46.0, AsyncSpeech.create — args are KEYWORD-ONLY):
#     resp = await get_openai_client().audio.speech.create(
#         model="gpt-4o-mini-tts",   # newer + steerable; "tts-1" is the cheaper classic
#         voice="alloy",             # alloy | echo | fable | onyx | nova | shimmer | ...
#         input=text,
#         response_format="mp3",     # mp3 | opus | aac | flac | wav | pcm
#     )
#     audio_bytes = await resp.aread()   # HttpxBinaryResponseContent -> bytes.
#                                        # NOTE: aread(), the ASYNC read — plain .read() is the
#                                        # sync client's method and won't await here.
# Then hand the bytes back as a BINARY body FastAPI won't try to JSON-encode (that's why the
# route returns fastapi.Response, not a dict):
#     return Response(content=audio_bytes, media_type="audio/mpeg")   # audio/mpeg == mp3
#
# GUARDRAILS to mirror from transcribe (fill these in — they're the whole point of a proxy you own):
#   - empty text -> 400 (nothing to synthesize; don't spend a cent on "").
#   - very long text -> 413. A runaway 20k-char answer read aloud is real money + latency; pick a
#     sane character ceiling (transcribe caps bytes at 10MB — do the char equivalent here).
@router.post("/tts")
async def tts(
    req: TtsRequest,
    user_id: str = Depends(require_user),
) -> Response:
    text = req.text.strip()

    if len(text) == 0:
        raise HTTPException(status_code=400, detail="No text found")

    if len(text) > 4096:
        raise HTTPException(status_code=413, detail="Text is too long to process")

    started = time.perf_counter()
    resp = await get_openai_client().audio.speech.create(
        model="tts-1",
        voice="alloy", # alloy, echo, fable, nova, etc
        input=text,
        response_format="mp3", # mp3 | opus | aac | flac | wav | pcm
    )

    audio_bytes = await resp.aread()
    log_perf("tts: tts=%.2fs chars=%s bytes=%s", time.perf_counter() - started, len(text), len(audio_bytes))
    return Response(content=audio_bytes, media_type="audio/mpeg")
