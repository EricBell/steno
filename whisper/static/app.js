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

// New Upload Button
newUploadBtn.addEventListener('click', () => {
    resetUI();
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
        document.getElementById('estimateDuration').textContent = 'Unknown';
        document.getElementById('estimateProcessing').textContent = 'Unknown';
        document.getElementById('estimateWords').textContent = 'Unknown';
        const ollamaEl = document.getElementById('estimateOllama');
        ollamaEl.textContent = 'Unknown';
        ollamaEl.className = 'estimate-value';
    } else {
        const factor = MODEL_SPEED_FACTORS[currentModel] ?? MODEL_SPEED_FACTORS['base'];
        const processingSeconds = duration * factor;
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

// --- Transcription ---

async function startTranscription(file) {
    estimatePanel.classList.add('hidden');
    showProgress();

    const formData = new FormData();
    formData.append('file', file);
    formData.append('include_timestamps', timestampsCheckbox.checked);
    formData.append('summarize', summarizeCheckbox.checked);

    try {
        const response = await fetch('/api/transcribe', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            let errorMsg = `Upload failed: ${response.statusText}`;
            try {
                const errorData = await response.json();
                if (errorData.detail) {
                    errorMsg = errorData.detail;
                }
            } catch (e) {
                // Use default error message
            }
            throw new Error(errorMsg);
        }

        const result = await response.json();
        displayResults(result);
    } catch (error) {
        console.error('Upload error:', error);
        showError(`Error: ${error.message}`);
        hideProgress();
        showDropZone();
    }
}

// Display Results
function displayResults(result) {
    hideProgress();

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
}

function hideProgress() {
    progressDiv.classList.add('hidden');
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
    pendingFile = null;
}

// Error Handling
function showError(message) {
    errorText.textContent = message;
    errorMessage.classList.remove('hidden');
}

function hideError() {
    errorMessage.classList.add('hidden');
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
