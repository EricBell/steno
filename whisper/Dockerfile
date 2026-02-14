# Use Ubuntu base image for CPU processing
FROM ubuntu:22.04

# Set environment variables
ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3.11 \
    python3-pip \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:$PATH"

# Set working directory
WORKDIR /app

# Copy project files from parent directory
COPY pyproject.toml .
COPY uv.lock* .

# Install dependencies using uv
RUN uv sync --frozen --no-dev

# Copy application code from whisper directory
COPY whisper/*.py .
COPY whisper/static/ ./static/

# Create temp directory for file uploads
RUN mkdir -p /app/temp

# Expose port
# EXPOSE 8000   # read from the env var now.

# Run with uv (uses PORT env var from app.py)
CMD ["uv", "run", "python", "app.py"]
