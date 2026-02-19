import os
import tempfile
from pathlib import Path
from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from models import (
    TranscriptionResponse,
    TranscriptionSegment,
    HealthResponse,
    ModelInfo
)
from transcription import TranscriptionEngine
from video_processing import VideoProcessor
from ollama_client import OllamaClient

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Global instances
transcription_engine = None
video_processor = None
ollama_client = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize services on startup."""
    global transcription_engine, video_processor, ollama_client

    # Get configuration from environment
    model_size = os.getenv("WHISPER_MODEL_SIZE", "base")
    device = os.getenv("WHISPER_DEVICE", "cpu")
    compute_type = os.getenv("WHISPER_COMPUTE_TYPE", "int8")

    # Initialize services
    logger.info("Initializing transcription engine...")
    transcription_engine = TranscriptionEngine(
        model_size=model_size,
        device=device,
        compute_type=compute_type
    )

    logger.info("Initializing video processor...")
    temp_dir = "/app/temp"
    Path(temp_dir).mkdir(parents=True, exist_ok=True)
    video_processor = VideoProcessor(temp_dir=temp_dir)

    logger.info("Initializing Ollama client...")
    ollama_model = os.getenv("OLLAMA_MODEL", "llama3.1:8b")
    ollama_client = OllamaClient(model=ollama_model)

    logger.info("All services initialized successfully")

    yield

    # Cleanup on shutdown
    logger.info("Shutting down services...")


# Create FastAPI app
app = FastAPI(
    title="Video Transcription API",
    description="Web-based video transcription using OpenAI Whisper",
    version="0.1.0",
    lifespan=lifespan
)

# Add CORS middleware for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
async def read_root():
    """Serve the main web UI."""
    return FileResponse("static/index.html")


@app.get("/api/health", response_model=HealthResponse)
async def health_check():
    """
    Health check endpoint.

    Returns service status and availability of components.
    """
    ollama_available = await ollama_client.health_check()

    model_info = transcription_engine.get_model_info()

    return HealthResponse(
        status="healthy",
        model=model_info["model"],
        ollama_available=ollama_available
    )


@app.get("/api/models", response_model=ModelInfo)
async def get_models():
    """
    Get information about available Whisper models.

    Returns current model and list of available models.
    """
    model_info = transcription_engine.get_model_info()
    available_models = transcription_engine.get_available_models()

    return ModelInfo(
        current_model=model_info["model"],
        available_models=available_models,
        device=model_info["device"],
        compute_type=model_info["compute_type"],
        max_file_size_mb=int(os.getenv("MAX_FILE_SIZE_MB", 500))
    )


@app.post("/api/transcribe", response_model=TranscriptionResponse)
async def transcribe_video(
    file: UploadFile = File(..., description="Video or audio file to transcribe"),
    include_timestamps: bool = Form(default=False, description="Include timestamp information"),
    summarize: bool = Form(default=False, description="Generate AI summary using Ollama"),
    language: str = Form(default=None, description="Language code (e.g., 'en', 'es'). Auto-detect if not provided.")
):
    """
    Transcribe a video or audio file to text.

    Accepts video/audio files, extracts audio, and uses Whisper for transcription.
    Optionally includes timestamps and generates AI summary.
    """
    uploaded_file_path = None
    audio_file_path = None

    try:
        # Validate file size
        max_file_size_mb = int(os.getenv("MAX_FILE_SIZE_MB", 500))
        max_size = max_file_size_mb * 1024 * 1024
        file.file.seek(0, 2)  # Seek to end
        file_size = file.file.tell()
        file.file.seek(0)  # Reset to beginning

        if file_size > max_size:
            raise HTTPException(
                status_code=413,
                detail=f"File too large. Maximum size is {max_file_size_mb}MB. Your file: {file_size / (1024*1024):.1f}MB"
            )

        logger.info(f"Received file: {file.filename} ({file_size / (1024*1024):.2f}MB)")

        # Save uploaded file to temp directory
        with tempfile.NamedTemporaryFile(delete=False, suffix=Path(file.filename).suffix) as tmp:
            uploaded_file_path = tmp.name
            content = await file.read()
            tmp.write(content)

        logger.info(f"Saved uploaded file to {uploaded_file_path}")

        # Validate file format
        if not video_processor.validate_file(uploaded_file_path):
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file format: {Path(file.filename).suffix}"
            )

        # Get video duration
        duration = video_processor.get_duration(uploaded_file_path)
        logger.info(f"Video duration: {duration:.2f}s")

        # Extract audio
        logger.info("Extracting audio...")
        audio_file_path = video_processor.extract_audio(uploaded_file_path)

        # Transcribe
        logger.info("Starting transcription...")
        transcript, segments, metadata = transcription_engine.transcribe_audio(
            audio_file_path,
            language=language,
            include_timestamps=include_timestamps
        )

        logger.info(f"Transcription complete. Text length: {len(transcript)} characters")

        # Convert segments to response model if present
        segment_models = None
        if segments:
            segment_models = [
                TranscriptionSegment(
                    start=seg["start"],
                    end=seg["end"],
                    text=seg["text"]
                )
                for seg in segments
            ]

        # Generate summary if requested
        summary = None
        if summarize:
            logger.info("Generating summary...")
            ollama_available = await ollama_client.health_check()

            if ollama_available:
                summary = await ollama_client.summarize_transcript(transcript)
                if summary:
                    logger.info("Summary generated successfully")
                else:
                    logger.warning("Failed to generate summary")
            else:
                logger.warning("Ollama service not available, skipping summarization")

        # Build response
        response = TranscriptionResponse(
            text=transcript,
            language=metadata["language"],
            duration=duration if duration > 0 else metadata["duration"],
            model=transcription_engine.model_size,
            segments=segment_models,
            summary=summary
        )

        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Transcription error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")

    finally:
        # Cleanup temporary files
        if uploaded_file_path:
            video_processor.cleanup(uploaded_file_path)
        if audio_file_path:
            video_processor.cleanup(audio_file_path)


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """Global exception handler for unexpected errors."""
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "An unexpected error occurred. Please try again."}
    )


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
