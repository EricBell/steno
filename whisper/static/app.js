// Config (fetched from server)
let maxFileSizeMb = 500; // fallback default
let currentModel = 'base'; // fallback default

fetch('/api/models')
    .then(r => r.json())
    .then(data => {
        if (data.max_file_size_mb) maxFileSizeMb = data.max_file_size_mb;
        if (data.current_model) currentModel = data.current_model;
    })
    .catch(() => {});

// Estimate constants
const MODEL_SPEED_FACTORS = { tiny: 0.5, base: 4.0, small: 6.7, medium: 12.5, large: 25.0 };
const OLLAMA_CONTEXT_TOKENS = 128000;
const WORDS_PER_MINUTE = 130;
const TOKENS_PER_WORD = 1.3;

// Pending file (set after estimate, consumed on transcribe)
let pendingFile = null;
let abortController = null;
let progressInterval = null;
let estimatedSeconds = 0;
let currentSourceFile = null;

// DOM Elements
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const selectFileBtn = document.getElementById('selectFileBtn');
const optionsDiv = document.getElementById('options');
const estimatePanel = document.getElementById('estimatePanel');
const transcribeBtn = document.getElementById('transcribeBtn');
const progressDiv = document.getElementById('progress');
const resultsDiv = document.getElementById('results');
const errorMessage = document.getElementById('errorMessage');
const errorText = document.getElementById('errorText');
const transcriptDiv = document.getElementById('transcript');
const summarySection = document.getElementById('summarySection');
const summaryText = document.getElementById('summaryText');
const copyBtn = document.getElementById('copyBtn');
const newUploadBtn = document.getElementById('newUploadBtn');
const timestampsCheckbox = document.getElementById('timestamps');
const summarizeCheckbox = document.getElementById('summarize');
const cancelBtn = document.getElementById('cancelBtn');
const shareBtn = document.getElementById('shareBtn');
const progressBarFill = document.getElementById('progressBarFill');
const progressStats = document.getElementById('progressStats');

// Drag and Drop Handlers
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');

    const files = e.dataTransfer.files;
    if (files.length > 0) {
        handleFileSelect(files[0]);
    }
});

dropZone.addEventListener('click', () => {
    fileInput.click();
});

// File Selector Button
selectFileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
});

fileInput.addEventListener('change', (e) => {
    const files = e.target.files;
    if (files.length > 0) {
        handleFileSelect(files[0]);
    }
});

// Transcribe Button
transcribeBtn.addEventListener('click', () => {
    if (pendingFile) {
        startTranscription(pendingFile);
    }
});

// Copy to Clipboard
copyBtn.addEventListener('click', () => {
    const text = transcriptDiv.textContent;
    navigator.clipboard.writeText(text).then(() => {
        const originalText = copyBtn.innerHTML;
        copyBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
            Copied!
        `;
        setTimeout(() => {
            copyBtn.innerHTML = originalText;
        }, 2000);
    }).catch((err) => {
        showError('Failed to copy to clipboard: ' + err.message);
    });
});

// Share Button
shareBtn.addEventListener('click', () => shareDialog.showModal());

// New Upload Button
newUploadBtn.addEventListener('click', () => {
    resetUI();
});

cancelBtn.addEventListener('click', () => {
    if (abortController) abortController.abort();
});

// --- File Selection: validate + show estimate ---

async function handleFileSelect(file) {
    if (!file.type.startsWith('video/') && !file.type.startsWith('audio/')) {
        showError('Please select a video or audio file. Unsupported file type: ' + file.type);
        return;
    }

    const maxSize = maxFileSizeMb * 1024 * 1024;
    if (file.size > maxSize) {
        showError(`File is too large. Maximum size is ${maxFileSizeMb}MB. Your file: ` + formatFileSize(file.size));
        return;
    }

    hideError();
    pendingFile = file;
    await showEstimatePanel(file);
}

// --- Estimate Panel ---

function getFileDuration(file) {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const el = file.type.startsWith('audio/') ? new Audio() : document.createElement('video');
        el.preload = 'metadata';
        el.onloadedmetadata = () => {
            URL.revokeObjectURL(url);
            resolve(isFinite(el.duration) ? el.duration : null);
        };
        el.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(null);
        };
        el.src = url;
    });
}

async function showEstimatePanel(file) {
    const duration = await getFileDuration(file);

    if (duration == null) {
        estimatedSeconds = 0;
        document.getElementById('estimateDuration').textContent = 'Unknown';
        document.getElementById('estimateProcessing').textContent = 'Unknown';
        document.getElementById('estimateWords').textContent = 'Unknown';
        const ollamaEl = document.getElementById('estimateOllama');
        ollamaEl.textContent = 'Unknown';
        ollamaEl.className = 'estimate-value';
    } else {
        const factor = MODEL_SPEED_FACTORS[currentModel] ?? MODEL_SPEED_FACTORS['base'];
        const processingSeconds = duration * factor;
        estimatedSeconds = processingSeconds;
        const words = Math.round((duration / 60) * WORDS_PER_MINUTE);
        const tokens = Math.round(words * TOKENS_PER_WORD);

        document.getElementById('estimateDuration').textContent = formatDuration(duration);
        document.getElementById('estimateProcessing').textContent = formatDuration(processingSeconds) + ' (approx)';
        document.getElementById('estimateWords').textContent =
            `~${words.toLocaleString()} words (~${tokens.toLocaleString()} tokens)`;

        const ollamaEl = document.getElementById('estimateOllama');
        const pct = Math.round((tokens / OLLAMA_CONTEXT_TOKENS) * 100);
        if (tokens > OLLAMA_CONTEXT_TOKENS) {
            ollamaEl.textContent = `${tokens.toLocaleString()} / ${OLLAMA_CONTEXT_TOKENS.toLocaleString()} — may exceed context`;
            ollamaEl.className = 'estimate-value warn';
        } else {
            ollamaEl.textContent = `${tokens.toLocaleString()} / ${OLLAMA_CONTEXT_TOKENS.toLocaleString()} (${pct}%)`;
            ollamaEl.className = 'estimate-value ok';
        }
    }

    estimatePanel.classList.remove('hidden');
}

// --- Share System ---

// Each entry is a connector: { id, label, icon (SVG string), run(text, baseName) }
// To add a new destination, append an object following this shape.
const SHARE_DESTINATIONS = [
    {
        id: 'file',
        label: 'File',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>`,
        async run(text, baseName) {
            const values = await showConfigDialog({
                title: 'Save to File',
                fields: [{ id: 'filename', label: 'Filename', value: baseName, type: 'text' }],
                submitLabel: 'Save'
            });
            await saveToFile(text, values.filename);
        }
    },
    {
        id: 'email',
        label: 'Email',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>`,
        async run(text, baseName) {
            const values = await showConfigDialog({
                title: 'Send via Email',
                fields: [{ id: 'email', label: 'Email address', value: 'eric@polymorph.co', type: 'email' }],
                submitLabel: 'Send'
            });
            const subject = encodeURIComponent('Transcript: ' + baseName.replace(/\.txt$/, ''));
            const body = encodeURIComponent(text);
            window.location.href = `mailto:${values.email}?subject=${subject}&body=${body}`;
        }
    }
];

// Generic per-connector config prompt. Resolves with { fieldId: value } or rejects on cancel.
function showConfigDialog({ title, fields, submitLabel }) {
    return new Promise((resolve, reject) => {
        const dialog = document.createElement('dialog');
        dialog.className = 'config-dialog';
        dialog.innerHTML = `
            <div class="config-dialog-inner">
                <h3>${title}</h3>
                ${fields.map(f => `
                    <div class="config-field">
                        <label>${f.label}</label>
                        <input type="${f.type}" data-field-id="${f.id}" value="${f.value || ''}">
                    </div>
                `).join('')}
                <div class="config-dialog-actions">
                    <button class="config-cancel-btn">Cancel</button>
                    <button class="config-submit-btn">${submitLabel}</button>
                </div>
            </div>
        `;
        document.body.appendChild(dialog);

        const cleanup = () => dialog.remove();

        dialog.querySelector('.config-cancel-btn').addEventListener('click', () => {
            cleanup();
            reject(new DOMException('Cancelled', 'AbortError'));
        });

        dialog.querySelector('.config-submit-btn').addEventListener('click', () => {
            const values = {};
            fields.forEach(f => {
                values[f.id] = dialog.querySelector(`[data-field-id="${f.id}"]`).value;
            });
            cleanup();
            resolve(values);
        });

        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) {
                cleanup();
                reject(new DOMException('Cancelled', 'AbortError'));
            }
        });

        dialog.showModal();
        const first = dialog.querySelector('input');
        if (first) first.focus();
    });
}

async function saveToFile(text, filename) {
    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: filename,
                startIn: 'videos',
                types: [{ description: 'Text file', accept: { 'text/plain': ['.txt'] } }]
            });
            const writable = await handle.createWritable();
            await writable.write(text);
            await writable.close();
        } catch (err) {
            if (err.name !== 'AbortError') showError('Failed to save file: ' + err.message);
        }
    } else {
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }
}

const shareDialog = document.getElementById('shareDialog');

(function buildShareDialog() {
    const container = document.getElementById('shareDestinations');
    SHARE_DESTINATIONS.forEach(dest => {
        const card = document.createElement('button');
        card.className = 'share-card';
        card.innerHTML = `${dest.icon}<span class="share-card-label">${dest.label}</span>`;
        card.addEventListener('click', async () => {
            shareDialog.close();
            const text = transcriptDiv.textContent;
            const baseName = currentSourceFile
                ? currentSourceFile.replace(/\.[^/.]+$/, '') + '.txt'
                : 'transcript.txt';
            try {
                await dest.run(text, baseName);
            } catch (err) {
                if (err.name !== 'AbortError') showError('Share failed: ' + err.message);
            }
        });
        container.appendChild(card);
    });
})();

shareDialog.querySelector('.share-dialog-close').addEventListener('click', () => shareDialog.close());
shareDialog.addEventListener('click', (e) => { if (e.target === shareDialog) shareDialog.close(); });

// --- Transcription ---

function startProgressAnimation(estimatedSecs) {
    const startTime = Date.now();
    progressBarFill.style.width = '0%';
    progressStats.textContent = '0% · 0s elapsed';
    progressInterval = setInterval(() => {
        const elapsedSec = (Date.now() - startTime) / 1000;
        const pct = estimatedSecs > 0
            ? Math.min(90, (elapsedSec / estimatedSecs) * 90)
            : Math.min(90, elapsedSec * 2);
        progressBarFill.style.width = pct.toFixed(1) + '%';
        progressStats.textContent = `${Math.round(pct)}% · ${formatDuration(elapsedSec)} elapsed`;
    }, 500);
}

function stopProgressAnimation(finalPct) {
    if (progressInterval !== null) {
        clearInterval(progressInterval);
        progressInterval = null;
    }
    if (finalPct != null) {
        progressBarFill.style.width = finalPct + '%';
    }
}

async function startTranscription(file) {
    currentSourceFile = file.name;
    hideError();
    estimatePanel.classList.add('hidden');
    showProgress();
    startProgressAnimation(estimatedSeconds);
    abortController = new AbortController();

    const formData = new FormData();
    formData.append('file', file);
    formData.append('include_timestamps', timestampsCheckbox.checked);
    formData.append('summarize', summarizeCheckbox.checked);

    const startTime = Date.now();
    try {
        const response = await fetch('/api/transcribe', {
            method: 'POST',
            body: formData,
            signal: abortController.signal
        });

        if (!response.ok) {
            let errorMsg = `Upload failed: ${response.statusText}`;
            try {
                const errorData = await response.json();
                if (errorData.detail) errorMsg = errorData.detail;
            } catch (e) {}
            throw new Error(errorMsg);
        }

        const elapsed = Date.now() - startTime;
        const result = await response.json();
        stopProgressAnimation(100);
        progressStats.textContent = '100% · complete';
        await new Promise(resolve => setTimeout(resolve, 400));
        displayResults(result, elapsed);
    } catch (error) {
        if (error.name === 'AbortError') {
            stopProgressAnimation(0);
            hideProgress();
            estimatePanel.classList.remove('hidden');
            showInfo('Transcription cancelled.');
        } else {
            stopProgressAnimation(0);
            console.error('Upload error:', error);
            showError(`Error: ${error.message}`);
            hideProgress();
            showDropZone();
        }
    } finally {
        abortController = null;
    }
}

// Display Results
function displayResults(result, elapsedMs) {
    hideProgress();

    if (elapsedMs != null) {
        const totalSecs = Math.round(elapsedMs / 1000);
        const mins = Math.floor(totalSecs / 60);
        const secs = totalSecs % 60;
        const label = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
        document.getElementById('transcriptionTime').textContent = `Transcribed in ${label}`;
    }

    transcriptDiv.textContent = result.text;

    if (result.summary) {
        summaryText.textContent = result.summary;
        summarySection.classList.remove('hidden');
    } else {
        summarySection.classList.add('hidden');
    }

    resultsDiv.classList.remove('hidden');
}

// UI State Management
function showProgress() {
    dropZone.classList.add('hidden');
    optionsDiv.classList.add('hidden');
    progressDiv.classList.remove('hidden');
    resultsDiv.classList.add('hidden');
    cancelBtn.classList.remove('hidden');
}

function hideProgress() {
    progressDiv.classList.add('hidden');
    cancelBtn.classList.add('hidden');
    stopProgressAnimation(null);
}

function showDropZone() {
    dropZone.classList.remove('hidden');
    optionsDiv.classList.remove('hidden');
}

function resetUI() {
    dropZone.classList.remove('hidden');
    optionsDiv.classList.remove('hidden');
    estimatePanel.classList.add('hidden');
    progressDiv.classList.add('hidden');
    resultsDiv.classList.add('hidden');
    hideError();
    fileInput.value = '';
    transcriptDiv.textContent = '';
    summaryText.textContent = '';
    document.getElementById('transcriptionTime').textContent = '';
    stopProgressAnimation(null);
    abortController = null;
    estimatedSeconds = 0;
    progressBarFill.style.width = '0%';
    progressStats.textContent = '';
    cancelBtn.classList.add('hidden');
    pendingFile = null;
    currentSourceFile = null;
}

// Error Handling
function showError(message) {
    errorMessage.classList.remove('info');
    errorText.textContent = message;
    errorMessage.classList.remove('hidden');
}

function showInfo(message) {
    errorMessage.classList.add('info');
    errorText.textContent = message;
    errorMessage.classList.remove('hidden');
}

function hideError() {
    errorMessage.classList.add('hidden');
    errorMessage.classList.remove('info');
}

// Utility Functions
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function formatDuration(seconds) {
    if (seconds == null) return 'Unknown';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}
