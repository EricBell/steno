// DOM Elements
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const selectFileBtn = document.getElementById('selectFileBtn');
const optionsDiv = document.getElementById('options');
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
        handleFileUpload(files[0]);
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
        handleFileUpload(files[0]);
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

// Main Upload Handler
async function handleFileUpload(file) {
    // Validate file
    if (!file.type.startsWith('video/') && !file.type.startsWith('audio/')) {
        showError('Please select a video or audio file. Unsupported file type: ' + file.type);
        return;
    }

    // Check file size (max 500MB)
    const maxSize = 500 * 1024 * 1024; // 500MB in bytes
    if (file.size > maxSize) {
        showError('File is too large. Maximum size is 500MB. Your file: ' + formatFileSize(file.size));
        return;
    }

    // Hide error message
    hideError();

    // Show progress
    showProgress();

    // Prepare form data
    const formData = new FormData();
    formData.append('file', file);
    formData.append('include_timestamps', timestampsCheckbox.checked);
    formData.append('summarize', summarizeCheckbox.checked);

    try {
        // Upload to API
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

    // Display transcript
    transcriptDiv.textContent = result.text;

    // Display summary if available
    if (result.summary) {
        summaryText.textContent = result.summary;
        summarySection.classList.remove('hidden');
    } else {
        summarySection.classList.add('hidden');
    }

    // Show results
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
    progressDiv.classList.add('hidden');
    resultsDiv.classList.add('hidden');
    hideError();
    fileInput.value = '';
    transcriptDiv.textContent = '';
    summaryText.textContent = '';
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
