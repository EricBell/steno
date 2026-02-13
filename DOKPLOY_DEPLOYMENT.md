# Deploying to Dokploy VPS

This guide covers deploying the Video Transcription app to your Dokploy VPS.

## Prerequisites

- Dokploy installed on your VPS
- Domain name pointed to your VPS
- Sufficient disk space (~5GB for models)
- Adequate RAM (minimum 4GB recommended, 8GB+ ideal)
- CPU with decent performance (transcription is CPU-intensive)

## Deployment Steps

### 1. Push Code to Git Repository

Dokploy deploys from Git repositories. Push your code to GitHub/GitLab/etc:

```bash
cd /home/eric/workspace/original/steno
git add .
git commit -m "Prepare for Dokploy deployment"
git push origin main
```

### 2. Create New Application in Dokploy

1. Log into your Dokploy dashboard
2. Click "Create Application"
3. Choose "Docker Compose" as the application type
4. Connect your Git repository
5. Set the branch (usually `main` or `master`)

### 3. Configure Docker Compose File

In Dokploy, you have two options:

**Option A: Use the Dokploy-specific file**
- Upload `docker-compose.dokploy.yml` as your compose file
- Or rename it to `docker-compose.yml` in your repo

**Option B: Use the existing docker-compose.yml with these changes:**

Replace the network section and add labels. See the changes below.

### 4. Update Domain in Traefik Labels

Edit the docker-compose file and replace `your-domain.com` with your actual domain:

```yaml
labels:
  - "traefik.http.routers.whisper.rule=Host(`transcribe.yourdomain.com`)"
```

### 5. Key Configuration Changes for Dokploy

#### Remove Custom Network Name
**Before:**
```yaml
networks:
  app-network:
    name: ytsummarizer_app-network
```

**After:**
```yaml
# Let Dokploy manage networks automatically
# No need to define networks
```

#### Add Persistent Volumes
The Dokploy config adds these volumes to persist data:

```yaml
volumes:
  whisper-models:   # Persist downloaded Whisper models (saves re-downloading)
  whisper-temp:     # Temporary upload directory
  ollama-data:      # Persist Ollama models
```

#### Add Traefik Labels (Already in dokploy config)
These labels enable automatic HTTPS and routing:

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.whisper.rule=Host(`your-domain.com`)"
  - "traefik.http.routers.whisper.entrypoints=websecure"
  - "traefik.http.routers.whisper.tls.certresolver=letsencrypt"
  - "traefik.http.services.whisper.loadbalancer.server.port=8000"
  - "traefik.http.middlewares.whisper-timeout.timeout.request=30m"
  - "traefik.http.routers.whisper.middlewares=whisper-timeout"
```

#### Add Restart Policies
```yaml
restart: unless-stopped
```

### 6. Environment Variables (Optional)

In Dokploy UI, you can set these environment variables:

```
WHISPER_MODEL_SIZE=base          # tiny, base, small, medium, large
WHISPER_DEVICE=cpu               # cpu or cuda (if GPU available)
WHISPER_COMPUTE_TYPE=int8        # int8, int16, float16, float32
PORT=8000
```

### 7. File Upload Size Limits

For large video files, you may need to configure Nginx/Traefik limits:

**Add to your Dokploy Traefik configuration:**
```yaml
# In Dokploy's Traefik static config
http:
  middlewares:
    limit:
      buffering:
        maxRequestBodyBytes: 524288000  # 500MB
```

Or add this label to the whisper service:
```yaml
- "traefik.http.middlewares.limit.buffering.maxRequestBodyBytes=524288000"
- "traefik.http.routers.whisper.middlewares=whisper-timeout,limit"
```

### 8. Deploy!

1. Click "Deploy" in Dokploy
2. Wait for the build to complete (~5-10 minutes first time)
3. Dokploy will automatically:
   - Build your Docker images
   - Set up SSL certificates via Let's Encrypt
   - Configure routing via Traefik
   - Start your services

### 9. First-Time Setup (After Deployment)

#### Download Whisper Model (Automatic)
The Whisper model downloads automatically on first transcription. No action needed.

#### Pull Ollama Model (If using summarization)
```bash
# SSH into your VPS
ssh user@your-vps.com

# Access the ollama container
docker exec -it ollama ollama pull llama3.1:8b

# This downloads ~4.7GB, takes a few minutes
```

### 10. Access Your Application

Once deployed, access at:
```
https://your-domain.com
```

SSL certificate is automatic via Let's Encrypt!

## Important Considerations for VPS Deployment

### 1. **Resource Requirements**

**Minimum:**
- 2 CPU cores
- 4GB RAM
- 10GB disk space

**Recommended:**
- 4+ CPU cores (faster transcription)
- 8GB+ RAM (especially if using Ollama)
- 20GB+ disk space

**Processing Speed on VPS:**
- Base model: ~0.25x realtime (4 min to process 1 min of video)
- Small model: ~0.15x realtime (7 min per min of video)
- Speed depends heavily on CPU performance

### 2. **Disk Space**

Models to download:
- Whisper base model: ~150MB
- Whisper small model: ~500MB
- Ollama llama3.1:8b: ~4.7GB
- Temporary video uploads: varies by usage

### 3. **Security Considerations**

**Add Basic Authentication (Optional):**

Create a `.htpasswd` file:
```bash
# Install htpasswd
apt-get install apache2-utils

# Create password file
htpasswd -c .htpasswd admin
```

Add to Traefik labels:
```yaml
- "traefik.http.middlewares.whisper-auth.basicauth.usersfile=/.htpasswd"
- "traefik.http.routers.whisper.middlewares=whisper-timeout,whisper-auth"
```

**File Upload Validation:**
- Max file size enforced in code: 500MB
- Supported formats validated server-side
- Temp files cleaned up automatically

### 4. **Monitoring**

Check logs via Dokploy UI or SSH:
```bash
# View logs
docker logs -f whisper

# Check resource usage
docker stats whisper
```

### 5. **Scaling Considerations**

**If transcription is slow:**
1. Upgrade to a bigger VPS
2. Use `tiny` model (faster, less accurate)
3. Consider GPU-enabled VPS for 10-20x speedup

**If multiple users:**
- Current setup handles one transcription at a time
- For concurrent users, consider adding job queue (future enhancement)

### 6. **Backup**

Important volumes to backup:
```bash
# Backup Whisper models (avoid re-downloading)
docker run --rm -v whisper-models:/data -v $(pwd):/backup \
  alpine tar czf /backup/whisper-models.tar.gz /data

# Backup Ollama models (avoid re-downloading 4.7GB)
docker run --rm -v ollama-data:/data -v $(pwd):/backup \
  alpine tar czf /backup/ollama-data.tar.gz /data
```

## Troubleshooting

### Build Fails
```bash
# Check Dokploy build logs
# Common issues:
# - Out of memory during build
# - Docker Hub rate limits
```

### Service Won't Start
```bash
# Check container logs in Dokploy
# Common issues:
# - Port already in use
# - Insufficient memory
# - Model download failed
```

### Transcription Timeouts
```bash
# Increase timeout in Traefik labels:
- "traefik.http.middlewares.whisper-timeout.timeout.request=60m"
```

### Out of Disk Space
```bash
# Clean up Docker
docker system prune -a
docker volume prune

# Remove old temp files
docker exec -it whisper rm -rf /app/temp/*
```

## Testing After Deployment

1. **Check health:**
   ```bash
   curl https://your-domain.com/api/health
   ```

2. **Test web UI:**
   Open browser to `https://your-domain.com`

3. **Upload test video:**
   Try a short 30-second video to verify transcription works

4. **Check Ollama (if enabled):**
   ```bash
   curl https://your-domain.com/api/health
   # Should show "ollama_available": true
   ```

## Cost Considerations

**VPS Hosting:**
- $5-10/month: Basic VPS (works but slow)
- $20-40/month: Good performance
- $50+/month: Fast transcription

**vs Cloud APIs:**
- OpenAI Whisper API: ~$0.006/minute
- Advantage: Host yourself = unlimited transcriptions at fixed cost

## Updates and Maintenance

### Update Application:
1. Push code changes to Git
2. Click "Redeploy" in Dokploy
3. Dokploy rebuilds and restarts automatically

### Update Models:
```bash
# Whisper models update automatically
# For Ollama:
docker exec -it ollama ollama pull llama3.1:8b
```

## Summary

**What you need to change:**
1. ✅ Use `docker-compose.dokploy.yml` (provided)
2. ✅ Update domain in Traefik labels
3. ✅ Push to Git repository
4. ✅ Deploy via Dokploy UI

**What Dokploy handles automatically:**
- SSL certificates (Let's Encrypt)
- Domain routing (Traefik)
- Container orchestration
- Automatic restarts
- Log management

**After deployment:**
- Access at `https://your-domain.com`
- Pull Ollama model if needed
- Test with a sample video

That's it! Your transcription app will be live on your VPS with HTTPS! 🚀
