"""Who is calling? — Supabase JWT verification. Phase B. SCAFFOLD: fill in the TODOs.

THE DIVISION OF LABOUR, which is the whole idea of this phase:

    the SPA  ──► supabase.auth.signInWithPassword(email, password)  ──► Supabase Auth
                                                                          │ issues
    the SPA  ◄──────────────── a signed JWT (access_token) ◄───────────────┘
    the SPA  ──► Authorization: Bearer <jwt> ──► FastAPI ──► THIS MODULE ──► user_id

We never see a password, never store one, never reset one. Supabase Auth owns identity
(`auth.users`); this backend only ever answers ONE question about a request: *which user
id is this?* — and it answers it from a signature, not from a database lookup. Nothing
here queries Postgres. That's what makes a JWT worth using: the token carries the claim,
and the maths proves it wasn't forged.

WHY A PUBLIC KEY AND NOT A SHARED SECRET (verified against this project, 2026-08-10):

    GET https://<ref>.supabase.co/auth/v1/.well-known/jwks.json
    -> {"keys":[{"kty":"EC","crv":"P-256","alg":"ES256","kid":"7be2ac95-…", …}]}

This project signs tokens ASYMMETRICALLY (ES256): Supabase holds the private key, and
publishes the matching PUBLIC key at that URL. So this backend needs **no secret at all**
to verify a token — which is why `server/.env` has `SUPABASE_URL` and nothing else for
auth. (Older Supabase projects used one shared HS256 secret, which every verifier also
needed to SIGN with — i.e. every service that could check a token could also mint one.
Ours can't. Keep this file on the JWKS path; if you ever see `"alg": "HS256"` in a token
header, the project got rolled back to legacy keys.)

WHAT "VERIFY" ACTUALLY MEANS HERE — four checks, and skipping any one of them is a hole:
    signature   the token was minted by the holder of the private key   (not forged)
    exp         it hasn't expired            (Supabase access tokens live ~1 hour)
    aud         it's an end-user token, audience "authenticated"        (not a service key)
    iss         it came from OUR project, `<SUPABASE_URL>/auth/v1`      (not someone else's
                Supabase project — anyone can spin one up and hand you a perfectly valid
                token signed by THEIR key)

THE CLAIM WE KEEP is `sub`: the auth user's UUID. That is the same value as `profiles.id`
(see the Profile model's note on why it isn't a surrogate int) and the same value
`auth.uid()` returns inside an RLS policy. One id, three places, no mapping table.

Run (from server/) to prove it end to end with a real token — sign in from the SPA, copy
the access_token out of devtools, and:
    .venv/Scripts/python.exe -m auth <paste-the-token>
"""
from __future__ import annotations

import os

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

# load_dotenv already ran (db.engine / pydantic_agent do it on import), but this module is
# also runnable on its own via `python -m auth`, so read the env defensively.
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
if not SUPABASE_URL:
    from pathlib import Path

    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent / ".env")
    SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")

# The two constants the checks above compare against. `aud` is the literal string Supabase
# puts in every signed-in user's token; `iss` is our project's auth endpoint.
JWT_AUDIENCE = "authenticated"
JWT_ISSUER = f"{SUPABASE_URL}/auth/v1"
JWKS_URL = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json"

# ---------------------------------------------------------------------------
# The key source. ONE client for the process, built at import — it CACHES the fetched key
# set (`lifespan=300`, so it re-fetches at most every 5 minutes), which is what keeps
# verification a local maths operation instead of an HTTP call per request.
#
# HONEST ABOUT THE ONE WART: PyJWKClient fetches over urllib — a BLOCKING call — and we use
# it from async routes. It only actually fires on a cold cache or a key rotation, so in
# practice it's one ~100ms stall every five minutes rather than per request. If that ever
# shows up in latency, the fix is `await asyncio.to_thread(...)` around the lookup, not a
# different library.
# ---------------------------------------------------------------------------
_jwks_client = jwt.PyJWKClient(JWKS_URL, cache_keys=True, lifespan=300)


# ===========================================================================
# WORKED EXAMPLE — the verification itself. Plain function, no FastAPI: it takes a token
# string and returns the claims, so it's testable from `python -m auth` with no server
# running (and so the dependency below stays about HTTP, not about cryptography).
#
# Raises jwt.PyJWTError (or one of its subclasses: ExpiredSignatureError,
# InvalidAudienceError, InvalidIssuerError, …) on ANY failed check. Deliberately does not
# catch: turning a failure into an HTTP status is the caller's job, one layer up.
# ===========================================================================
def decode_supabase_jwt(token: str) -> dict:
    """Verify a Supabase access token and return its claims."""
    # 1. WHICH key? A JWKS can hold several (that's how key rotation works without
    #    downtime), so the token's header names one by `kid`. get_signing_key_from_jwt
    #    reads that header and hands back the matching public key — from cache if warm.
    signing_key = _jwks_client.get_signing_key_from_jwt(token)

    # 2. verify. `algorithms` is a WHITELIST, and it is a security control, not a hint:
    #    without it an attacker can re-sign the token with an algorithm of their choosing
    #    (the classic "alg: none" / HS256-with-the-public-key-as-secret confusion attacks).
    #    Passing audience/issuer makes PyJWT enforce those claims instead of us remembering
    #    to compare them afterwards; `exp` is checked by default.
    return jwt.decode(
        token,
        signing_key.key,
        algorithms=["ES256"],
        audience=JWT_AUDIENCE,
        issuer=JWT_ISSUER,
    )


# ===========================================================================
# THE FASTAPI DEPENDENCY — the only thing routes import.
#
# `HTTPBearer` is FastAPI's parser for the `Authorization: Bearer <token>` header. Note
# `auto_error=False`: by default it raises 403 on a missing header, and we want 401 for
# BOTH "no token" and "bad token" — 401 means "authenticate", 403 means "you're
# authenticated and still not allowed", which is the /api/answer ownership case below.
# It also puts the padlock + "Authorize" button in /docs, so you can try routes there.
# ===========================================================================
_bearer = HTTPBearer(auto_error=False)


async def require_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> str:
    """FastAPI dependency: the signed-in user's id, or 401.

    Used as `user_id: str = Depends(require_user)` on a route — FastAPI runs this first,
    and the route body only ever executes for a verified caller.

    A NOTE ON WHAT THIS FUNCTION DELIBERATELY DOESN'T DO: it never checks the profiles
    table. The row is created by the signup trigger (see the migration), so "the JWT is
    valid" already implies "the profile exists" — adding a SELECT here would buy a DB
    round-trip on every single request to re-confirm something the database guarantees.
    """
    sub = None
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, 
            detail="Missing Bearer Token",
            headers={"WWW-Authenticate": "Bearer"}
        )
    try:
        claims = decode_supabase_jwt(credentials.credentials)
        sub = claims.get("sub")

    except jwt.PyJWKClientConnectionError:
        raise HTTPException(
            status_code=503,
            detail="Could not verify token right now, please try again",
            headers={"Retry-After": "120"}
        )
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, 
            detail="Invalid Token",
            headers={"WWW-Authenticate": "Bearer"}
        )


    if not sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, 
            detail="Invalid Token",
            headers={"WWW-Authenticate": "Bearer"}
        )

    return sub


# ===========================================================================
# OWNERSHIP — the check that authentication alone does NOT give you.
#
# Knowing WHO is calling is not the same as knowing they may touch THIS interview.
# `interview_id` is a uuid4 hex slug, so nobody guesses one — but "unguessable" is not an
# access control, and the moment Phase C lists interviews the ids stop being secret anyway.
# ===========================================================================
def require_ownership(interview_profile_id, user_id: str) -> None:
    """Assert this user owns this interview, else 403/401.

    Called from a route AFTER loading the interview, with the row's `profile_id`.

    """
    if not interview_profile_id or str(interview_profile_id) != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot be accessed",
        )

if __name__ == "__main__":
    # Smoke test with no server and no DB: paste a real access_token from the SPA.
    # In devtools: Application -> Local Storage -> the `sb-<ref>-auth-token` entry.
    import sys

    print("JWKS:", JWKS_URL)
    print("issuer:", JWT_ISSUER)
    if len(sys.argv) < 2:
        print("\nusage: python -m auth <access_token>")
        raise SystemExit(1)

    token = sys.argv[1]
    # unverified header first — it tells you the `alg` and `kid` before any checking, which
    # is exactly what you want when a verification failure is confusing.
    print("header:", jwt.get_unverified_header(token))
    claims = decode_supabase_jwt(token)
    print("sub:", claims.get("sub"), "| email:", claims.get("email"), "| exp:", claims.get("exp"))
