# Reference brief — sd-youtube: "How would you design a video streaming platform like YouTube?"

## What this question is really testing
Can the candidate reason about **large binary media through its whole lifecycle** — uploading
files that can be tens of gigabytes, processing them into something streamable, and delivering
smooth playback to viewers on wildly varying networks — rather than treating a video like a
big text blob? The three hard problems are the **large/resumable upload**, the **transcoding
pipeline**, and **adaptive delivery at the edge**. Grade the *reasoning about why raw
upload-and-serve fails and what each stage buys you*, not the vocabulary.

## Concept anchors (demonstrated capability, not keywords)
- **Getting the bytes in without melting the app server.** Uploading a multi-GB file *through*
  an application server is the wrong instinct; the capability is uploading **directly to blob
  storage** (pre-signed URL) and, better, **chunked/multipart** uploads so a dropped
  connection **resumes** instead of restarting.
- **Why a raw file can't just be served.** Devices and networks differ, so the video must be
  **transcoded into multiple resolutions/bitrates and split into short segments** — storing
  only the original means playback fails on many clients.
- **Adaptive bitrate streaming.** The client fetches a **manifest** of the available renditions
  and **switches resolution segment-by-segment** as bandwidth changes — this is what delivers
  low-latency, non-stalling playback "even in low-bandwidth environments" (a stated
  requirement). Contrast with downloading the whole file before play (unusable) or fixed-quality
  segments (stalls when the network dips).
- **Delivery via CDN.** Segments and manifests are cached at edge locations near viewers;
  metadata reads for hot videos are cached too, because viral videos create read hotspots.

## Tiered gradation (this is the 1–5 scale — read it, don't invent one)
- **Bad (1–2):** upload the whole file to an app server and store the single original; serve it
  by downloading the entire file before playback; no transcoding, no segmentation, no CDN — a
  design that fails on large files, weak networks, and popular videos alike.
- **Good (3–4):** direct-to-blob upload (pre-signed URL), a transcoding step that produces
  multiple formats, segment-based streaming, and a CDN for delivery. May not cover resumable
  uploads, the parallelism of the processing pipeline, or true bandwidth-adaptive switching.
- **Great (5):** all of Good, **plus** **resumable chunked uploads** with per-chunk status,
  a **parallel/orchestrated transcoding pipeline** (segments processed concurrently, a
  DAG/orchestrator tracking dependencies) rather than one linear encode, genuine **adaptive
  bitrate** driven by a manifest and client-measured throughput, and scaling the read path
  (partitioned metadata store + cache + CDN) with the viral-video hotspot named.

## Leveling bands — the SAME answer clears a different bar
- **Entry:** recognizing that video isn't a normal blob — upload straight to storage, transcode
  to a couple of formats, stream in segments through a CDN — is a strong answer. Resumable
  uploads, pipeline parallelism, and true adaptive switching are bonus; don't penalize their
  absence.
- **Mid:** expected to lay out the full lifecycle unprompted (direct upload -> transcode ->
  segmented streaming -> CDN) and explain *why* transcoding and segmentation exist, and to
  engage with adaptive bitrate when pushed.
- **Senior:** expected to *drive* the depth — resumable chunked uploads, a parallel transcoding
  pipeline and how work is distributed, manifest-driven adaptive streaming, and read-path
  scaling for hot videos. A design that only reaches "Good," or that never explains why raw
  upload-and-serve fails, is **below bar** for senior.

## Tradeoffs worth crediting when the candidate raises them
- Upload through the app server (simple, but wastes bandwidth and bottlenecks) vs. direct-to-blob
  (scales, more moving parts) vs. chunked/multipart (resumable and resilient, most complex).
- Store only the original (cheap, but unplayable across devices) vs. store multiple renditions
  (device coverage, more storage + a processing pipeline) vs. segmented renditions (enables
  adaptive streaming, most complex to produce).
- Whole-file download (trivial, unusable UX) vs. sequential segment download (streams, but
  stalls when bandwidth drops) vs. adaptive bitrate (smooth across changing networks, most
  client complexity).
- Sequential transcoding (simple, far too slow for long videos) vs. parallel segment processing
  with an orchestrator (fast, but coordination and inter-worker file passing to manage).
- CDN + cache for popular content (near-user latency, offloads origin/blob store) at the cost of
  invalidation and cost — with the insight that a few viral videos dominate the read load.
