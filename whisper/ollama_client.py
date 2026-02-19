import os
import httpx
from typing import Optional
import logging

logger = logging.getLogger(__name__)


class OllamaClient:
    """Client for interacting with Ollama LLM service for summarization."""

    def __init__(self, base_url: str = "http://ollama:11434", model: str = "llama3.1:8b"):
        """
        Initialize Ollama client.

        Args:
            base_url: Base URL for Ollama API
            model: Model name to use for generation
        """
        self.base_url = base_url
        self.model = model
        self.timeout = float(os.getenv("OLLAMA_TIMEOUT", 600))  # default 10 minutes

    async def health_check(self) -> bool:
        """
        Check if Ollama service is available.

        Returns:
            True if service is healthy, False otherwise
        """
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.base_url}/api/tags")
                return response.status_code == 200
        except Exception as e:
            logger.warning(f"Ollama health check failed: {e}")
            return False

    async def summarize_transcript(self, transcript: str) -> Optional[str]:
        """
        Generate a summary of the transcript using Ollama.

        Args:
            transcript: Full transcript text to summarize

        Returns:
            Summary text if successful, None if failed
        """
        if not transcript or len(transcript.strip()) < 50:
            logger.warning("Transcript too short to summarize")
            return None

        prompt = self._build_summarization_prompt(transcript)

        try:
            logger.info("Requesting summary from Ollama")
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.base_url}/api/generate",
                    json={
                        "model": self.model,
                        "prompt": prompt,
                        "stream": False
                    }
                )

                if response.status_code != 200:
                    logger.error(f"Ollama API error: {response.status_code} - {response.text}")
                    return None

                result = response.json()
                summary = result.get("response", "").strip()

                if summary:
                    logger.info("Summary generated successfully")
                    return summary
                else:
                    logger.warning("Empty summary received from Ollama")
                    return None

        except httpx.TimeoutException:
            logger.error("Ollama request timed out")
            return None
        except Exception as e:
            logger.error(f"Failed to generate summary: {e}")
            return None

    @staticmethod
    def _build_summarization_prompt(transcript: str) -> str:
        """
        Build prompt for summarization.

        Args:
            transcript: Full transcript text

        Returns:
            Formatted prompt string
        """
        # Truncate very long transcripts to avoid token limits
        max_chars = 8000
        if len(transcript) > max_chars:
            transcript = transcript[:max_chars] + "..."

        prompt = f"""Please provide a concise summary of the following transcript. Focus on the main points, key topics discussed, and important takeaways. Keep the summary clear and well-organized.

Transcript:
{transcript}

Summary:"""

        return prompt

    async def list_models(self) -> Optional[list]:
        """
        List available models in Ollama.

        Returns:
            List of model names if successful, None if failed
        """
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.base_url}/api/tags")

                if response.status_code == 200:
                    data = response.json()
                    models = [model["name"] for model in data.get("models", [])]
                    return models
                else:
                    return None
        except Exception as e:
            logger.error(f"Failed to list Ollama models: {e}")
            return None
