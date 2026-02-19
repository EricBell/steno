# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

```bash
# Docker (primary workflow)
docker-compose up -d
docker-compose down

# Rebuild after code changes (Python/static files don't need rebuild — see note below)
docker-compose up -d --build

# Local dev (no Docker)
uv sync
cd whisper && uv run uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

**Important:** The Dockerfile copies `whisper/*.py` and `whisper/static/` at build time. Python and static file changes require a rebuild (`--build`) unless you mount the source as a volume. Env var changes only need a container restart (`down && up -d`).

There are no automated tests in this project.

## Architecture

The app is a single FastAPI service (`whisper/app.py`) that serves both the REST API and the static frontend from the same process.

**Request lifecycle for transcription:**
1. Browser uploads file to `POST /api/transcribe`
2. `app.py` validates size (env: `MAX_FILE_SIZE_MB`) and streams it to a temp file at `/app/temp/`
3. `VideoProcessor.validate_file()` checks extension, `get_duration()` runs ffprobe
4. `VideoProcessor.extract_audio()` shells out to ffmpeg, converting to 16kHz mono WAV — this is required by Whisper
5. `TranscriptionEngine.transcribe_audio()` runs faster-whisper on the WAV
6. Optionally, `OllamaClient.summarize_transcript()` posts the transcript to a local Ollama instance
7. Both temp files are cleaned up in a `finally` block

**Services (docker-compose):**
- `whisper` — the FastAPI app (port 8000 dev / 3000 prod)
- `ollama` — local LLM for summarization (port 11434), optional; app degrades gracefully if unavailable

**Frontend dry-run estimate:** File duration is read client-side via `createObjectURL` + a `<video>`/`<audio>` element — no upload needed. The estimate panel appears after file selection; transcription only starts when the user clicks "Transcribe".

**Config surface (all env vars):**
- `WHISPER_MODEL_SIZE` — tiny/base/small/medium/large (default: base)
- `WHISPER_DEVICE` — cpu/cuda (default: cpu)
- `WHISPER_COMPUTE_TYPE` — int8/float16/etc (default: int8)
- `OLLAMA_MODEL` — default: llama3.1:8b
- `MAX_FILE_SIZE_MB` — default: 500; exposed via `GET /api/models` so the frontend reads it dynamically
- `PORT` — default: 8000

**Versioning:** Version must be updated in three places together:
- `pyproject.toml` → `version = "..."`
- `whisper/static/index.html` → `<p class="version">v...</p>`
- `whisper/static/index.html` → `?v=` query string on both the `<link>` and `<script>` tags (cache-busting)

Policy: increment **minor** for new features, **patch** for bug fixes (e.g. `0.1.0` → `0.2.0` for a feature, `0.1.1` for a fix).

**Two compose files:**
- `docker-compose.yml` — local dev, port 8000, no restart policy, no model volume
- `docker-compose.dokploy.yml` — production (Dokploy), port 3000, `restart: unless-stopped`, named volumes for model cache persistence
