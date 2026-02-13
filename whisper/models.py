from typing import Optional, List
from pydantic import BaseModel, Field


class TranscriptionSegment(BaseModel):
    """Individual segment of transcription with timing information."""
    start: float = Field(..., description="Start time in seconds")
    end: float = Field(..., description="End time in seconds")
    text: str = Field(..., description="Transcribed text for this segment")


class TranscriptionRequest(BaseModel):
    """Request parameters for transcription."""
    include_timestamps: bool = Field(default=False, description="Include timestamp information in segments")
    summarize: bool = Field(default=False, description="Generate AI summary using Ollama")
    language: Optional[str] = Field(default=None, description="Language code (e.g., 'en', 'es'). Auto-detect if not provided.")


class TranscriptionResponse(BaseModel):
    """Response containing transcription results."""
    text: str = Field(..., description="Complete transcription text")
    language: str = Field(..., description="Detected or specified language code")
    duration: float = Field(..., description="Duration of audio/video in seconds")
    model: str = Field(..., description="Whisper model used (e.g., 'base', 'small')")
    segments: Optional[List[TranscriptionSegment]] = Field(default=None, description="Timestamped segments if requested")
    summary: Optional[str] = Field(default=None, description="AI-generated summary if requested")


class HealthResponse(BaseModel):
    """Health check response."""
    status: str = Field(..., description="Service status")
    model: str = Field(..., description="Loaded Whisper model")
    ollama_available: bool = Field(..., description="Whether Ollama service is available")


class ModelInfo(BaseModel):
    """Information about available models."""
    current_model: str = Field(..., description="Currently loaded model")
    available_models: List[str] = Field(..., description="List of available Whisper models")
    device: str = Field(..., description="Computation device (cpu or cuda)")
    compute_type: str = Field(..., description="Compute type (int8, float16, etc.)")
