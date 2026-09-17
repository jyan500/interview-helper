# Reference brief — sd-dropbox: "How would you design a file storage and sync service like Dropbox?"

## What this question is really testing
Can the candidate move very large files (up to tens of GB) in and out reliably, and keep them
**in sync across a user's devices** — without pushing the bytes through their own application
servers and without re-transferring a whole file when one part of it changes? The hard parts
are the **large/resumable upload**, **efficient sync of changes**, and **fast global
download**. Grade the *reasoning about where the bytes flow and how little work each change
costs*, not the vocabulary.

## Concept anchors (demonstrated capability, not keywords)
- **Bytes go straight to blob storage, not through the app server.** The metadata service
  hands out a **pre-signed URL** so the client uploads/downloads directly against object
  storage (e.g. S3); the app server only manages metadata. Recognizing that a 50GB file must
  not round-trip through the backend is the core capability.
- **Chunking + resumability.** The file is split into chunks (multipart upload); each chunk is
  tracked so a dropped connection **resumes** the missing chunks instead of restarting, and
  identical chunks can be **deduplicated** by fingerprint (hash).
- **Sync = a metadata change feed.** A device learns what changed via a "changes since
  timestamp/cursor" query (plus a push channel for immediacy), and only pulls the changed
  chunks — not the whole file. Naming *delta sync* over full re-download is the insight.
- **Fast download** via a CDN in front of blob storage for geographically distributed users,
  with short-lived signed URLs so a leaked link doesn't grant permanent access.

## Tiered gradation (this is the 1–5 scale — read it, don't invent one)
- **Bad (1–2):** upload the whole file through the app server in one request; store one blob;
  re-download the entire file on any change; poll and rescan everything to sync; no story for a
  connection dropping mid-upload.
- **Good (3–4):** direct-to-blob upload via pre-signed URL, client-side chunking, a metadata
  DB, a changes feed for sync, and a CDN for downloads. May not fingerprint chunks for dedup,
  may re-sync a whole file on edit, and may be fuzzy on resumability.
- **Great (5):** all of Good, **plus** **resumable multipart uploads** with per-chunk status
  verified server-side, **chunk-level delta sync** so an edit only moves the affected chunks
  (fingerprint/dedup), a **hybrid push + polling** sync channel with a clear consistency story,
  and access control via short-lived signed URLs — with a stated take on conflict handling
  (e.g. last-write-wins or versioning) even if out of scope.

## Leveling bands — the SAME answer clears a different bar
- **Entry:** direct-to-blob upload, a metadata service, and a changes feed for sync is a strong
  answer. Chunk-level dedup, resumability, and CDN signed URLs are bonus; don't penalize their
  absence.
- **Mid:** expected to introduce chunking and a changes-based sync *unprompted*, keep the bytes
  off the app server, and reason about download latency. Should engage with resumability when
  pushed.
- **Senior:** expected to *drive* the depth — resumable multipart with server-side chunk
  verification, delta sync that avoids re-moving unchanged data, the push-vs-poll sync tradeoff,
  and access-control expiry. A design that only reaches "Good," or that re-transfers whole files
  on edit, is **below bar** for senior.

## Tradeoffs worth crediting when the candidate raises them
- Upload through the app server (simple, but wastes bandwidth and bottlenecks on big files) vs.
  direct-to-blob pre-signed URLs (scales, more moving parts) vs. multipart chunks (resumable and
  dedup-able, most complex).
- Fixed-size chunking (simple; a small edit shifts every downstream boundary) vs.
  content-defined chunking (only chunks near the edit change, so dedup/delta stays effective,
  at more client complexity).
- Push (websocket) sync (immediate, but a dropped connection can miss events) vs. polling a
  changes feed (reliable, higher latency) — the hybrid uses push with polling as a safety net.
- CDN + signed URLs (near-user latency, controlled access) at the cost of CDN spend and
  invalidation on update/delete.
