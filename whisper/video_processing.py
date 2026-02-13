import subprocess
import os
import tempfile
from pathlib import Path
from typing import Optional
import logging

logger = logging.getLogger(__name__)


class VideoProcessor:
    """Handles video/audio file processing using ffmpeg."""

    SUPPORTED_VIDEO_FORMATS = {
        '.mp4', '.avi', '.mkv', '.mov', '.webm', '.flv', '.wmv',
        '.m4v', '.mpg', '.mpeg', '.3gp', '.ogv'
    }

    SUPPORTED_AUDIO_FORMATS = {
        '.mp3', '.wav', '.flac', '.m4a', '.ogg', '.aac', '.wma', '.opus'
    }

    def __init__(self, temp_dir: Optional[str] = None):
        """
        Initialize VideoProcessor.

        Args:
            temp_dir: Directory for temporary files. Uses system temp if not specified.
        """
        self.temp_dir = temp_dir or tempfile.gettempdir()
        Path(self.temp_dir).mkdir(parents=True, exist_ok=True)

    def validate_file(self, file_path: str) -> bool:
        """
        Validate if file format is supported.

        Args:
            file_path: Path to the file

        Returns:
            True if file format is supported, False otherwise
        """
        ext = Path(file_path).suffix.lower()
        return ext in self.SUPPORTED_VIDEO_FORMATS or ext in self.SUPPORTED_AUDIO_FORMATS

    def extract_audio(self, video_path: str) -> str:
        """
        Extract audio from video file and convert to WAV format (16kHz, mono).

        Whisper expects audio in 16kHz mono format for optimal performance.

        Args:
            video_path: Path to input video/audio file

        Returns:
            Path to extracted audio file (WAV format)

        Raises:
            RuntimeError: If ffmpeg extraction fails
        """
        if not os.path.exists(video_path):
            raise FileNotFoundError(f"Video file not found: {video_path}")

        # Create output path in temp directory
        output_path = os.path.join(
            self.temp_dir,
            f"{Path(video_path).stem}_audio.wav"
        )

        # ffmpeg command to extract audio
        # -vn: no video
        # -acodec pcm_s16le: 16-bit PCM audio codec
        # -ar 16000: 16kHz sample rate (Whisper's expected format)
        # -ac 1: mono audio (1 channel)
        cmd = [
            'ffmpeg',
            '-i', video_path,
            '-vn',  # No video
            '-acodec', 'pcm_s16le',  # PCM 16-bit
            '-ar', '16000',  # 16kHz sample rate
            '-ac', '1',  # Mono
            '-y',  # Overwrite output file
            output_path
        ]

        try:
            logger.info(f"Extracting audio from {video_path}")
            result = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=True
            )
            logger.info(f"Audio extracted successfully to {output_path}")
            return output_path
        except subprocess.CalledProcessError as e:
            error_msg = e.stderr.decode('utf-8') if e.stderr else str(e)
            logger.error(f"ffmpeg error: {error_msg}")
            raise RuntimeError(f"Failed to extract audio: {error_msg}")

    def get_duration(self, video_path: str) -> float:
        """
        Get duration of video/audio file in seconds using ffprobe.

        Args:
            video_path: Path to video/audio file

        Returns:
            Duration in seconds

        Raises:
            RuntimeError: If ffprobe fails to get duration
        """
        cmd = [
            'ffprobe',
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            video_path
        ]

        try:
            result = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=True,
                text=True
            )
            duration = float(result.stdout.strip())
            return duration
        except (subprocess.CalledProcessError, ValueError) as e:
            logger.warning(f"Could not get duration for {video_path}: {e}")
            return 0.0

    def cleanup(self, file_path: str) -> None:
        """
        Remove temporary file.

        Args:
            file_path: Path to file to remove
        """
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
                logger.info(f"Cleaned up temporary file: {file_path}")
        except Exception as e:
            logger.warning(f"Failed to cleanup file {file_path}: {e}")
