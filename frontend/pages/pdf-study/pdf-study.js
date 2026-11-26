/* ============================================================
   STUDYREADER — PDF STUDY WORKSPACE & PERSISTENT AI TUTOR
   High-performance document rendering with text layer,
   multi-turn conversational grounding, structured summaries,
   and natural voice Read Aloud.
   ============================================================ */

(function () {
  "use strict";

  const API_BASE_URL = window.API_BASE_URL || "http://127.0.0.1:3000";

/* ============================================================
   PDF.JS CONFIGURATION
   ============================================================ */

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

/* ============================================================
   DOM ELEMENTS
   ============================================================ */

const pdfTitle = document.getElementById("pdf-title");
const pdfStatus = document.getElementById("pdf-status");
const canvas = document.getElementById("pdf-canvas");
const canvasContainer = document.getElementById("pdf-canvas-container");
const pageWrapper = document.getElementById("pdf-page-wrapper");
const textLayerDiv = document.getElementById("pdf-text-layer");
const viewerToolbar = document.getElementById("pdf-viewer-toolbar");
const documentText = document.getElementById("document-text");
const loadingMessage = document.getElementById("pdf-loading");
const errorMessage = document.getElementById("pdf-error");

const previousButton = document.getElementById("previous-page");
const nextButton = document.getElementById("next-page");
const currentPageInput = document.getElementById("current-page");
const totalPagesElement = document.getElementById("total-pages");

const zoomLevel = document.getElementById("zoom-level");
const zoomInButton = document.getElementById("zoom-in");
const zoomOutButton = document.getElementById("zoom-out");
const fitWidthButton = document.getElementById("fit-width");
const backToLibrary = document.getElementById("back-to-library");
const btnSwitchDoc = document.getElementById("btn-switch-doc");

const pdfEmptySelection = document.getElementById("pdf-empty-selection");
const btnEmptyChooseLibrary = document.getElementById("btn-empty-choose-library");
const btnEmptyUploadDoc = document.getElementById("btn-empty-upload-doc");

const selectionPopup = document.getElementById("pdf-selection-popup");
const btnExplainSelection = document.getElementById("btn-explain-selection");
const btnCopySelection = document.getElementById("btn-copy-selection");

// AI Panel Elements & Controls
const documentAiPanel = document.getElementById("document-ai-panel");
const documentAiTitle = document.getElementById("document-ai-title");
const documentAiStatus = document.getElementById("document-ai-status");
const btnCloseAiPanel = document.getElementById("btn-close-ai-panel");
const aiPanelResizer = document.getElementById("ai-panel-resizer");
const btnExpandAiPanel = document.getElementById("btn-expand-ai-panel");
const btnFullscreenAiPanel = document.getElementById("btn-fullscreen-ai-panel");
const btnReturnToPdf = document.getElementById("btn-return-to-pdf");
const expandIcon = document.getElementById("expand-icon");
const expandText = document.getElementById("expand-text");
const fullscreenIcon = document.getElementById("fullscreen-icon");
const fullscreenText = document.getElementById("fullscreen-text");

// AI Views
const aiChatView = document.getElementById("ai-chat-view");
const chatThread = document.getElementById("chat-thread");
const chatChipsContainer = document.getElementById("chat-chips-container");
const chatInput = document.getElementById("chat-input");
const chatSendBtn = document.getElementById("chat-send-btn");
const chatClearBtn = document.getElementById("chat-clear-btn");

const aiSummaryView = document.getElementById("ai-summary-view");
const summaryContent = document.getElementById("summary-content");
const summaryAudioBar = document.getElementById("summary-audio-bar");

const aiOverviewView = document.getElementById("ai-overview-view");
const overviewContent = document.getElementById("overview-content");

const aiExplainView = document.getElementById("ai-explain-view");
const explainNotice = document.getElementById("explain-selection-notice");
const explainSelectedPreview = document.getElementById("explain-selected-preview");
const explainContent = document.getElementById("explain-content");

// Modals
const modalLibraryPicker = document.getElementById("modal-library-picker");
const libraryPickerSearch = document.getElementById("library-picker-search");
const libraryPickerLoading = document.getElementById("library-picker-loading");
const libraryPickerEmpty = document.getElementById("library-picker-empty");
const libraryPickerList = document.getElementById("library-picker-list");
const btnOpenUploadFromPicker = document.getElementById("btn-open-upload-from-picker");

const modalWorkspaceUpload = document.getElementById("modal-workspace-upload");
const formWorkspaceUpload = document.getElementById("form-workspace-upload");
const selectWorkspaceSubject = document.getElementById("select-workspace-subject");
const selectWorkspaceCategory = document.getElementById("select-workspace-category");
const inputWorkspaceFile = document.getElementById("input-workspace-file");
const workspaceUploadStatus = document.getElementById("workspace-upload-status");
const btnSubmitWorkspaceUpload = document.getElementById("btn-submit-workspace-upload");

// Read Aloud Elements
const readAloudPanel = document.getElementById("read-aloud-panel");
const btnCloseReadAloud = document.getElementById("btn-close-read-aloud");
const readAloudElements = {
  progress: document.getElementById("read-aloud-progress"),
  play: document.getElementById("read-aloud-play"),
  pause: document.getElementById("read-aloud-pause"),
  stop: document.getElementById("read-aloud-stop"),
  previous: document.getElementById("read-aloud-previous"),
  next: document.getElementById("read-aloud-next"),
  voice: document.getElementById("read-aloud-voice"),
  speed: document.getElementById("read-aloud-speed"),
  all: document.getElementById("read-aloud-all"),
  error: document.getElementById("read-aloud-error")
};

/* ============================================================
   SHARED INLINE SPEECH CONTROLLER (AI CHAT & SUMMARIES)
   ============================================================ */

const StudyReaderInlineSpeech = (() => {
  let state = "idle"; // "idle" | "playing" | "paused"
  let ownerId = null; // ID of active audio session (e.g. chat message id or "summary")
  let sentences = [];
  let currentIndex = 0;
  let rate = 1.0;
  let isCancelling = false;
  let activeUiUpdater = null; // function(state, ownerId)

  function splitIntoSentences(text) {
    if (!text) return [];
    const cleaned = window.StudyReaderSpeechNormalizer
      ? window.StudyReaderSpeechNormalizer.normalize(text)
      : text.replace(/[*#`_>-]/g, " ").replace(/\s+/g, " ");

    const protectedText = cleaned
      .replace(/\b(\d+)\.\s+/g, "$1: ")
      .replace(/\b(e\.g\.|i\.e\.|etc\.)/gi, (m) => m.replace(/\./g, ""));

    const rawParts = protectedText.match(/[^.!?\n\r]+[.!?]+|[^.!?\n\r]+$/g) || [protectedText];
    const result = [];
    for (const part of rawParts) {
      const trimmed = part.trim();
      if (trimmed.length > 0) {
        if (trimmed.length > 250) {
          const subParts = trimmed.match(/[^,;:]+[,;:]+|[^,;:]+$/g) || [trimmed];
          for (const sub of subParts) {
            const subTrimmed = sub.trim();
            if (subTrimmed.length > 0) result.push(subTrimmed);
          }
        } else {
          result.push(trimmed);
        }
      }
    }
    return result;
  }

  function notifyUi() {
    if (typeof activeUiUpdater === "function") {
      try {
        activeUiUpdater(state, ownerId);
      } catch (err) {
        console.warn("Error updating speech UI:", err);
      }
    }
  }

  function speakCurrentSentence() {
    if (state !== "playing") return;
    if (currentIndex >= sentences.length) {
      stop();
      return;
    }
    if (!("speechSynthesis" in window)) {
      stop();
      return;
    }

    const sentence = sentences[currentIndex];
    const utterance = new SpeechSynthesisUtterance(sentence);
    utterance.rate = Math.max(0.5, Math.min(2.0, rate));

    utterance.onend = () => {
      if (isCancelling) return;
      if (state === "playing") {
        currentIndex++;
        speakCurrentSentence();
      }
    };

    utterance.onerror = (e) => {
      if (isCancelling) return;
      if (e.error === "interrupted" || e.error === "canceled") return;
      console.warn("Speech error on sentence:", e);
      if (state === "playing") {
        currentIndex++;
        speakCurrentSentence();
      }
    };

    window.speechSynthesis.speak(utterance);
  }

  function play(newOwnerId, rawText, newRate = 1.0, uiUpdater = null) {
    if (ownerId && (ownerId !== newOwnerId || state !== "idle")) {
      stop();
    }

    // Stop document-level read-aloud toolbar if running
    if (window.StudyReaderReadAloud && typeof window.StudyReaderReadAloud.stop === "function") {
      try { window.StudyReaderReadAloud.stop(); } catch (_) {}
    }

    ownerId = newOwnerId;
    rate = Number(newRate) || 1.0;
    activeUiUpdater = uiUpdater;
    sentences = splitIntoSentences(rawText);
    currentIndex = 0;

    if (sentences.length === 0) {
      stop();
      return;
    }

    state = "playing";
    notifyUi();
    speakCurrentSentence();
  }

  function pause() {
    if (state !== "playing") return;
    state = "paused";
    isCancelling = true;
    if ("speechSynthesis" in window) {
      try { window.speechSynthesis.cancel(); } catch (_) {}
    }
    isCancelling = false;
    notifyUi();
  }

  function resume() {
    if (state !== "paused") return;
    state = "playing";
    notifyUi();
    speakCurrentSentence();
  }

  function stop() {
    isCancelling = true;
    if ("speechSynthesis" in window) {
      try { window.speechSynthesis.cancel(); } catch (_) {}
    }
    isCancelling = false;
    state = "idle";
    currentIndex = 0;
    notifyUi();
    ownerId = null;
    activeUiUpdater = null;
    sentences = [];
  }

  function setRate(newRate) {
    rate = Number(newRate) || 1.0;
    if (state === "playing") {
      isCancelling = true;
      if ("speechSynthesis" in window) {
        try { window.speechSynthesis.cancel(); } catch (_) {}
      }
      isCancelling = false;
      speakCurrentSentence();
    }
  }

  return {
    play,
    pause,
    resume,
    stop,
    setRate,
    getState: () => state,
    getOwnerId: () => ownerId
  };
})();

function stopAllSpeechAudio() {
  if (window.StudyReaderListenPlayer && typeof window.StudyReaderListenPlayer.stop === "function") {
    try {
      window.StudyReaderListenPlayer.stop();
    } catch (_) {}
  }
  if (StudyReaderInlineSpeech) {
    try {
      StudyReaderInlineSpeech.stop();
    } catch (_) {}
  }
  if ("speechSynthesis" in window) {
    try {
      window.speechSynthesis.cancel();
    } catch (_) {}
  }
  if (window.StudyReaderReadAloud && typeof window.StudyReaderReadAloud.stop === "function") {
    try {
      window.StudyReaderReadAloud.stop();
    } catch (_) {}
  }
  if (readAloudPanel) {
    readAloudPanel.hidden = true;
    readAloudPanel.style.display = "none";
  }
}

function attachInlineAudioControls({ container, ownerId, getText, initialRate = 1.0, showCopy = false, showPrint = false }) {
  container.innerHTML = "";

  const controlsWrapper = document.createElement("div");
  controlsWrapper.className = "inline-audio-controls";
  controlsWrapper.style.display = "inline-flex";
  controlsWrapper.style.alignItems = "center";
  controlsWrapper.style.gap = "6px";
  controlsWrapper.style.flexWrap = "wrap";

  const btnListen = document.createElement("button");
  btnListen.type = "button";
  btnListen.className = "chat-bubble-action-btn";
  btnListen.innerHTML = "<span>🔊</span> Listen";

  const btnPause = document.createElement("button");
  btnPause.type = "button";
  btnPause.className = "chat-bubble-action-btn";
  btnPause.innerHTML = "<span>⏸</span> Pause";
  btnPause.style.display = "none";

  const btnResume = document.createElement("button");
  btnResume.type = "button";
  btnResume.className = "chat-bubble-action-btn";
  btnResume.innerHTML = "<span>▶</span> Resume";
  btnResume.style.display = "none";

  const btnStop = document.createElement("button");
  btnStop.type = "button";
  btnStop.className = "chat-bubble-action-btn";
  btnStop.innerHTML = "<span>⏹</span> Stop";
  btnStop.style.display = "none";

  const speedSelect = document.createElement("select");
  speedSelect.className = "chat-bubble-speed-select";
  [
    { label: "0.75x", val: 0.75 },
    { label: "1x", val: 1.0, selected: initialRate === 1.0 },
    { label: "1.25x", val: 1.25, selected: initialRate === 1.25 },
    { label: "1.5x", val: 1.5, selected: initialRate === 1.5 },
    { label: "2x", val: 2.0, selected: initialRate === 2.0 }
  ].forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt.val;
    o.textContent = opt.label;
    if (opt.selected) o.selected = true;
    speedSelect.appendChild(o);
  });

  function updateUi(state, currentOwnerId) {
    if (currentOwnerId !== ownerId || state === "idle") {
      btnListen.style.display = "inline-flex";
      btnPause.style.display = "none";
      btnResume.style.display = "none";
      btnStop.style.display = "none";
    } else if (state === "playing") {
      btnListen.style.display = "none";
      btnPause.style.display = "inline-flex";
      btnResume.style.display = "none";
      btnStop.style.display = "inline-flex";
    } else if (state === "paused") {
      btnListen.style.display = "none";
      btnPause.style.display = "none";
      btnResume.style.display = "inline-flex";
      btnStop.style.display = "inline-flex";
    }
  }

  btnListen.addEventListener("click", () => {
    const text = typeof getText === "function" ? getText() : getText;
    const r = parseFloat(speedSelect.value) || 1.0;
    StudyReaderInlineSpeech.play(ownerId, text, r, updateUi);
  });

  btnPause.addEventListener("click", () => {
    StudyReaderInlineSpeech.pause();
  });

  btnResume.addEventListener("click", () => {
    StudyReaderInlineSpeech.resume();
  });

  btnStop.addEventListener("click", () => {
    StudyReaderInlineSpeech.stop();
  });

  speedSelect.addEventListener("change", () => {
    const r = parseFloat(speedSelect.value) || 1.0;
    if (StudyReaderInlineSpeech.getOwnerId() === ownerId) {
      StudyReaderInlineSpeech.setRate(r);
    }
  });

  controlsWrapper.appendChild(btnListen);
  controlsWrapper.appendChild(btnPause);
  controlsWrapper.appendChild(btnResume);
  controlsWrapper.appendChild(btnStop);
  controlsWrapper.appendChild(speedSelect);

  if (showCopy) {
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "chat-bubble-action-btn";
    copyBtn.innerHTML = "<span>📋</span> Copy";
    copyBtn.addEventListener("click", async () => {
      try {
        const text = typeof getText === "function" ? getText() : getText;
        await navigator.clipboard.writeText(text);
        copyBtn.innerHTML = "<span>✓</span> Copied";
        setTimeout(() => { copyBtn.innerHTML = "<span>📋</span> Copy"; }, 2000);
      } catch (_) {}
    });
    controlsWrapper.appendChild(copyBtn);
  }

  if (showPrint) {
    const printBtn = document.createElement("button");
    printBtn.type = "button";
    printBtn.className = "chat-bubble-action-btn";
    printBtn.innerHTML = "<span>🖨</span> Print / PDF";
    printBtn.addEventListener("click", () => {
      const text = typeof getText === "function" ? getText() : getText;
      const printWindow = window.open("", "_blank");
      printWindow.document.write(`
        <html>
          <head><title>StudyReader Summary - ${escapeHTML(pdfTitle.textContent)}</title></head>
          <body style="font-family: system-ui, sans-serif; padding: 40px; line-height: 1.6; max-width: 800px; margin: 0 auto;">
            <h2>${escapeHTML(pdfTitle.textContent)}</h2>
            <hr style="margin: 16px 0; border: none; border-top: 1px solid #ccc;">
            ${formatMarkdown(text)}
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    });
    controlsWrapper.appendChild(printBtn);
  }

  container.appendChild(controlsWrapper);

  if (StudyReaderInlineSpeech.getOwnerId() === ownerId) {
    updateUi(StudyReaderInlineSpeech.getState(), ownerId);
  }

  return { updateUi };
}

/* ============================================================
   STATE
   ============================================================ */

let pdfDocument = null;
let currentPage = 1;
let totalPages = 0;
let zoom = 1.0;
let currentRenderTask = null;

let selectedDocumentData = null;
let currentDocumentType = null;
let readAloudInitialized = false;
let activeToolMode = "view"; // "view" | "summary" | "ask-ai" | "read-aloud"

let currentSelectionText = "";
let isAiGenerating = false;
let currentPdfId = new URLSearchParams(window.location.search).get("id");
let cachedLibraryPdfs = [];

/* ============================================================
   URL PARAMS & INITIALIZATION
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {
  connectViewerControls();
  connectStudyTools();
  connectTextSelection();
  connectChatComposer();
  connectSummarySegmentedBar();
  initSuggestionChips();
  initPanelResizer();
  initPanelToggles();
  connectModalsAndEmptyState();

  // Listen to browser navigation (back/forward between opened documents)
  window.addEventListener("popstate", () => {
    stopAllSpeechAudio();
    const params = new URLSearchParams(window.location.search);
    const newId = params.get("id");
    if (newId && newId !== currentPdfId) {
      openDocument(newId, false);
    } else if (!newId) {
      showEmptySelectionState();
    }
  });

  // Stop active speech when navigating away from workspace
  window.addEventListener("beforeunload", () => {
    stopAllSpeechAudio();
  });
  window.addEventListener("pagehide", () => {
    stopAllSpeechAudio();
  });

  if (!currentPdfId) {
    showEmptySelectionState();
  } else {
    openDocument(currentPdfId, false);
  }
});

/* ============================================================
   OPEN DOCUMENT (WITH DYNAMIC URL & CACHE RESET)
   ============================================================ */

async function openDocument(id, updateHistory = true) {
  if (!id) return;
  stopAllSpeechAudio();
  currentPdfId = id;

  if (updateHistory) {
    const newUrl = `${window.location.pathname}?id=${encodeURIComponent(id)}`;
    window.history.pushState({ pdfId: id }, "", newUrl);
  }

  // Reset UI & caches
  if (pdfEmptySelection) {
    pdfEmptySelection.hidden = true;
    pdfEmptySelection.style.display = "none";
  }
  if (errorMessage) {
    errorMessage.hidden = true;
    errorMessage.style.display = "none";
  }
  if (viewerToolbar) {
    viewerToolbar.hidden = false;
    viewerToolbar.style.display = "flex";
  }
  if (loadingMessage) {
    loadingMessage.hidden = false;
    loadingMessage.style.display = "block";
    loadingMessage.textContent = "Loading document details...";
  }

  summaryCache = { quick: null, detailed: null, takeaways: null };
  overviewCache = null;
  readAloudInitialized = false;
  if (summaryAudioBar) {
    summaryAudioBar.style.display = "none";
    summaryAudioBar.innerHTML = "";
  }

  await loadSelectedPDF();
}

function showEmptySelectionState() {
  stopAllSpeechAudio();
  currentPdfId = null;
  if (pdfTitle) pdfTitle.textContent = "StudyReader Workspace";
  if (pdfStatus) pdfStatus.textContent = "No document selected";
  if (loadingMessage) {
    loadingMessage.hidden = true;
    loadingMessage.style.display = "none";
  }
  if (errorMessage) {
    errorMessage.hidden = true;
    errorMessage.style.display = "none";
  }
  if (canvas) {
    canvas.hidden = true;
    canvas.style.display = "none";
  }
  if (pageWrapper) {
    pageWrapper.style.display = "none";
  }
  if (documentText) {
    documentText.hidden = true;
    documentText.style.display = "none";
  }
  if (viewerToolbar) {
    viewerToolbar.hidden = true;
    viewerToolbar.style.display = "none";
  }
  if (documentAiPanel) {
    documentAiPanel.hidden = true;
    documentAiPanel.style.display = "none";
  }
  if (readAloudPanel) {
    readAloudPanel.hidden = true;
    readAloudPanel.style.display = "none";
  }
  if (summaryAudioBar) {
    summaryAudioBar.style.display = "none";
    summaryAudioBar.innerHTML = "";
  }
  if (pdfEmptySelection) {
    pdfEmptySelection.hidden = false;
    pdfEmptySelection.style.display = "flex";
  }
  setActiveStudyTool("view");
}

/* ============================================================
   LOAD SELECTED DOCUMENT (BY ID)
   ============================================================ */

async function loadSelectedPDF() {
  stopAllSpeechAudio();

  if (!currentPdfId) {
    showEmptySelectionState();
    return;
  }

  // Reset caches for fresh document context
  summaryCache = {
    quick: null,
    detailed: null,
    takeaways: null
  };
  overviewCache = null;

  try {
    loadingMessage.hidden = false;
    loadingMessage.textContent = "Loading document details...";
    errorMessage.hidden = true;
    pdfStatus.textContent = "Loading document details...";

    const response = await fetch(`${API_BASE_URL}/api/pdfs/${encodeURIComponent(currentPdfId)}`, {
      method: "GET",
      credentials: "include"
    });

    if (response.status === 401) {
      window.location.href = "../login/index.html";
      return;
    }

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.message || "The requested document could not be found.");
    }

    const data = await response.json();
    selectedDocumentData = data.pdf;

    pdfTitle.textContent =
      selectedDocumentData.originalFilename ||
      selectedDocumentData.filename ||
      "Academic Document";

    currentDocumentType = selectedDocumentData.fileType || "pdf";

    // Pre-load conversational chat history concurrently
    loadChatHistory();

    if (currentDocumentType === "pdf") {
      await loadPDFDocument(selectedDocumentData.fileUrl);
    } else if (currentDocumentType === "docx" || currentDocumentType === "pptx") {
      await loadDocumentTextView();
    } else {
      throw new Error(`Unsupported document format: ${currentDocumentType}`);
    }

    // Initialize StudyReader Listen Player and check Smart Resume
    if (window.StudyReaderListenPlayer && currentPdfId) {
      window.StudyReaderListenPlayer.init({
        documentId: currentPdfId,
        currentPage: currentPage,
        onPageChange: (targetPage) => {
          if (targetPage >= 1 && targetPage <= totalPages && targetPage !== currentPage) {
            goToPage(targetPage);
          }
        }
      });
    }

  } catch (error) {
    console.error("Failed to load document:", error);
    showError(error.message || "Unable to open this document.");
  }
}

/* ============================================================
   LOAD PDF.JS DOCUMENT & CANVAS
   ============================================================ */

async function loadPDFDocument(fileUrl) {
  try {
    viewerToolbar.hidden = false;
    canvas.hidden = false;
    documentText.hidden = true;
    canvasContainer.classList.remove("text-document-mode");

    const pdfURL = `${API_BASE_URL}${fileUrl}`;

    pdfDocument = await pdfjsLib.getDocument({
      url: pdfURL,
      withCredentials: true
    }).promise;

    totalPages = pdfDocument.numPages;
    totalPagesElement.textContent = totalPages;
    currentPage = 1;
    currentPageInput.value = currentPage;

    pdfStatus.textContent = `${totalPages} page${totalPages === 1 ? "" : "s"}`;
    loadingMessage.hidden = true;

    updateNavigation();
    await renderPage(currentPage);

  } catch (error) {
    console.error("PDF loading error:", error);
    showError("Unable to render the PDF file.");
  }
}

/* ============================================================
   RENDER PAGE WITH CONCURRENT CANCELLATION & TEXT LAYER
   ============================================================ */

async function renderPage(pageNumber) {
  if (!pdfDocument) return;

  // Cancel any ongoing render task before starting a new one
  if (currentRenderTask) {
    try {
      currentRenderTask.cancel();
    } catch (_) {}
    currentRenderTask = null;
  }

  try {
    loadingMessage.hidden = false;
    loadingMessage.textContent = "Rendering page...";

    const page = await pdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale: zoom });

    const context = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    // Size outer wrapper to match viewport
    if (pageWrapper) {
      pageWrapper.style.width = `${viewport.width}px`;
      pageWrapper.style.height = `${viewport.height}px`;
    }

    // Render Canvas
    currentRenderTask = page.render({
      canvasContext: context,
      viewport: viewport
    });

    await currentRenderTask.promise;
    currentRenderTask = null;

    // Render Text Layer for Native Text Selection
    if (textLayerDiv && pdfjsLib.renderTextLayer) {
      textLayerDiv.innerHTML = "";
      textLayerDiv.style.width = `${viewport.width}px`;
      textLayerDiv.style.height = `${viewport.height}px`;

      const textContent = await page.getTextContent();
      pdfjsLib.renderTextLayer({
        textContentSource: textContent,
        container: textLayerDiv,
        viewport: viewport,
        textDivs: []
      });
    }

    loadingMessage.hidden = true;
    currentPageInput.value = currentPage;
    updateNavigation();
    pdfStatus.textContent = `Page ${currentPage} of ${totalPages}`;

    // Always synchronize StudyReader Listen Player with the active PDF page
    if (window.StudyReaderListenPlayer && typeof window.StudyReaderListenPlayer.syncPage === "function") {
      window.StudyReaderListenPlayer.syncPage(currentPage);
    }

  } catch (error) {
    // If render was cancelled due to zooming or fast page flips, do not treat as error
    if (error && error.name === "RenderingCancelledException") {
      return;
    }
    console.error("Page render error:", error);
    loadingMessage.hidden = true;
  }
}

/* ============================================================
   NAVIGATION & ZOOM CONTROLS
   ============================================================ */

window.getCurrentPdfPage = function () {
  return typeof currentPage === "number" ? currentPage : 1;
};

function goToPreviousPage() {
  if (!pdfDocument || currentPage <= 1) return;
  goToPage(currentPage - 1);
}

function goToNextPage() {
  if (!pdfDocument || currentPage >= totalPages) return;
  goToPage(currentPage + 1);
}

function goToPage(pageNumber) {
  if (!pdfDocument) return;
  const parsed = parseInt(pageNumber, 10);
  if (isNaN(parsed) || parsed < 1 || parsed > totalPages) {
    currentPageInput.value = currentPage;
    return;
  }
  currentPage = parsed;
  renderPage(currentPage);

  // Synchronize player with the user's selected page
  if (window.StudyReaderListenPlayer && typeof window.StudyReaderListenPlayer.syncPage === "function") {
    window.StudyReaderListenPlayer.syncPage(currentPage);
  }
}

function updateNavigation() {
  previousButton.disabled = currentPage <= 1;
  nextButton.disabled = currentPage >= totalPages;
  currentPageInput.max = totalPages;
}

function updateZoom(newZoom) {
  zoom = Math.min(Math.max(newZoom, 0.5), 3.0);
  zoomLevel.textContent = `${Math.round(zoom * 100)}%`;
  renderPage(currentPage);
}

function zoomIn() {
  updateZoom(zoom + 0.2);
}

function zoomOut() {
  updateZoom(zoom - 0.2);
}

function fitWidth() {
  if (!canvasContainer || !canvas) return;
  const availableWidth = canvasContainer.clientWidth - 48;
  if (availableWidth > 300 && canvas.width) {
    const naturalWidth = canvas.width / zoom;
    const targetZoom = availableWidth / naturalWidth;
    updateZoom(targetZoom);
  }
}

function connectViewerControls() {
  previousButton.addEventListener("click", goToPreviousPage);
  nextButton.addEventListener("click", goToNextPage);

  currentPageInput.addEventListener("change", (e) => goToPage(e.target.value));
  currentPageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") goToPage(e.target.value);
  });

  zoomInButton.addEventListener("click", zoomIn);
  zoomOutButton.addEventListener("click", zoomOut);
  fitWidthButton.addEventListener("click", fitWidth);

  backToLibrary.addEventListener("click", () => {
    stopAllSpeechAudio();
    window.location.href = "../library/index.html";
  });

  if (btnCloseAiPanel) {
    btnCloseAiPanel.addEventListener("click", () => {
      stopAllSpeechAudio();
      documentAiPanel.hidden = true;
      documentAiPanel.style.display = "none";
      setActiveStudyTool("view");
    });
  }

  if (btnCloseReadAloud) {
    btnCloseReadAloud.addEventListener("click", () => {
      stopAllSpeechAudio();
      setActiveStudyTool("view");
    });
  }
}

/* ============================================================
   TEXT SELECTION & FLOATING EXPLAIN POPUP
   ============================================================ */

function connectTextSelection() {
  document.addEventListener("selectionchange", handleTextSelectionChange);

  if (btnExplainSelection) {
    btnExplainSelection.addEventListener("click", () => {
      if (!currentSelectionText) return;
      const textToExplain = currentSelectionText;
      hideSelectionPopup();
      setActiveStudyTool("ask-ai");
      switchAiView("chat");
      sendChatMessage(`Can you explain this part of the document in simple, intuitive terms with an example if applicable:\n\n"${textToExplain}"`);
    });
  }

  const btnListenSelection = document.getElementById("btn-listen-selection");
  if (btnListenSelection) {
    btnListenSelection.addEventListener("click", () => {
      if (!currentSelectionText) return;
      const textToSpeak = currentSelectionText;
      hideSelectionPopup();
      if (window.StudyReaderListenPlayer) {
        window.StudyReaderListenPlayer.speakWithBrowserVoice(textToSpeak);
      }
    });
  }

  if (btnCopySelection) {
    btnCopySelection.addEventListener("click", async () => {
      if (!currentSelectionText) return;
      try {
        await navigator.clipboard.writeText(currentSelectionText);
        btnCopySelection.innerHTML = "<span>✓</span> Copied!";
        setTimeout(() => {
          btnCopySelection.innerHTML = "<span>📋</span> Copy";
          hideSelectionPopup();
        }, 1500);
      } catch (_) {}
    });
  }
}

function handleTextSelectionChange() {
  const selection = window.getSelection();
  const text = selection.toString().trim();

  if (!text || text.length < 3) {
    hideSelectionPopup();
    return;
  }

  // Ensure selection occurred within the textLayer or document text
  if (!selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const isInsideViewer =
    (textLayerDiv && textLayerDiv.contains(container)) ||
    (documentText && documentText.contains(container));

  if (!isInsideViewer) {
    hideSelectionPopup();
    return;
  }

  currentSelectionText = text;
  const rect = range.getBoundingClientRect();

  if (selectionPopup) {
    selectionPopup.style.display = "flex";
    selectionPopup.style.left = `${Math.max(10, rect.left + rect.width / 2 - 100)}px`;
    selectionPopup.style.top = `${Math.max(10, rect.top - 44)}px`;
  }
}

function hideSelectionPopup() {
  if (selectionPopup) {
    selectionPopup.style.display = "none";
  }
}

/* ============================================================
   PERSISTENT CONVERSATIONAL AI TUTOR
   ============================================================ */

async function loadChatHistory() {
  if (!currentPdfId) return;

  try {
    const res = await fetch(`${API_BASE_URL}/api/pdfs/${encodeURIComponent(currentPdfId)}/chat`, {
      method: "GET",
      credentials: "include"
    });

    if (!res.ok) return;

    const data = await res.json();
    const messages = Array.isArray(data.messages) ? data.messages : [];

    chatThread.innerHTML = "";

    if (messages.length === 0) {
      renderChatEmptyState();
      return;
    }

    messages.forEach((msg) => {
      appendChatBubble(msg.role, msg.message, false);
    });

    scrollChatToBottom();

  } catch (err) {
    console.warn("Could not load chat history:", err);
  }
}

function renderChatEmptyState() {
  const empty = document.createElement("div");
  empty.className = "chat-empty-state";
  empty.style.textAlign = "center";
  empty.style.padding = "24px 12px";
  empty.style.color = "#64748b";
  empty.innerHTML = `
    <div style="font-size: 32px; margin-bottom: 8px;">🎓</div>
    <strong style="color: #0f172a; font-size: 15px; display: block; margin-bottom: 4px;">Academic AI Tutor</strong>
    <p style="font-size: 13px; line-height: 1.5; max-width: 280px; margin: 0 auto 12px;">
      Ask any concept, formula, or exam question. Responses are grounded in this document and saved across sessions.
    </p>
  `;
  chatThread.appendChild(empty);
}

function appendChatBubble(role, messageText, shouldScroll = true) {
  // Remove empty state if present
  const emptyState = chatThread.querySelector(".chat-empty-state");
  if (emptyState) emptyState.remove();

  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${role}`;

  if (role === "user") {
    bubble.textContent = messageText;
  } else {
    const markdownDiv = document.createElement("div");
    markdownDiv.className = "chat-markdown";
    markdownDiv.innerHTML = formatMarkdown(messageText);
    bubble.appendChild(markdownDiv);

    // Assistant Action Bar (Copy, Voice, Playback Speed)
    const actions = document.createElement("div");
    actions.className = "chat-bubble-actions";

    const msgId = "chat-msg-" + Date.now() + "-" + Math.random().toString(36).substr(2, 5);
    attachInlineAudioControls({
      container: actions,
      ownerId: msgId,
      getText: () => messageText,
      showCopy: true,
      showPrint: false
    });

    bubble.appendChild(actions);
  }

  chatThread.appendChild(bubble);

  if (shouldScroll) {
    scrollChatToBottom();
  }

  return bubble;
}

function scrollChatToBottom() {
  chatThread.scrollTop = chatThread.scrollHeight;
}

async function sendChatMessage(promptText) {
  const text = promptText || (chatInput ? chatInput.value.trim() : "");
  if (!text || isAiGenerating || !currentPdfId) return;

  if (chatInput) {
    chatInput.value = "";
    chatInput.style.height = "auto";
  }
  isAiGenerating = true;
  if (chatSendBtn) chatSendBtn.disabled = true;

  appendChatBubble("user", text);

  // Append thinking bubble
  const thinkingBubble = document.createElement("div");
  thinkingBubble.className = "chat-bubble assistant chat-thinking-bubble";
  thinkingBubble.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px; color: #6366f1; font-style: italic;">
      <span>🧠</span>
      <span>AI Tutor analyzing document and synthesizing answer...</span>
    </div>
  `;
  chatThread.appendChild(thinkingBubble);
  scrollChatToBottom();

  try {
    const response = await fetch(`${API_BASE_URL}/api/pdfs/${encodeURIComponent(currentPdfId)}/chat`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text })
    });

    const data = await response.json();
    thinkingBubble.remove();

    if (!response.ok) {
      throw new Error(data.message || "Failed to generate tutor response.");
    }

    const assistantMsg = data.assistantMessage?.message || "I reviewed the text, but could not produce a response.";
    appendChatBubble("assistant", assistantMsg);

  } catch (error) {
    thinkingBubble.remove();
    const errorBubble = document.createElement("div");
    errorBubble.className = "chat-bubble assistant";
    errorBubble.style.borderColor = "#fca5a5";
    errorBubble.style.background = "#fff1f2";
    errorBubble.innerHTML = `<span style="color: #dc2626;">⚠️ ${escapeHTML(error.message)}</span>`;
    chatThread.appendChild(errorBubble);
    scrollChatToBottom();
  } finally {
    isAiGenerating = false;
    if (chatSendBtn) chatSendBtn.disabled = false;
    if (chatInput) chatInput.focus();
  }
}

function connectChatComposer() {
  if (!chatInput) return;

  chatInput.addEventListener("input", () => {
    chatInput.style.height = "auto";
    chatInput.style.height = `${Math.min(chatInput.scrollHeight, 120)}px`;
  });

  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });

  if (chatSendBtn) {
    chatSendBtn.addEventListener("click", () => sendChatMessage());
  }

  if (chatClearBtn) {
    chatClearBtn.addEventListener("click", async () => {
      stopAllSpeechAudio();
      if (!currentPdfId) return;
      if (!confirm("Clear this entire chat history?")) return;
      try {
        await fetch(`${API_BASE_URL}/api/pdfs/${encodeURIComponent(currentPdfId)}/chat`, {
          method: "DELETE",
          credentials: "include"
        });
        chatThread.innerHTML = "";
        renderChatEmptyState();
      } catch (err) {
        console.error("Clear chat failed:", err);
      }
    });
  }
}

function initSuggestionChips() {
  const chips = [
    { label: "💡 Simple Analogy", prompt: "Can you explain the main concept of this document using a clear real-world analogy that is easy to understand?" },
    { label: "📑 Curriculum Overview", prompt: "Give me a structured curriculum overview of the main topics and units covered in this material." },
    { label: "📝 Exam Questions", prompt: "What are 3-5 important examination questions likely to be asked from this material, with model answers?" },
    { label: "🔍 Step-by-Step Breakdown", prompt: "Provide a clear step-by-step breakdown of how this works." },
    { label: "⚖️ Compare & Contrast", prompt: "What are the core differences and trade-offs of the concepts or approaches discussed in this text?" },
    { label: "📌 High-Yield Revision Sheet", prompt: "Generate a high-yield exam revision sheet summarizing the essential definitions, formulas, and key takeaways." }
  ];

  if (!chatChipsContainer) return;
  chatChipsContainer.innerHTML = "";

  chips.forEach((chip) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "document-ai-chip";
    btn.textContent = chip.label;
    btn.addEventListener("click", () => {
      setActiveStudyTool("ask-ai");
      switchAiView("chat");
      sendChatMessage(chip.prompt);
    });
    chatChipsContainer.appendChild(btn);
  });
}

/* ============================================================
   STRUCTURED SUMMARIES (QUICK, DETAILED, EXAM TAKEAWAYS)
   ============================================================ */

let summaryCache = {
  quick: null,
  detailed: null,
  takeaways: null
};

function connectSummarySegmentedBar() {
  document.querySelectorAll(".segmented-mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      stopAllSpeechAudio();
      const wasActive = btn.classList.contains("active");
      document.querySelectorAll(".segmented-mode-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const type = btn.getAttribute("data-summary-type") || btn.getAttribute("data-mode") || "quick";
      if (summaryContent) summaryContent.scrollTop = 0;
      // Re-clicking active tab triggers a fresh backend cache check
      runSummary(type, { forceBackend: wasActive });
    });
  });
}

async function runSummary(summaryType = "quick", options = {}) {
  const forceBackend = Boolean(options.forceBackend);
  stopAllSpeechAudio();

  // If already in browser memory and not forced, display instantly from memory cache
  if (summaryCache[summaryType] && !forceBackend) {
    const mem = summaryCache[summaryType];
    renderSummaryOutput(mem.answer, summaryType, mem.coverage, {
      origin: "memory",
      hitCount: mem.hitCount,
      cached: mem.cached
    });
    return;
  }

  if (summaryAudioBar) {
    summaryAudioBar.style.display = "none";
    summaryAudioBar.innerHTML = "";
  }

  summaryContent.innerHTML = `
    <div style="padding: 24px; text-align: center; color: #6366f1;">
      <span style="font-size: 24px; display: block; margin-bottom: 8px;">⏳</span>
      <p style="font-size: 13.5px; font-weight: 600;">Checking persistent AI cache & synthesizing ${summaryType} summary...</p>
      <p style="font-size: 12px; color: #64748b; margin-top: 4px;">Querying PostgreSQL cache and intermediate digests...</p>
    </div>
  `;

  try {
    const response = await fetch(`${API_BASE_URL}/api/pdfs/${encodeURIComponent(currentPdfId)}/ai`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "summary", summaryType })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Failed to generate summary.");

    const origin = data.cached ? "postgres_cache" : "gemini";
    summaryCache[summaryType] = {
      answer: data.answer,
      coverage: data.coverage,
      cached: Boolean(data.cached),
      hitCount: data.hitCount || 0
    };

    renderSummaryOutput(data.answer, summaryType, data.coverage, {
      origin,
      hitCount: data.hitCount || 0,
      cached: Boolean(data.cached)
    });

  } catch (error) {
    summaryContent.innerHTML = `
      <div style="padding: 16px; background: #fff1f2; border: 1px solid #fca5a5; border-radius: 8px; color: #dc2626;">
        ${escapeHTML(error.message)}
      </div>
    `;
  }
}

function renderSummaryOutput(markdownText, type, coverage = null, meta = {}) {
  summaryContent.innerHTML = formatMarkdown(markdownText);
  summaryContent.scrollTop = 0;

  // Render sticky audio bar inside the pinned header
  if (summaryAudioBar) {
    summaryAudioBar.style.display = "flex";
    summaryAudioBar.innerHTML = "";

    attachInlineAudioControls({
      container: summaryAudioBar,
      ownerId: "summary-" + type,
      getText: () => markdownText,
      showCopy: true,
      showPrint: true
    });

    if (coverage && coverage.totalPages) {
      const badge = document.createElement("span");
      badge.className = "summary-coverage-badge";
      const rangeStr = coverage.pageRangesCovered || ("1–" + coverage.totalPages);
      const batchStr = coverage.batchesProcessed ? ` (${coverage.batchesProcessed} sections synthesized)` : "";
      badge.innerHTML = `✓ Pages ${rangeStr}${batchStr}`;
      summaryAudioBar.appendChild(badge);
    }

    // Explicit cache provenance badge
    const cacheBadge = document.createElement("span");
    cacheBadge.className = "summary-coverage-badge";
    cacheBadge.style.marginLeft = "6px";
    if (meta.origin === "postgres_cache") {
      cacheBadge.style.background = "#dcfce7";
      cacheBadge.style.color = "#15803d";
      cacheBadge.style.borderColor = "#86efac";
      cacheBadge.innerHTML = `⚡ DB Cache Hit (${meta.hitCount || 1} calls saved)`;
    } else if (meta.origin === "memory") {
      cacheBadge.style.background = "#f1f5f9";
      cacheBadge.style.color = "#475569";
      cacheBadge.style.borderColor = "#cbd5e1";
      cacheBadge.innerHTML = `💻 Browser Memory`;
    } else if (meta.origin === "gemini") {
      cacheBadge.style.background = "#ede9fe";
      cacheBadge.style.color = "#6d28d9";
      cacheBadge.style.borderColor = "#c4b5fd";
      cacheBadge.innerHTML = `✨ Gemini Generated`;
    }
    if (meta.origin) {
      summaryAudioBar.appendChild(cacheBadge);
    }
  }

  // Attach action bar (Copy, Print/Export, and Re-check Cache) at bottom of content
  const exportBar = document.createElement("div");
  exportBar.style.display = "flex";
  exportBar.style.gap = "8px";
  exportBar.style.marginTop = "16px";
  exportBar.style.paddingTop = "12px";
  exportBar.style.borderTop = "1px solid #e2e8f0";

  const refreshBtn = document.createElement("button");
  refreshBtn.type = "button";
  refreshBtn.className = "chat-bubble-action-btn";
  refreshBtn.innerHTML = "<span>🔄</span> Re-check DB Cache";
  refreshBtn.title = "Verify directly with PostgreSQL AI cache";
  refreshBtn.addEventListener("click", () => {
    runSummary(type, { forceBackend: true });
  });

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "chat-bubble-action-btn";
  copyBtn.innerHTML = "<span>📋</span> Copy Summary";
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(markdownText);
      copyBtn.innerHTML = "<span>✓</span> Copied";
      setTimeout(() => { copyBtn.innerHTML = "<span>📋</span> Copy Summary"; }, 2000);
    } catch (_) {}
  });

  const printBtn = document.createElement("button");
  printBtn.type = "button";
  printBtn.className = "chat-bubble-action-btn";
  printBtn.innerHTML = "<span>🖨</span> Print / PDF";
  printBtn.addEventListener("click", () => {
    const printWindow = window.open("", "_blank");
    printWindow.document.write(`
      <html>
        <head><title>StudyReader Summary - ${escapeHTML(pdfTitle.textContent)}</title></head>
        <body style="font-family: system-ui, sans-serif; padding: 40px; line-height: 1.6; max-width: 800px; margin: 0 auto;">
          <h2>${escapeHTML(pdfTitle.textContent)}</h2>
          <hr style="margin: 16px 0; border: none; border-top: 1px solid #ccc;">
          ${formatMarkdown(markdownText)}
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  });

  exportBar.appendChild(refreshBtn);
  exportBar.appendChild(copyBtn);
  exportBar.appendChild(printBtn);
  summaryContent.appendChild(exportBar);
}

/* ============================================================
   CURRICULUM OVERVIEW
   ============================================================ */

let overviewCache = null;

async function runOverview(forceBackend = false) {
  if (overviewCache && !forceBackend) {
    renderOverviewOutput(overviewCache);
    return;
  }

  overviewContent.innerHTML = `
    <div style="padding: 24px; text-align: center; color: #6366f1;">
      <span style="font-size: 24px; display: block; margin-bottom: 8px;">⏳</span>
      <p style="font-size: 13.5px; font-weight: 600;">Checking AI cache & synthesizing curriculum overview...</p>
    </div>
  `;

  try {
    const response = await fetch(`${API_BASE_URL}/api/pdfs/${encodeURIComponent(currentPdfId)}/ai`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "overview" })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Failed to generate curriculum overview.");

    overviewCache = data.answer;
    renderOverviewOutput(data.answer);

  } catch (error) {
    overviewContent.innerHTML = `
      <div style="padding: 16px; background: #fff1f2; border: 1px solid #fca5a5; border-radius: 8px; color: #dc2626;">
        ${escapeHTML(error.message)}
      </div>
    `;
  }
}

function renderOverviewOutput(markdownText) {
  overviewContent.innerHTML = formatMarkdown(markdownText);
}

/* ============================================================
   CONCEPT EXPLAINER & HIGHLIGHTED TEXT EXPLAINER
   ============================================================ */

async function runExplain(highlightedText = "") {
  if (explainNotice) {
    if (highlightedText) {
      explainNotice.style.display = "block";
      if (explainSelectedPreview) {
        explainSelectedPreview.textContent =
          highlightedText.length > 100
            ? `"${highlightedText.slice(0, 100)}..."`
            : `"${highlightedText}"`;
      }
    } else {
      explainNotice.style.display = "none";
    }
  }

  if (explainContent) {
    explainContent.innerHTML = `
      <div style="padding: 24px; text-align: center; color: #6366f1;">
        <span style="font-size: 24px; display: block; margin-bottom: 8px;">💡</span>
        <p style="font-size: 13.5px; font-weight: 600;">Crafting intuitive analogy and breakdown...</p>
      </div>
    `;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/pdfs/${encodeURIComponent(currentPdfId)}/ai`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "explanation",
        highlightedText: highlightedText || undefined
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Failed to generate explanation.");

    if (explainContent) explainContent.innerHTML = formatMarkdown(data.answer);

  } catch (error) {
    if (explainContent) {
      explainContent.innerHTML = `
        <div style="padding: 16px; background: #fff1f2; border: 1px solid #fca5a5; border-radius: 8px; color: #dc2626;">
          ${escapeHTML(error.message)}
        </div>
      `;
    }
  }
}

/* ============================================================
   STUDY TOOL RAIL ROUTER
   ============================================================ */

function connectStudyTools() {
  document.querySelectorAll(".study-tool").forEach((button) => {
    button.addEventListener("click", () => {
      const tool = button.dataset.tool;
      handleStudyTool(tool);
    });
  });
}

function setActiveStudyTool(toolName) {
  activeToolMode = toolName;
  document.querySelectorAll(".study-tool").forEach((btn) => {
    if (btn.dataset.tool === toolName) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
}

function switchAiView(viewName) {
  if (documentAiPanel) {
    documentAiPanel.hidden = false;
    documentAiPanel.style.display = "flex";
  }

  if (aiChatView) {
    aiChatView.hidden = true;
    aiChatView.style.display = "none";
  }
  if (aiSummaryView) {
    aiSummaryView.hidden = true;
    aiSummaryView.style.display = "none";
  }
  if (aiOverviewView) {
    aiOverviewView.hidden = true;
    aiOverviewView.style.display = "none";
  }
  if (aiExplainView) {
    aiExplainView.hidden = true;
    aiExplainView.style.display = "none";
  }

  if (viewName === "chat") {
    if (documentAiTitle) documentAiTitle.textContent = "✨ Academic AI Tutor";
    if (documentAiStatus) documentAiStatus.textContent = "Interactive Tutor";
    if (aiChatView) {
      aiChatView.hidden = false;
      aiChatView.style.display = "flex";
      if (chatInput) chatInput.focus();
    }
    // Restore or reload conversation history when opening AI Tutor
    loadChatHistory();
  } else if (viewName === "summary") {
    if (documentAiTitle) documentAiTitle.textContent = "≣ Structured Summary";
    if (documentAiStatus) documentAiStatus.textContent = "Key Takeaways";
    if (aiSummaryView) {
      aiSummaryView.hidden = false;
      aiSummaryView.style.display = "flex";
      if (summaryContent) summaryContent.scrollTop = 0;
    }
  }
}

async function handleStudyTool(tool) {
  stopAllSpeechAudio();
  setActiveStudyTool(tool);

  if (tool === "view") {
    if (documentAiPanel) {
      documentAiPanel.hidden = true;
      documentAiPanel.style.display = "none";
    }
    if (readAloudPanel) {
      readAloudPanel.hidden = true;
      readAloudPanel.style.display = "none";
    }
    return;
  }

  if (tool === "read-aloud") {
    if (documentAiPanel) {
      documentAiPanel.hidden = true;
      documentAiPanel.style.display = "none";
    }
    if (readAloudPanel) {
      readAloudPanel.hidden = true;
      readAloudPanel.style.display = "none";
    }
    if (window.StudyReaderListenPlayer && currentPdfId) {
      let clientSections = [];
      try {
        if (currentDocumentType === "pdf") {
          clientSections = await getPdfReadingSections();
        }
      } catch (_) {}

      window.StudyReaderListenPlayer.init({
        documentId: currentPdfId,
        currentPage: currentPage,
        sections: clientSections,
        onPageChange: (targetPage) => {
          if (targetPage >= 1 && targetPage <= totalPages && targetPage !== currentPage) {
            goToPage(targetPage);
          }
        }
      });
      const listenContainer = document.getElementById("studyreader-listen-container");
      if (listenContainer) {
        listenContainer.style.display = "flex";
      }
      return;
    }
    if (readAloudPanel) {
      readAloudPanel.hidden = false;
      readAloudPanel.style.display = "flex";
    }
    await initializeReadAloud();
    return;
  }

  if (tool === "summary") {
    if (readAloudPanel) {
      readAloudPanel.hidden = true;
      readAloudPanel.style.display = "none";
    }
    switchAiView("summary");
    runSummary("quick");
    return;
  }

  if (tool === "ask-ai") {
    if (readAloudPanel) {
      readAloudPanel.hidden = true;
      readAloudPanel.style.display = "none";
    }
    switchAiView("chat");
    return;
  }
}

/* ============================================================
   READ ALOUD INTEGRATION WITH FORMULA & BULLET NORMALIZER
   ============================================================ */

function buildPageSentencesFromPdfItems(items, pageNumber) {
  if (!Array.isArray(items) || items.length === 0) return [];

  const lines = [];
  let currentLine = [];
  let lastY = null;

  items.forEach((item, itemIdx) => {
    if (!item.str || !item.str.trim()) return;
    const y = Math.round(item.transform[5]);
    if (lastY !== null && Math.abs(y - lastY) > 3) {
      if (currentLine.length > 0) {
        lines.push({ y: lastY, items: currentLine });
        currentLine = [];
      }
    }
    currentLine.push({ str: item.str, itemIdx, x: Math.round(item.transform[4]), y });
    lastY = y;
  });
  if (currentLine.length > 0) {
    lines.push({ y: lastY, items: currentLine });
  }

  // Filter out standalone page number footer at the very bottom (y < 50 and pure number)
  const contentLines = lines.filter((line, lIdx) => {
    const lineText = line.items.map(it => it.str).join("").trim();
    if (/^\d+$/.test(lineText) && (line.y < 50 || lIdx === lines.length - 1)) return false;
    return lineText.length > 0;
  });

  const sentences = [];
  let curSent = {
    text: "",
    startSpanIdx: null,
    endSpanIdx: null,
    pageNumber
  };

  contentLines.forEach((line, lineIdx) => {
    const lineStr = line.items.map(it => it.str).join("").replace(/\s+/g, " ").trim();
    const firstItem = line.items[0];
    const lastItem = line.items[line.items.length - 1];

    // Check if line is a standalone heading or title
    const isHeading = (lineIdx === 0 && lineStr.length < 80 && !lineStr.endsWith(".")) ||
                      /^(?:chapter|unit|lecture|\d+\.\d+)\b/i.test(lineStr) ||
                      (/^[A-Z\s\(\)\:\-\.\,\?]{4,80}$/.test(lineStr) && line.items.length <= 4);

    if (isHeading) {
      if (curSent.text && curSent.text.trim()) {
        const cleanRaw = curSent.text.replace(/^[▪•\-\*]\s*/, "").replace(/\s+/g, " ").trim();
        sentences.push({ raw: cleanRaw, spoken: cleanRaw, startSpanIdx: curSent.startSpanIdx, endSpanIdx: curSent.endSpanIdx, pageNumber });
        curSent = { text: "", startSpanIdx: null, endSpanIdx: null, pageNumber };
      }
      sentences.push({
        raw: lineStr,
        spoken: lineStr,
        startSpanIdx: firstItem.itemIdx,
        endSpanIdx: lastItem.itemIdx,
        pageNumber
      });
      return;
    }

    // Check if line starts with a bullet symbol (▪, •, -, *)
    const isBulletStart = /^[▪•\-\*]\s*/.test(lineStr);
    if (isBulletStart && curSent.text.trim().length > 0) {
      const cleanRaw = curSent.text.replace(/^[▪•\-\*]\s*/, "").replace(/\s+/g, " ").trim();
      sentences.push({ raw: cleanRaw, spoken: cleanRaw, startSpanIdx: curSent.startSpanIdx, endSpanIdx: curSent.endSpanIdx, pageNumber });
      curSent = { text: "", startSpanIdx: null, endSpanIdx: null, pageNumber };
    }

    line.items.forEach(it => {
      const itStr = it.str.trim();
      if (!itStr) return;

      const parts = itStr.split(/(?<=[.!?])\s+(?=[A-Z0-9])/);
      parts.forEach((part, pIdx) => {
        const partTrimmed = part.trim();
        if (!partTrimmed) return;

        if (curSent.startSpanIdx === null) {
          curSent.startSpanIdx = it.itemIdx;
        }
        curSent.endSpanIdx = it.itemIdx;

        const endsSentence = /[.!?]$/.test(partTrimmed);
        const isAbbreviation = /\b(?:e\.g\.|i\.e\.|etc\.|vs\.|al\.)$/i.test(partTrimmed);

        if (endsSentence && !isAbbreviation) {
          curSent.text += (curSent.text ? " " : "") + partTrimmed;
          const cleanRaw = curSent.text.replace(/^[▪•\-\*]\s*/, "").replace(/\s+/g, " ").trim();
          if (cleanRaw.length > 0) {
            sentences.push({ raw: cleanRaw, spoken: cleanRaw, startSpanIdx: curSent.startSpanIdx, endSpanIdx: curSent.endSpanIdx, pageNumber });
          }
          curSent = { text: "", startSpanIdx: (pIdx < parts.length - 1 ? it.itemIdx : null), endSpanIdx: (pIdx < parts.length - 1 ? it.itemIdx : null), pageNumber };
        } else {
          curSent.text += (curSent.text ? " " : "") + partTrimmed;
        }
      });
    });
  });

  if (curSent.text && curSent.text.trim()) {
    const cleanRaw = curSent.text.replace(/^[▪•\-\*]\s*/, "").replace(/\s+/g, " ").trim();
    sentences.push({ raw: cleanRaw, spoken: cleanRaw, startSpanIdx: curSent.startSpanIdx, endSpanIdx: curSent.endSpanIdx, pageNumber });
  }

  return sentences;
}

async function getPdfReadingSections() {
  const sections = [];
  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageSentences = buildPageSentencesFromPdfItems(textContent.items, pageNumber);
    const text = pageSentences.length > 0
      ? pageSentences.map(s => s.raw).join(" ")
      : textContent.items.map((item) => item.str).join(" ").replace(/\s+/g, " ").trim();

    sections.push({
      pageNumber,
      label: `Page ${pageNumber}`,
      text,
      sentences: pageSentences
    });
  }

  // Fallback for scanned/handwritten image PDFs where client-side textLayer has no selectable text
  if (!sections.some((s) => s.text) && currentPdfId) {
    try {
      const blocksRes = await fetch(`${API_BASE_URL}/api/listen/document/${encodeURIComponent(currentPdfId)}/blocks`, {
        credentials: "include"
      });
      if (blocksRes.ok) {
        const data = await blocksRes.json();
        if (data.blocks && data.blocks.length > 0) {
          return data.blocks.map((b) => ({
            pageNumber: b.pageNumber || 1,
            label: b.title || `Page ${b.pageNumber || 1}`,
            text: b.spokenText || b.rawText || "",
            sentences: b.sentences
          }));
        }
      }
    } catch (_) {}
  }

  return sections;
}

async function initializeReadAloud() {
  if (readAloudInitialized) {
    readAloudPanel.hidden = false;
    return;
  }

  let sections;
  if (currentDocumentType === "pdf") {
    sections = await getPdfReadingSections();
  } else {
    const textData = await loadExtractedDocumentText();
    if (Array.isArray(textData.sections) && textData.sections.length > 0) {
      sections = textData.sections.map(s => {
        let label = "Section";
        if (typeof s.slideNumber === "number") {
          label = `Slide ${s.slideNumber}: ${s.title || ''}`;
        } else if (typeof s.sectionNumber === "number") {
          label = s.title || `Section ${s.sectionNumber}`;
        }
        return {
          label,
          text: s.text
        };
      });
    } else {
      sections = [{
        label: "Document",
        text: textData.content?.text || textData.text || ""
      }];
    }
  }

  if (!sections.length || !sections.some((s) => s.text)) {
    readAloudElements.error.hidden = false;
    readAloudElements.error.textContent = "No readable text found for speech synthesis.";
    return;
  }

  window.StudyReaderReadAloud.initialize({
    documentId: currentPdfId,
    sections,
    elements: readAloudElements,
    apiBaseUrl: API_BASE_URL,
    onSectionChange: (index) => {
      const targetPage = index + 1;
      if (targetPage >= 1 && targetPage <= totalPages && targetPage !== currentPage) {
        goToPage(targetPage);
      }
    }
  });

  readAloudInitialized = true;
  readAloudPanel.hidden = false;
}

function speakTextWithSpeechNormalizer(rawText, btnElement, requestedRate = 1.0) {
  const rate = typeof requestedRate === "number" ? requestedRate : 1.0;
  StudyReaderInlineSpeech.play("legacy-" + Date.now(), rawText, rate);
}

/* ============================================================
   DOCX / PPTX TEXT VIEWER FALLBACK
   ============================================================ */

async function loadExtractedDocumentText() {
  const response = await fetch(`${API_BASE_URL}/api/pdfs/${encodeURIComponent(currentPdfId)}/text`, {
    method: "GET",
    credentials: "include"
  });
  if (!response.ok) throw new Error("Unable to retrieve extracted text.");
  return response.json();
}

async function loadDocumentTextView() {
  viewerToolbar.hidden = true;
  canvas.hidden = true;
  if (pageWrapper) pageWrapper.style.display = "none";
  documentText.hidden = false;
  canvasContainer.classList.add("text-document-mode");

  try {
    loadingMessage.hidden = false;
    loadingMessage.textContent = "Loading document content and slides...";

    const data = await loadExtractedDocumentText();
    loadingMessage.hidden = true;

    const formattedHtml = data.content?.html || data.formattedHtml;
    const plainText = data.content?.text || data.text;

    // 1. If text/html has already been extracted, render it immediately so the user can read without waiting
    if (formattedHtml || plainText) {
      if (formattedHtml) {
        documentText.innerHTML = formattedHtml;
      } else {
        documentText.innerHTML = `<div style="padding: 24px; font-size: 15px; line-height: 1.7; color: #1e293b; max-width: 860px; margin: 0 auto; white-space: pre-wrap;">${escapeHTML(plainText)}</div>`;
      }

      const count = data.sections?.length || data.pageCount || 1;
      const unit = data.fileType === "pptx" ? (count === 1 ? "Slide" : "Slides") : (data.fileType === "docx" ? (count === 1 ? "Section" : "Sections") : (count === 1 ? "Page" : "Pages"));

      if (data.processingStatus === "processing" || data.processingStatus === "uploaded") {
        pdfStatus.textContent = `${count} ${unit} • Indexing...`;
        setTimeout(async () => {
          try {
            const checkData = await loadExtractedDocumentText();
            if (checkData.processingStatus === "completed") {
              pdfStatus.textContent = `${count} ${unit}`;
            }
          } catch (_) {}
        }, 3500);
      } else {
        pdfStatus.textContent = `${count} ${unit}`;
      }
      return;
    }

    // 2. If no text is available yet and document is still processing, show processing banner with auto-refresh
    if (data.processingStatus === "processing" || data.processingStatus === "uploaded") {
      documentText.innerHTML = `
        <div class="document-processing-banner" style="text-align: center; padding: 48px 24px; max-width: 520px; margin: 40px auto; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 16px;">
          <div style="font-size: 36px; margin-bottom: 12px; animation: pulse 1.5s infinite;">⚡</div>
          <h3 style="font-size: 18px; font-weight: 700; color: #0f172a; margin-bottom: 8px;">Document is being processed</h3>
          <p style="color: #64748b; font-size: 14px; line-height: 1.6; margin-bottom: 20px;">
            AI is currently extracting text, dividing into ${data.fileType === 'pptx' ? 'slides' : 'sections'}, and generating 768-dimensional semantic embeddings.
          </p>
          <button type="button" class="btn-sm btn-primary" onclick="loadDocumentTextView()" style="padding: 8px 18px; font-weight: 600; cursor: pointer;">
            🔄 Refresh Status
          </button>
        </div>
      `;
      pdfStatus.textContent = "Processing...";
      setTimeout(() => {
        if (currentFileType !== "pdf") loadDocumentTextView();
      }, 3000);
      return;
    }

    // 3. Check if processing failed
    if (data.processingStatus === "failed") {
      documentText.innerHTML = `
        <div class="document-error-banner" style="text-align: center; padding: 48px 24px; max-width: 520px; margin: 40px auto; background: #fef2f2; border: 1px solid #fecaca; border-radius: 16px;">
          <div style="font-size: 36px; margin-bottom: 12px;">⚠️</div>
          <h3 style="font-size: 18px; font-weight: 700; color: #dc2626; margin-bottom: 8px;">Document Extraction Failed</h3>
          <p style="color: #991b1b; font-size: 13.5px; line-height: 1.5; margin-bottom: 16px;">
            ${escapeHTML(data.processingError || "Unable to extract readable text from this document archive.")}
          </p>
        </div>
      `;
      pdfStatus.textContent = "Extraction Failed";
      return;
    }

    // 4. Empty state fallback
    documentText.innerHTML = `
      <div style="text-align: center; padding: 48px 24px; color: #64748b;">
        <div style="font-size: 36px; margin-bottom: 8px;">📄</div>
        <h3 style="font-size: 16px; font-weight: 600; color: #1e293b;">No text available in this document</h3>
        <p style="font-size: 13px;">The uploaded file does not contain readable text content.</p>
      </div>
    `;
    pdfStatus.textContent = "0 Pages";

  } catch (err) {
    console.error("Failed to load document text view:", err);
    documentText.innerHTML = `
      <div style="text-align: center; padding: 48px 24px; color: #dc2626;">
        <div style="font-size: 36px; margin-bottom: 8px;">⚠️</div>
        <h3>Failed to load document text</h3>
        <p style="font-size: 13px; color: #64748b;">${escapeHTML(err.message)}</p>
      </div>
    `;
    pdfStatus.textContent = "Error";
    loadingMessage.hidden = true;
  }
}

/* ============================================================
   MARKDOWN PARSER (TABLES, CODE, HEADERS, LISTS)
   ============================================================ */

function formatMarkdown(text) {
  if (!text) return "";

  let html = String(text).replace(/\r\n/g, "\n");

  // Escape HTML tags for safety
  html = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Code blocks: ```code```
  html = html.replace(/```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g, (_, code) => {
    return `<pre style="background: #1e293b; color: #f8fafc; padding: 12px 14px; border-radius: 8px; overflow-x: auto; font-family: monospace; font-size: 13px; margin: 10px 0;"><code>${code.trim()}</code></pre>`;
  });

  // Inline code: `code`
  html = html.replace(/`([^`]+)`/g, "<code style='background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 12.5px; color: #4338ca;'>$1</code>");

  // Markdown tables
  html = html.replace(/((?:^|\n)\|[^\n]+\|\n\|[-:\s|]+\|\n(?:\|[^\n]+\|\n?)+)/g, (match) => {
    const lines = match.trim().split("\n");
    if (lines.length < 3) return match;
    const headerCells = lines[0].split("|").slice(1, -1).map(c => c.trim());
    const bodyRows = lines.slice(2);

    let tableHtml = "<table style='width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 13px; border: 1px solid #e2e8f0;'><thead><tr style='background: #f8fafc;'>";
    headerCells.forEach(cell => {
      tableHtml += `<th style='padding: 8px 12px; border: 1px solid #e2e8f0; text-align: left; font-weight: 700;'>${cell}</th>`;
    });
    tableHtml += "</tr></thead><tbody>";

    bodyRows.forEach((row, i) => {
      const cells = row.split("|").slice(1, -1).map(c => c.trim());
      const bg = i % 2 === 0 ? "#ffffff" : "#f8fafc";
      tableHtml += `<tr style='background: ${bg};'>`;
      cells.forEach(cell => {
        tableHtml += `<td style='padding: 8px 12px; border: 1px solid #e2e8f0;'>${cell}</td>`;
      });
      tableHtml += "</tr>";
    });
    tableHtml += "</tbody></table>";
    return `\n${tableHtml}\n`;
  });

  // Headings
  html = html.replace(/^#### (.*$)/gim, "<h5 style='font-size: 13.5px; font-weight: 700; color: #0f172a; margin: 12px 0 4px;'>$1</h5>");
  html = html.replace(/^### (.*$)/gim, "<h4 style='font-size: 14px; font-weight: 700; color: #0f172a; margin: 14px 0 6px;'>$1</h4>");
  html = html.replace(/^## (.*$)/gim, "<h3 style='font-size: 15px; font-weight: 750; color: #0f172a; margin: 16px 0 8px;'>$1</h3>");
  html = html.replace(/^# (.*$)/gim, "<h2 style='font-size: 16px; font-weight: 800; color: #0f172a; margin: 18px 0 10px;'>$1</h2>");

  // Page, Slide and Section Citations Badges
  html = html.replace(/\[((?:Page|Slide|Section)\s+\d+(?:[,\s-]+\d+)*)\]/gi, "<span class='page-citation-badge' style='display: inline-flex; align-items: center; background: #e0e7ff; color: #4338ca; font-weight: 700; font-size: 11px; padding: 1px 6px; border-radius: 4px; margin: 0 2px;'>[$1]</span>");

  // Bold & Italic
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");

  // Blockquotes
  html = html.replace(/^>\s?(.*$)/gim, "<blockquote style='border-left: 3px solid #6366f1; padding: 6px 14px; margin: 10px 0; background: #eef2ff; color: #3730a3; font-style: italic; border-radius: 0 6px 6px 0;'>$1</blockquote>");

  // Lists and paragraphs
  const lines = html.split("\n");
  const processedLines = [];
  let inUl = false;
  let inOl = false;

  lines.forEach(line => {
    const trimmed = line.trim();
    const isUlItem = /^[-*•]\s+(.*)$/.test(trimmed);
    const isOlItem = /^\d+\.\s+(.*)$/.test(trimmed);

    if (isUlItem) {
      if (!inUl) {
        if (inOl) { processedLines.push("</ol>"); inOl = false; }
        processedLines.push("<ul style='padding-left: 20px; margin: 8px 0;'>");
        inUl = true;
      }
      processedLines.push(trimmed.replace(/^[-*•]\s+(.*)$/, "<li style='margin-bottom: 4px;'>$1</li>"));
    } else if (isOlItem) {
      if (!inOl) {
        if (inUl) { processedLines.push("</ul>"); inUl = false; }
        processedLines.push("<ol style='padding-left: 20px; margin: 8px 0;'>");
        inOl = true;
      }
      processedLines.push(trimmed.replace(/^\d+\.\s+(.*)$/, "<li style='margin-bottom: 4px;'>$1</li>"));
    } else {
      if (inUl) { processedLines.push("</ul>"); inUl = false; }
      if (inOl) { processedLines.push("</ol>"); inOl = false; }
      if (
        trimmed.length > 0 &&
        !trimmed.startsWith("<h") &&
        !trimmed.startsWith("<pre") &&
        !trimmed.startsWith("<table") &&
        !trimmed.startsWith("<blockquote") &&
        !trimmed.startsWith("</")
      ) {
        processedLines.push(`<p style='margin-bottom: 8px;'>${trimmed}</p>`);
      } else {
        processedLines.push(trimmed);
      }
    }
  });

  if (inUl) processedLines.push("</ul>");
  if (inOl) processedLines.push("</ol>");

  return processedLines.join("\n");
}

/* ============================================================
   ERROR HANDLING (RESERVED STRICTLY FOR FATAL DOCUMENT FAILURES)
   ============================================================ */

function showError(message) {
  loadingMessage.hidden = true;
  canvas.hidden = true;
  if (pageWrapper) pageWrapper.style.display = "none";
  errorMessage.hidden = false;
  errorMessage.textContent = message;
  pdfStatus.textContent = "Document Error";
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

/* ============================================================
   PANEL RESIZER (DRAGGABLE BOUNDARY WITH PERSISTENCE)
   ============================================================ */

function initPanelResizer() {
  if (!aiPanelResizer || !documentAiPanel) return;

  const savedWidth = localStorage.getItem("sr_ai_panel_width");
  if (savedWidth && window.innerWidth > 900) {
    const parsedWidth = parseInt(savedWidth, 10);
    if (!isNaN(parsedWidth) && parsedWidth >= 320 && parsedWidth <= 960) {
      documentAiPanel.style.width = `${parsedWidth}px`;
    }
  }

  let startX = 0;
  let startWidth = 0;

  function onMouseMove(e) {
    const delta = startX - e.clientX;
    const minWidth = 320;
    const maxWidth = Math.min(window.innerWidth - 240, 960);
    const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + delta));
    documentAiPanel.style.width = `${newWidth}px`;
  }

  function onMouseUp() {
    documentAiPanel.classList.remove("resizing");
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    const finalWidth = documentAiPanel.offsetWidth;
    localStorage.setItem("sr_ai_panel_width", `${finalWidth}`);
  }

  aiPanelResizer.addEventListener("mousedown", (e) => {
    e.preventDefault();
    startX = e.clientX;
    startWidth = documentAiPanel.offsetWidth;
    documentAiPanel.classList.add("resizing");
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });
}

/* ============================================================
   PANEL TOGGLES (EXPAND TO 720PX & FULL-VIEW CHAT PAGE)
   ============================================================ */

function initPanelToggles() {
  if (btnExpandAiPanel) {
    btnExpandAiPanel.addEventListener("click", () => {
      if (!documentAiPanel) return;
      const isExpanded = documentAiPanel.classList.toggle("expanded");
      if (isExpanded) {
        documentAiPanel.style.width = "720px";
        if (expandText) expandText.textContent = "Collapse";
        if (expandIcon) expandIcon.textContent = "⤡";
        btnExpandAiPanel.classList.add("active");
      } else {
        const saved = localStorage.getItem("sr_ai_panel_width") || "420";
        documentAiPanel.style.width = `${saved}px`;
        if (expandText) expandText.textContent = "Expand";
        if (expandIcon) expandIcon.textContent = "⤢";
        btnExpandAiPanel.classList.remove("active");
      }
    });
  }

  if (btnFullscreenAiPanel) {
    btnFullscreenAiPanel.addEventListener("click", () => {
      toggleFullViewChat();
    });
  }

  if (btnReturnToPdf) {
    btnReturnToPdf.addEventListener("click", () => {
      toggleFullViewChat(false);
    });
  }
}

function toggleFullViewChat(forceState) {
  if (!documentAiPanel) return;
  const isCurrentlyFull = documentAiPanel.classList.contains("full-view");
  const shouldBeFull = forceState !== undefined ? forceState : !isCurrentlyFull;

  if (shouldBeFull) {
    documentAiPanel.classList.add("full-view");
    documentAiPanel.hidden = false;
    documentAiPanel.style.display = "flex";
    if (btnFullscreenAiPanel) btnFullscreenAiPanel.classList.add("active");
    if (fullscreenIcon) fullscreenIcon.textContent = "↙";
    if (fullscreenText) fullscreenText.textContent = "Exit Full-View";
  } else {
    documentAiPanel.classList.remove("full-view");
    if (btnFullscreenAiPanel) btnFullscreenAiPanel.classList.remove("active");
    if (fullscreenIcon) fullscreenIcon.textContent = "↗";
    if (fullscreenText) fullscreenText.textContent = "Full-View";
  }
}

/* ============================================================
   MODALS & EMPTY STATE SELECTION HANDLERS
   ============================================================ */

function connectModalsAndEmptyState() {
  // Modal close triggers
  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const modalId = btn.getAttribute("data-close-modal");
      const modal = document.getElementById(modalId);
      if (modal) {
        if (typeof modal.close === "function") {
          modal.close();
        } else {
          modal.removeAttribute("open");
        }
      }
    });
  });

  // Empty state actions
  if (btnEmptyChooseLibrary) {
    btnEmptyChooseLibrary.addEventListener("click", () => {
      stopAllSpeechAudio();
      openLibraryPicker();
    });
  }
  if (btnEmptyUploadDoc) {
    btnEmptyUploadDoc.addEventListener("click", () => {
      stopAllSpeechAudio();
      openWorkspaceUpload();
    });
  }

  // Topbar switch doc button
  if (btnSwitchDoc) {
    btnSwitchDoc.addEventListener("click", () => {
      stopAllSpeechAudio();
      openLibraryPicker();
    });
  }

  // Button inside library picker to open upload modal
  if (btnOpenUploadFromPicker) {
    btnOpenUploadFromPicker.addEventListener("click", () => {
      if (modalLibraryPicker) {
        if (typeof modalLibraryPicker.close === "function") {
          modalLibraryPicker.close();
        } else {
          modalLibraryPicker.removeAttribute("open");
        }
      }
      openWorkspaceUpload();
    });
  }

  // Live search in library picker
  if (libraryPickerSearch) {
    libraryPickerSearch.addEventListener("input", (e) => {
      renderLibraryPickerList(e.target.value.trim().toLowerCase());
    });
  }

  // Upload form submission
  if (formWorkspaceUpload) {
    formWorkspaceUpload.addEventListener("submit", handleWorkspaceUploadSubmit);
  }
}

async function openLibraryPicker() {
  stopAllSpeechAudio();
  if (!modalLibraryPicker) return;
  if (typeof modalLibraryPicker.showModal === "function") {
    modalLibraryPicker.showModal();
  } else {
    modalLibraryPicker.setAttribute("open", "");
  }

  if (libraryPickerSearch) libraryPickerSearch.value = "";
  if (libraryPickerLoading) libraryPickerLoading.style.display = "block";
  if (libraryPickerEmpty) libraryPickerEmpty.style.display = "none";
  if (libraryPickerList) libraryPickerList.style.display = "none";

  try {
    const apiBase = window.API_BASE_URL || "http://127.0.0.1:3000";
    const res = await fetch(`${apiBase}/api/pdfs`, {
      method: "GET",
      credentials: "include"
    });

    if (res.status === 401) {
      window.location.href = "../login/index.html";
      return;
    }

    if (!res.ok) throw new Error("Could not load documents from library.");

    const data = await res.json();
    cachedLibraryPdfs = Array.isArray(data.pdfs) ? data.pdfs : [];
    renderLibraryPickerList();

  } catch (err) {
    console.error("Library picker fetch error:", err);
    if (libraryPickerLoading) {
      libraryPickerLoading.textContent = "Unable to fetch library documents. Please try again.";
    }
  }
}

function renderLibraryPickerList(filter = "") {
  if (libraryPickerLoading) libraryPickerLoading.style.display = "none";
  if (!libraryPickerList) return;

  const matches = cachedLibraryPdfs.filter((pdf) => {
    if (!filter) return true;
    const name = (pdf.originalFilename || pdf.filename || "").toLowerCase();
    const subj = (pdf.subjectName || "").toLowerCase();
    const cat = (pdf.category || "").toLowerCase();
    return name.includes(filter) || subj.includes(filter) || cat.includes(filter);
  });

  if (matches.length === 0) {
    if (libraryPickerEmpty) libraryPickerEmpty.style.display = "block";
    libraryPickerList.style.display = "none";
    return;
  }

  if (libraryPickerEmpty) libraryPickerEmpty.style.display = "none";
  libraryPickerList.style.display = "grid";
  libraryPickerList.innerHTML = "";

  matches.forEach((pdf) => {
    const card = document.createElement("div");
    card.className = "library-picker-item";
    const displayName = pdf.originalFilename || pdf.filename || "Academic Document";
    const categoryLabel = pdf.category === "pyq" ? "PYQ" : "Notes";
    const badgeBg = pdf.category === "pyq" ? "#fef3c7" : "#e0e7ff";
    const badgeColor = pdf.category === "pyq" ? "#b45309" : "#4338ca";

    card.innerHTML = `
      <div style="font-size: 26px; flex-shrink: 0;">📄</div>
      <div style="flex: 1; min-width: 0;">
        <strong style="display: block; font-size: 13.5px; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${escapeHTML(displayName)}
        </strong>
        <div style="display: flex; gap: 6px; align-items: center; margin-top: 4px; font-size: 11.5px; color: #64748b;">
          <span style="background: ${badgeBg}; color: ${badgeColor}; padding: 1px 6px; border-radius: 4px; font-weight: 700; font-size: 10px;">
            ${categoryLabel}
          </span>
          <span>${pdf.subjectName ? escapeHTML(pdf.subjectName) : "General"}</span>
          <span>•</span>
          <span>${pdf.pageCount ? `${pdf.pageCount} pages` : "Document"}</span>
        </div>
      </div>
      <button type="button" class="btn-sm primary" style="padding: 4px 10px; font-size: 11.5px; flex-shrink: 0;">
        Open
      </button>
    `;

    card.addEventListener("click", () => {
      if (modalLibraryPicker) {
        if (typeof modalLibraryPicker.close === "function") {
          modalLibraryPicker.close();
        } else {
          modalLibraryPicker.removeAttribute("open");
        }
      }
      openDocument(pdf.id);
    });

    libraryPickerList.appendChild(card);
  });
}

async function openWorkspaceUpload() {
  if (!modalWorkspaceUpload) return;
  if (typeof modalWorkspaceUpload.showModal === "function") {
    modalWorkspaceUpload.showModal();
  } else {
    modalWorkspaceUpload.setAttribute("open", "");
  }

  if (formWorkspaceUpload) formWorkspaceUpload.reset();
  if (workspaceUploadStatus) workspaceUploadStatus.style.display = "none";

  // Fetch subjects to populate select
  if (selectWorkspaceSubject) {
    try {
      const apiBase = window.API_BASE_URL || "http://127.0.0.1:3000";
      const res = await fetch(`${apiBase}/api/subjects/my-subjects`, {
        method: "GET",
        credentials: "include"
      });
      if (res.ok) {
        const data = await res.json();
        const subjects = Array.isArray(data.subjects) ? data.subjects : (Array.isArray(data) ? data : []);
        selectWorkspaceSubject.innerHTML = '<option value="">General / No subject</option>';
        subjects.forEach((subj) => {
          const opt = document.createElement("option");
          opt.value = subj.id;
          opt.textContent = subj.name + (subj.code ? ` (${subj.code})` : "");
          selectWorkspaceSubject.appendChild(opt);
        });
      }
    } catch (_) {}
  }
}

async function handleWorkspaceUploadSubmit(e) {
  e.preventDefault();
  if (!inputWorkspaceFile || !inputWorkspaceFile.files || !inputWorkspaceFile.files[0]) {
    alert("Please select a file to upload.");
    return;
  }

  const file = inputWorkspaceFile.files[0];
  const subjectId = selectWorkspaceSubject ? selectWorkspaceSubject.value : "";
  const category = selectWorkspaceCategory ? selectWorkspaceCategory.value : "resource";

  const formData = new FormData();
  formData.append("pdf", file);
  if (subjectId) formData.append("subjectId", subjectId);
  formData.append("category", category);

  if (btnSubmitWorkspaceUpload) {
    btnSubmitWorkspaceUpload.disabled = true;
    btnSubmitWorkspaceUpload.textContent = "Uploading & Processing...";
  }

  if (workspaceUploadStatus) {
    workspaceUploadStatus.style.display = "block";
    workspaceUploadStatus.style.background = "#eef2ff";
    workspaceUploadStatus.style.color = "#4338ca";
    workspaceUploadStatus.textContent = "Uploading document and preparing AI study space...";
  }

  try {
    const apiBase = window.API_BASE_URL || "http://127.0.0.1:3000";
    const res = await fetch(`${apiBase}/api/pdfs/upload`, {
      method: "POST",
      credentials: "include",
      body: formData
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.message || "Failed to upload document.");
    }

    const uploadedId = data.pdf?.id || data.id;
    if (!uploadedId) {
      throw new Error("Upload succeeded but no document ID returned.");
    }

    if (workspaceUploadStatus) {
      workspaceUploadStatus.style.background = "#ecfdf5";
      workspaceUploadStatus.style.color = "#059669";
      workspaceUploadStatus.textContent = "Document ready! Opening...";
    }

    setTimeout(() => {
      if (modalWorkspaceUpload) {
        if (typeof modalWorkspaceUpload.close === "function") {
          modalWorkspaceUpload.close();
        } else {
          modalWorkspaceUpload.removeAttribute("open");
        }
      }
      if (btnSubmitWorkspaceUpload) {
        btnSubmitWorkspaceUpload.disabled = false;
        btnSubmitWorkspaceUpload.textContent = "Upload & Open Document";
      }
      openDocument(uploadedId);
    }, 400);

  } catch (err) {
    console.error("Workspace upload error:", err);
    if (workspaceUploadStatus) {
      workspaceUploadStatus.style.display = "block";
      workspaceUploadStatus.style.background = "#fff1f2";
      workspaceUploadStatus.style.color = "#dc2626";
      workspaceUploadStatus.textContent = err.message || "Upload failed. Please try again.";
    }
    if (btnSubmitWorkspaceUpload) {
      btnSubmitWorkspaceUpload.disabled = false;
      btnSubmitWorkspaceUpload.textContent = "Upload & Open Document";
    }
  }
}
})();
