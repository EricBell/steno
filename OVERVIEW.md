# Steno — Overview

> A self-hosted web app that transcribes video and audio files using OpenAI Whisper, with optional AI summarization via a local Ollama LLM.

## Purpose

Steno lets users upload a video or audio file through a browser UI and receive a full text transcript, with optional timestamps and an AI-generated summary. It runs entirely locally (no cloud API keys required) via Docker. Primary audience appears to be personal/internal use where privacy or cost matters.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | Python 3.11 |
| Web framework | FastAPI (uvicorn) |
| Transcription | faster-whisper (CTranslate2-optimized Whisper) |
| Audio extraction | ffmpeg / ffprobe (shelled out via subprocess) |
| Summarization | Ollama (local LLM, default: llama3.1:8b) |
| Frontend | Vanilla JS + HTML/CSS (no framework, no build step) |
| HTTP client | httpx (async, for Ollama) |
| Data models | Pydantic v2 |
| Package manager | uv |
| Container | Docker / Docker Compose |

## Directory Structure

```
steno/
├── pyproject.toml          # Project metadata & dependencies (version: 0.3.0)
├── uv.lock                 # Locked dependency tree
├── main.py                 # Thin entry point (delegates to whisper/app.py)
├── docker-compose.yml      # Local dev (port 8000, no restart policy)
├── docker-compose.dokploy.yml  # Production (port 3000, restart policy, named volumes)
├── CLAUDE.md               # Dev guidance for Claude Code
└── whisper/
    ├── app.py              # FastAPI app — routes, lifespan, request handling
    ├── transcription.py    # TranscriptionEngine wrapping faster-whisper
    ├── video_processing.py # VideoProcessor using ffmpeg/ffprobe
    ├── ollama_client.py    # OllamaClient — health check + summarization
    ├── models.py           # Pydantic request/response models
    ├── Dockerfile          # Ubuntu 22.04 base, installs Python 3.11 + ffmpeg + uv
    └── static/
        ├── index.html      # Single-page UI (version tag: v0.3.0)
        ├── app.js          # All frontend logic (~373 lines, vanilla JS)
        └── styles.css      # Styling
```

## Architecture

**Single-process, single-service design.** FastAPI serves both the REST API and static frontend from the same process. No reverse proxy; the app binds directly on the configured port.

**Request lifecycle for a transcription:**
1. Browser POSTs multipart form data to `POST /api/transcribe`
2. `app.py` validates file size against `MAX_FILE_SIZE_MB`, streams to a temp file under `/app/temp/`
3. `VideoProcessor.validate_file()` checks the extension whitelist; `get_duration()` shells out to ffprobe
4. `VideoProcessor.extract_audio()` calls ffmpeg: converts to 16kHz mono WAV (required by Whisper)
5. `TranscriptionEngine.transcribe_audio()` runs faster-whisper (`beam_size=1`, VAD filter enabled)
6. If `summarize=true`, `OllamaClient.summarize_transcript()` POSTs to Ollama's `/api/generate`; truncates transcript at 8,000 chars to stay within token limits
7. Both temp files are cleaned up in a `finally` block regardless of outcome

**Frontend dry-run estimate (no upload needed):** On file selection, `app.js` uses `createObjectURL` + a `<video>`/`<audio>` element to read duration client-side. It then estimates processing time using hardcoded model speed factors and checks whether the transcript would fit in Ollama's 128k context window. Transcription only starts when the user clicks "Transcribe."

**Cancellation:** The frontend uses `AbortController` on the fetch request. The request is cancelled at the HTTP level; the server will still finish any in-progress ffmpeg/Whisper work.

**Model loading:** The `WhisperModel` is loaded once at startup in the FastAPI lifespan hook and held as a global instance. There is no request queuing — concurrent uploads would share the same model instance.

## Integrations

| Service | Purpose | Where |
|---------|---------|-------|
| faster-whisper | Speech-to-text transcription (CTranslate2 optimized Whisper) | `whisper/transcription.py` |
| ffmpeg | Audio extraction from video, conversion to 16kHz mono WAV | `whisper/video_processing.py` |
| ffprobe | Duration detection | `whisper/video_processing.py` |
| Ollama | Local LLM summarization; app degrades gracefully if unavailable | `whisper/ollama_client.py` |

Ollama is contacted at `http://ollama:11434` (Docker service name). It must have the model pulled manually — it is not downloaded automatically (`docker exec ollama ollama pull llama3.1:8b`).

## Database & Data Layer

No database. All state is in-memory or transient temp files. Whisper model weights are cached to disk at `/root/.cache/huggingface` (persisted via named volume in the Dokploy compose file).

## Connectivity & Configuration

All configuration is via environment variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `WHISPER_MODEL_SIZE` | `base` | Whisper model: tiny/base/small/medium/large |
| `WHISPER_DEVICE` | `cpu` | `cpu` or `cuda` |
| `WHISPER_COMPUTE_TYPE` | `int8` | Precision: int8/float16/etc |
| `OLLAMA_MODEL` | `llama3.1:8b` | LLM for summarization |
| `OLLAMA_TIMEOUT` | `600` | Seconds before Ollama request times out |
| `MAX_FILE_SIZE_MB` | `500` | Upload size limit; exposed via `GET /api/models` so frontend reads it dynamically |
| `PORT` | `8000` | Listening port (3000 in Dokploy) |

**API endpoints:**
- `GET /` — serves `static/index.html`
- `GET /api/health` — Whisper model + Ollama availability status
- `GET /api/models` — current model, available models, device, max file size
- `POST /api/transcribe` — main transcription endpoint (multipart form)
- `GET /docs` — Swagger UI (FastAPI auto-generated)

## Key Entry Points

1. `whisper/app.py` — start here; covers startup, all routes, and request/error handling
2. `whisper/transcription.py` — Whisper model initialization and audio transcription logic
3. `whisper/video_processing.py` — ffmpeg/ffprobe integration
4. `whisper/static/app.js` — all frontend behavior: file selection, estimate panel, upload, progress, results

## Notes & Gotchas

- **Rebuild required for code changes in Docker.** `whisper/*.py` and `whisper/static/` are copied at build time (`COPY` in Dockerfile), not mounted. Any Python or static file change needs `docker-compose up -d --build`.
- **Version must be updated in three places:** `pyproject.toml`, `index.html` version text, and both `?v=` cache-busting query strings on the `<link>` and `<script>` tags.
- **Two compose files with different ports:** dev uses port 8000; production (`docker-compose.dokploy.yml`) uses port 3000 and adds `restart: unless-stopped` plus named volumes for model persistence.
- **No request queue.** The global `TranscriptionEngine` instance is shared across concurrent requests. Under load, concurrent transcriptions would run simultaneously on the same CPU, degrading performance.
- **Ollama context truncation.** Transcripts longer than 8,000 characters are silently truncated before being sent to Ollama. The frontend warns when the estimated token count may exceed Ollama's 128k context window.
- **CORS is wide open** (`allow_origins=["*"]`) — fine for self-hosted, not for a public-facing deployment.
- **No automated tests** exist in this project (noted in CLAUDE.md).
