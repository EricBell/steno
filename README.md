# Video Transcription App

A web-based application for transcribing video and audio files using OpenAI's Whisper model. Simply drag and drop a video file or select one from your computer to get an accurate text transcript.

## Features

- **Simple Web Interface**: Clean, modern UI with drag-and-drop functionality
- **Multiple File Formats**: Supports MP4, AVI, MKV, MOV, WebM, FLV, WMV, and more
- **Audio Files**: Also works with MP3, WAV, FLAC, M4A, OGG, AAC, and other audio formats
- **Timestamps**: Optional timestamp markers in transcript (e.g., `[00:01:23] Text here`)
- **AI Summarization**: Optional AI-generated summary using Ollama (if available)
- **Fast Processing**: Uses faster-whisper for 4x speed improvement over standard Whisper
- **Copy to Clipboard**: Easy one-click copy of transcript text
- **Responsive Design**: Works on desktop, tablet, and mobile devices

## Quick Start

### Prerequisites

- Docker and Docker Compose
- For GPU support (optional): NVIDIA GPU with drivers installed

### Running the Application

1. Clone this repository:
   ```bash
   git clone <repository-url>
   cd steno
   ```

2. Start the services:
   ```bash
   docker-compose up -d
   ```

3. Open your browser and navigate to:
   ```
   http://localhost:8000
   ```

4. Upload a video or audio file:
   - Drag and drop a file onto the upload zone, OR
   - Click "Select File" to browse your files

5. Wait for processing (approximately 15 seconds per minute of video)

6. View your transcript and optionally copy it to clipboard

### Stopping the Application

```bash
docker-compose down
```

## Usage

### Web UI

The web interface is the primary way to use this application:

1. **Upload**: Drag and drop or select a video/audio file
2. **Options**:
   - Check "Include Timestamps" for timestamp markers
   - Check "Generate AI Summary" for an AI summary (requires Ollama)
3. **Process**: Wait while the video is transcribed
4. **Results**: View transcript, copy to clipboard, or download

### API Usage (Advanced)

You can also use the REST API directly:

#### Transcribe a video:
```bash
curl -X POST http://localhost:8000/api/transcribe \
  -F "file=@video.mp4" \
  -F "include_timestamps=false" \
  -F "summarize=false"
```

#### Health check:
```bash
curl http://localhost:8000/api/health
```

#### View API documentation:
Open http://localhost:8000/docs in your browser for interactive API documentation (Swagger UI).

## Supported Formats

### Video Formats
- MP4, AVI, MKV, MOV, WebM, FLV, WMV
- M4V, MPG, MPEG, 3GP, OGV

### Audio Formats
- MP3, WAV, FLAC, M4A, OGG
- AAC, WMA, OPUS

## Configuration

The application can be configured via environment variables in `docker-compose.yml`:

### Whisper Service Configuration

- `WHISPER_MODEL_SIZE`: Model size (`tiny`, `base`, `small`, `medium`, `large`)
  - Default: `base`
  - Larger models are more accurate but slower

- `WHISPER_DEVICE`: Computation device (`cpu` or `cuda`)
  - Default: `cpu`

- `WHISPER_COMPUTE_TYPE`: Precision (`int8`, `int16`, `float16`, `float32`)
  - Default: `int8`
  - Lower precision is faster with minimal accuracy loss

- `MAX_FILE_SIZE_MB`: Maximum upload file size in megabytes
  - Default: `500`
  - Example: set to `2048` to allow files up to 2GB

### Ollama Service Configuration

- `OLLAMA_MODEL`: LLM model for summarization
  - Default: `llama3.1:8b`

## Performance

Processing speed depends on video length and chosen model:

- **Base model (CPU)**: ~0.25x realtime (4 minutes to process 1 minute of video)
- **Small model (CPU)**: ~0.15x realtime (7 minutes per minute of video)
- **Medium model (CPU)**: ~0.08x realtime (12 minutes per minute of video)

Examples:
- 5-minute video: ~20 seconds (base model)
- 30-minute video: ~2 minutes (base model)
- 1-hour video: ~4 minutes (base model)

GPU processing is significantly faster but requires NVIDIA GPU support.

## File Size Limits

The default maximum file size is 500MB. To change it, set `MAX_FILE_SIZE_MB` in `docker-compose.yml`:

```yaml
environment:
  - MAX_FILE_SIZE_MB=2048  # 2GB
```

## Architecture

This application consists of two services:

1. **Whisper Service** (port 8000): Handles video transcription
   - FastAPI web server
   - Serves web UI and REST API
   - Uses faster-whisper for transcription
   - Uses ffmpeg for audio extraction

2. **Ollama Service** (port 11434): Optional LLM for summarization
   - Provides AI summarization of transcripts
   - GPU-accelerated (if available)

## Development

### Local Development with uv

To run locally without Docker:

```bash
# Install dependencies
uv sync

# Run the application
cd whisper
uv run uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

### Project Structure

```
steno/
├── whisper/                    # Main application directory
│   ├── app.py                 # FastAPI application
│   ├── transcription.py       # Whisper integration
│   ├── video_processing.py    # Video/audio processing
│   ├── models.py              # Pydantic data models
│   ├── ollama_client.py       # LLM client for summarization
│   ├── Dockerfile             # Container configuration
│   └── static/                # Frontend files
│       ├── index.html         # Web UI
│       ├── styles.css         # Styling
│       └── app.js             # JavaScript logic
├── docker-compose.yml         # Service orchestration
├── pyproject.toml             # Python dependencies
├── uv.lock                    # Lockfile
└── README.md                  # This file
```

## Troubleshooting

### Container won't start
```bash
docker-compose logs whisper
```

### Transcription fails
- Check file format is supported
- Ensure file size is within the configured `MAX_FILE_SIZE_MB` limit
- Check container logs for errors

### Ollama summarization not working
- Check if Ollama service is running: `docker-compose ps`
- Verify Ollama health: `curl http://localhost:11434/api/tags`
- GPU support may be required for Ollama

### Processing is very slow
- Consider using a smaller model (e.g., `tiny` or `base`)
- Ensure adequate CPU resources are available
- For faster processing, use GPU support if available

## License

This project uses OpenAI's Whisper model. Please refer to Whisper's license for usage terms.

## Credits

- [OpenAI Whisper](https://github.com/openai/whisper) - Speech recognition model
- [faster-whisper](https://github.com/guillaumekln/faster-whisper) - Optimized implementation
- [FastAPI](https://fastapi.tiangolo.com/) - Web framework
- [Ollama](https://ollama.ai/) - Local LLM for summarization
