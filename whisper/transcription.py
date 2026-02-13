import os
from typing import Tuple, List, Optional, Dict, Any
from faster_whisper import WhisperModel
import logging

logger = logging.getLogger(__name__)


class TranscriptionEngine:
    """Handles audio transcription using faster-whisper."""

    def __init__(
        self,
        model_size: str = "base",
        device: str = "cpu",
        compute_type: str = "int8"
    ):
        """
        Initialize the transcription engine with faster-whisper.

        Args:
            model_size: Size of Whisper model ('tiny', 'base', 'small', 'medium', 'large')
            device: Computation device ('cpu' or 'cuda')
            compute_type: Computation type ('int8', 'int16', 'float16', 'float32')
        """
        self.model_size = model_size
        self.device = device
        self.compute_type = compute_type

        logger.info(f"Loading Whisper model: {model_size} on {device} with {compute_type}")

        try:
            self.model = WhisperModel(
                model_size,
                device=device,
                compute_type=compute_type
            )
            logger.info("Whisper model loaded successfully")
        except Exception as e:
            logger.error(f"Failed to load Whisper model: {e}")
            raise

    def transcribe_audio(
        self,
        audio_path: str,
        language: Optional[str] = None,
        include_timestamps: bool = False
    ) -> Tuple[str, Optional[List[Dict[str, Any]]], Dict[str, Any]]:
        """
        Transcribe audio file to text.

        Args:
            audio_path: Path to audio file (preferably WAV, 16kHz, mono)
            language: Language code (e.g., 'en', 'es'). Auto-detect if None.
            include_timestamps: Whether to include timestamp information

        Returns:
            Tuple of:
                - Full transcript text
                - List of segments with timestamps (if include_timestamps=True), None otherwise
                - Metadata dictionary (language, duration, etc.)

        Raises:
            FileNotFoundError: If audio file doesn't exist
            RuntimeError: If transcription fails
        """
        if not os.path.exists(audio_path):
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        logger.info(f"Starting transcription of {audio_path}")

        try:
            # Transcribe with faster-whisper
            segments, info = self.model.transcribe(
                audio_path,
                language=language,
                beam_size=5,
                word_timestamps=include_timestamps
            )

            # Process segments
            full_text = []
            segment_list = []

            for segment in segments:
                text = segment.text.strip()

                if include_timestamps:
                    # Format with timestamps: [HH:MM:SS] Text
                    timestamp = self._format_timestamp(segment.start)
                    full_text.append(f"[{timestamp}] {text}")

                    # Add to segment list
                    segment_list.append({
                        "start": segment.start,
                        "end": segment.end,
                        "text": text
                    })
                else:
                    full_text.append(text)

            # Join all text
            transcript = " ".join(full_text) if not include_timestamps else "\n".join(full_text)

            # Extract metadata
            metadata = {
                "language": info.language,
                "language_probability": info.language_probability,
                "duration": info.duration,
                "all_language_probs": info.all_language_probs
            }

            logger.info(
                f"Transcription complete. Language: {info.language}, "
                f"Duration: {info.duration:.2f}s"
            )

            return transcript, segment_list if include_timestamps else None, metadata

        except Exception as e:
            logger.error(f"Transcription failed: {e}")
            raise RuntimeError(f"Transcription error: {str(e)}")

    @staticmethod
    def _format_timestamp(seconds: float) -> str:
        """
        Format seconds to HH:MM:SS timestamp.

        Args:
            seconds: Time in seconds

        Returns:
            Formatted timestamp string
        """
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)

        if hours > 0:
            return f"{hours:02d}:{minutes:02d}:{secs:02d}"
        else:
            return f"{minutes:02d}:{secs:02d}"

    def get_available_models(self) -> List[str]:
        """
        Get list of available Whisper models.

        Returns:
            List of model names
        """
        return ["tiny", "base", "small", "medium", "large-v1", "large-v2", "large-v3"]

    def get_model_info(self) -> Dict[str, str]:
        """
        Get information about current model configuration.

        Returns:
            Dictionary with model info
        """
        return {
            "model": self.model_size,
            "device": self.device,
            "compute_type": self.compute_type
        }
