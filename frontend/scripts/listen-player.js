/**
 * StudyReader Listen — Advanced Neural Audio Player & Synchronized Highlighting
 * 
 * Features:
 * - Neural voice synthesis (Cloudflare Deepgram Aura-2) with fallback to Browser SpeechSynthesis
 * - Synchronized PDF/DOCX/PPTX sentence highlighting (Follow Along)
 * - Real-time word-level pointing while speaking (Follow Along word tracking)
 * - Sentence-to-sentence background audio prefetch (< 1s pause between lines)
 * - Page-wise listening with manual Continue button boundary control
 * - Click-to-listen navigation
 * - Smart Resume across sessions
 * - Bookmarks & Notes drawer (non-intrusive popover above bar)
 * - Sleep timer & Focus mode
 * - Speed (0.75x - 2x) & Seek (±15s)
 */

(function () {
  const API_BASE_URL = window.API_BASE_URL || "";

  class ListenPlayer {
    constructor() {
      this.documentId = null;
      this.blocks = [];
      this.currentBlockIndex = 0;
      this.currentSentenceIndex = 0;
      this.isPlaying = false;
      this.isPaused = false;
      this.speed = 1.0;
      this.voiceId = "cf:luna";
      this.followAlong = true;
      this.focusMode = false;
      this.sleepTimer = null;
      this.sleepTimerRemainingSeconds = 0;
      this.sleepTimerInterval = null;

      this.audio = new Audio();
      this.audio.preload = "auto";
      this.currentUtterance = null;
      this.audioPreloadCache = new Map();
      this.currentAbortController = null;
      this.nextPendingPageNum = null;
      this.sentencePauseTimer = null;

      this.elements = {};
      this.onPageChangeCallback = null;
      this.historyLoaded = false;
      this._voicesBound = false;
    }

    /**
     * Mounts the Listen Player into the DOM and sets up event listeners.
     */
    init(options = {}) {
      this.documentId = options.documentId;
      this.onPageChangeCallback = options.onPageChange || null;
      this.pendingInitialPage = options.currentPage || options.initialPage || 1;

      // If client sections are provided, use them as instant fallback
      if (Array.isArray(options.sections) && options.sections.length > 0) {
        this.setFallbackBlocksFromSections(options.sections);
      }

      this.renderPlayerUI();
      this.bindAudioEvents();
      this.loadVoices();
      this.loadDocumentBlocks();
      this.checkSmartResume();
      this.bindClickToListen();
    }

    /**
     * Converts client sections into instant reading blocks so the player
     * is playable immediately without waiting for server block analysis.
     */
    setFallbackBlocksFromSections(sections) {
      if (!Array.isArray(sections) || sections.length === 0) return;
      const validSections = sections.filter(sec => sec && (sec.text || "").trim().length > 0);
      if (validSections.length === 0) return;

      this.blocks = validSections.map((sec, idx) => {
        const rawText = sec.text || "";
        const sentences = (rawText.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [rawText])
          .map(s => s.trim())
          .filter(Boolean)
          .map(s => ({ raw: s, spoken: s }));

        return {
          blockId: `client_sec_${idx}`,
          pageNumber: sec.pageNumber || idx + 1,
          title: sec.label || `Page ${idx + 1}`,
          rawText,
          spokenText: rawText,
          sentences: sentences.length > 0 ? sentences : [{ raw: rawText || "Page content", spoken: rawText || "Page content" }]
        };
      });
    }

    /**
     * Renders modern floating player HTML into the document study area.
     */
    renderPlayerUI() {
      let existing = document.getElementById("studyreader-listen-container");
      if (existing) existing.remove();

      const container = document.createElement("div");
      container.id = "studyreader-listen-container";
      container.className = "studyreader-listen-bar";

      container.innerHTML = `
        <!-- Row 1: Document Info & Page Switcher & Actions -->
        <div class="listen-bar-header">
          <div class="listen-track-info">
            <div class="listen-track-title">
              <span id="listen-doc-title">🎧 StudyReader Listen</span>
              <button type="button" id="btn-listen-prev-page" class="listen-page-nav-btn" title="Previous Page">‹</button>
              <select id="select-listen-page" class="listen-badge" style="cursor: pointer; border: 1px solid #c7d2fe; outline: none; background: #eef2ff; color: #4338ca; padding: 2px 8px; font-weight: 700;" title="Choose page to read">
                <option value="1">Page 1</option>
              </select>
              <button type="button" id="btn-listen-next-page" class="listen-page-nav-btn" title="Next Page">›</button>
            </div>
            <div class="listen-track-subtitle">
              <span id="listen-block-label">Loading natural reading blocks...</span>
              <span id="listen-sleep-badge" style="display: none;" class="listen-badge">⏳ 15m</span>
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 6px;">
            <button type="button" id="btn-listen-bookmark" class="listen-pill-btn" title="View or Add Bookmarks">🔖 Mark</button>
            <button type="button" id="btn-listen-focus" class="listen-pill-btn" title="Distraction-Free Focus Mode">🎯 Focus</button>
            <button type="button" id="btn-listen-close" class="listen-btn" style="width: 28px; height: 28px; font-size: 11px;" title="Close Player">✕</button>
          </div>
        </div>

        <!-- Row 2: Main Transport Controls Centered -->
        <div class="listen-transport-row">
          <div class="listen-transport-controls">
            <button type="button" id="btn-listen-prev-sent" class="listen-btn" title="Previous Sentence">⏮</button>
            <button type="button" id="btn-listen-seek-back" class="listen-btn" title="Back 15s">↺ 15</button>
            <button type="button" id="btn-listen-play-toggle" class="listen-btn listen-btn-primary" title="Play / Pause">▶</button>
            <button type="button" id="btn-listen-seek-fwd" class="listen-btn" title="Forward 15s">15 ↻</button>
            <button type="button" id="btn-listen-next-sent" class="listen-btn" title="Next Sentence">⏭</button>
            <button type="button" id="btn-listen-stop" class="listen-btn" title="Stop">⏹</button>
            <button type="button" id="btn-listen-continue-page" class="listen-pill-btn listen-btn-primary" style="display: none; padding: 6px 14px; font-weight: 700; margin-left: 6px;" title="Continue to Next Page">▶ Continue Page</button>
          </div>
        </div>

        <!-- Row 3: Progress Slider -->
        <div class="listen-progress-row">
          <span id="listen-time-elapsed" class="listen-time">0:00</span>
          <div class="listen-slider-container" id="listen-slider-track">
            <div class="listen-slider-fill" id="listen-slider-fill"></div>
          </div>
          <span id="listen-time-remaining" class="listen-time">-0:00</span>
        </div>

        <!-- Row 4: Controls Row -->
        <div class="listen-controls-row">
          <div class="listen-select-group">
            <span class="listen-label">Voice:</span>
            <select id="select-listen-voice" class="listen-select" style="max-width: 200px;">
              <option value="cf:luna">Luna (Neural Studio — Female)</option>
              <option value="cf:orion">Orion (Neural Studio — Male)</option>
            </select>
          </div>

          <div class="listen-select-group">
            <span class="listen-label">Speed:</span>
            <select id="select-listen-speed" class="listen-select">
              <option value="0.75">0.75x</option>
              <option value="1.0" selected>1.0x</option>
              <option value="1.25">1.25x</option>
              <option value="1.5">1.5x</option>
              <option value="1.75">1.75x</option>
              <option value="2.0">2.0x</option>
            </select>
          </div>

          <div class="listen-select-group">
            <span class="listen-label">Sleep:</span>
            <select id="select-listen-sleep" class="listen-select">
              <option value="off" selected>Off</option>
              <option value="15">15m</option>
              <option value="30">30m</option>
              <option value="45">45m</option>
              <option value="60">60m</option>
            </select>
          </div>

          <div style="display: flex; gap: 8px; margin-left: auto;">
            <button type="button" id="btn-toggle-follow" class="listen-pill-btn active" title="Toggle Synchronized Highlighting">✨ Follow Along</button>
            <button type="button" id="btn-listen-ai-explain" class="listen-pill-btn" title="Ask AI Tutor to explain active sentence">🤖 Explain</button>
          </div>
        </div>

        <!-- Bookmarks Drawer (Positioned above bar as popup, non-intrusive) -->
        <div id="listen-bookmarks-drawer" class="listen-drawer">
          <div class="listen-drawer-head">
            <h3 style="margin: 0; font-size: 14px; font-weight: 700; color: #0f172a;">🔖 Bookmarks</h3>
            <div style="display: flex; gap: 6px; align-items: center;">
              <button type="button" id="btn-add-bookmark-action" class="listen-pill-btn" style="padding: 2px 8px; font-size: 11px;">+ New</button>
              <button type="button" id="btn-close-drawer" class="listen-btn" style="width: 24px; height: 24px; font-size: 11px;">✕</button>
            </div>
          </div>
          <div class="listen-drawer-body" id="listen-bookmarks-list">
            <p style="color: #64748b; font-size: 12px; margin: 0;">No bookmarks saved yet. Click '+ New' while listening to save key points.</p>
          </div>
        </div>
      `;

      // Mount into viewer area
      const viewerArea = document.querySelector(".pdf-viewer-area") || document.body;
      viewerArea.appendChild(container);

      // Cache DOM references
      this.elements = {
        container,
        docTitle: container.querySelector("#listen-doc-title"),
        selectPage: container.querySelector("#select-listen-page"),
        pageBadge: container.querySelector("#select-listen-page"),
        blockLabel: container.querySelector("#listen-block-label"),
        sleepBadge: container.querySelector("#listen-sleep-badge"),
        btnPlayToggle: container.querySelector("#btn-listen-play-toggle"),
        btnPrevPage: container.querySelector("#btn-listen-prev-page"),
        btnNextPage: container.querySelector("#btn-listen-next-page"),
        btnContinuePage: container.querySelector("#btn-listen-continue-page"),
        btnPrevSent: container.querySelector("#btn-listen-prev-sent"),
        btnNextSent: container.querySelector("#btn-listen-next-sent"),
        btnSeekBack: container.querySelector("#btn-listen-seek-back"),
        btnSeekFwd: container.querySelector("#btn-listen-seek-fwd"),
        btnStop: container.querySelector("#btn-listen-stop"),
        btnBookmark: container.querySelector("#btn-listen-bookmark"),
        btnAddBookmark: container.querySelector("#btn-add-bookmark-action"),
        btnFocus: container.querySelector("#btn-listen-focus"),
        btnClose: container.querySelector("#btn-listen-close"),
        selectVoice: container.querySelector("#select-listen-voice"),
        selectSpeed: container.querySelector("#select-listen-speed"),
        selectSleep: container.querySelector("#select-listen-sleep"),
        btnToggleFollow: container.querySelector("#btn-toggle-follow"),
        btnAiExplain: container.querySelector("#btn-listen-ai-explain"),
        sliderTrack: container.querySelector("#listen-slider-track"),
        sliderFill: container.querySelector("#listen-slider-fill"),
        timeElapsed: container.querySelector("#listen-time-elapsed"),
        timeRemaining: container.querySelector("#listen-time-remaining"),
        drawer: container.querySelector("#listen-bookmarks-drawer"),
        bookmarksList: container.querySelector("#listen-bookmarks-list"),
        btnCloseDrawer: container.querySelector("#btn-close-drawer")
      };

      this.bindUIEvents();
    }

    /**
     * Binds UI click and change events.
     */
    bindUIEvents() {
      const el = this.elements;

      el.btnPlayToggle.addEventListener("click", () => this.togglePlay());
      el.btnStop.addEventListener("click", () => this.stop());
      el.btnSeekBack.addEventListener("click", () => this.seekBy(-15));
      el.btnSeekFwd.addEventListener("click", () => this.seekBy(15));
      el.btnPrevSent.addEventListener("click", () => this.previousSentence());
      el.btnNextSent.addEventListener("click", () => this.nextSentence());

      if (el.btnPrevPage) {
        el.btnPrevPage.addEventListener("click", () => this.previousPage());
      }
      if (el.btnNextPage) {
        el.btnNextPage.addEventListener("click", () => this.nextPage());
      }
      if (el.btnContinuePage) {
        el.btnContinuePage.addEventListener("click", () => this.continueToNextPage());
      }
      if (el.selectPage) {
        el.selectPage.addEventListener("change", (e) => {
          const p = parseInt(e.target.value, 10);
          this.jumpToPage(p);
        });
      }

      el.selectSpeed.addEventListener("change", (e) => {
        this.speed = parseFloat(e.target.value) || 1.0;
        this.audio.playbackRate = this.speed;
        this.saveHistoryProgress();
      });

      el.selectVoice.addEventListener("change", (e) => {
        this.voiceId = e.target.value;
        this.saveHistoryProgress();
        if (this.isPlaying) {
          this.playSentence(this.currentBlockIndex, this.currentSentenceIndex);
        }
      });

      el.selectSleep.addEventListener("change", (e) => {
        this.setSleepTimer(e.target.value);
      });

      el.btnToggleFollow.addEventListener("click", () => {
        this.followAlong = !this.followAlong;
        el.btnToggleFollow.classList.toggle("active", this.followAlong);
        if (this.followAlong) {
          this.highlightCurrentSentence();
        } else {
          this.clearHighlights();
        }
      });

      el.btnFocus.addEventListener("click", () => {
        this.focusMode = !this.focusMode;
        document.body.classList.toggle("listen-focus-mode", this.focusMode);
        el.btnFocus.classList.toggle("active", this.focusMode);
      });

      el.btnClose.addEventListener("click", () => {
        this.stop();
        el.container.style.display = "none";
        document.body.classList.remove("listen-focus-mode");
      });

      // Scrubbing progress track
      el.sliderTrack.addEventListener("click", (e) => {
        const rect = el.sliderTrack.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        if (this.audio.duration) {
          this.audio.currentTime = percent * this.audio.duration;
        }
      });

      // Bookmarks Drawer toggle & add
      el.btnBookmark.addEventListener("click", () => this.toggleBookmarksDrawer());
      if (el.btnAddBookmark) {
        el.btnAddBookmark.addEventListener("click", () => this.openAddBookmarkPrompt());
      }
      el.btnCloseDrawer.addEventListener("click", () => el.drawer.classList.remove("open"));

      // Click outside drawer to close
      document.addEventListener("click", (e) => {
        if (el.drawer && el.drawer.classList.contains("open")) {
          if (!el.drawer.contains(e.target) && e.target !== el.btnBookmark) {
            el.drawer.classList.remove("open");
          }
        }
      });

      // AI Explain current sentence
      el.btnAiExplain.addEventListener("click", () => this.explainCurrentSentence());
    }

    /**
     * Toggles bookmarks drawer open/closed.
     */
    toggleBookmarksDrawer() {
      if (this.elements.drawer.classList.contains("open")) {
        this.elements.drawer.classList.remove("open");
      } else {
        this.loadBookmarks(true);
      }
    }

    /**
     * Binds HTML5 Audio events for progress tracking and natural chunk advance.
     */
    bindAudioEvents() {
      this.audio.addEventListener("timeupdate", () => {
        if (!this.audio.duration) return;
        const current = this.audio.currentTime;
        const total = this.audio.duration;
        const pct = (current / total) * 100;

        this.elements.sliderFill.style.width = `${pct}%`;
        this.elements.timeElapsed.textContent = this.formatTime(current);
        this.elements.timeRemaining.textContent = `-${this.formatTime(Math.max(0, total - current))}`;

        // Word-level follow-along estimate for neural audio playback
        if (this.followAlong && total > 0) {
          const block = this.blocks[this.currentBlockIndex];
          const sentenceObj = block?.sentences?.[this.currentSentenceIndex];
          const raw = sentenceObj?.raw || "";
          const words = raw.split(/\s+/).filter(Boolean);
          if (words.length > 0) {
            const wordIdx = Math.min(words.length - 1, Math.floor((current / total) * words.length));
            this.highlightSpokenWord(words[wordIdx]);
          }
        }
      });

      this.audio.addEventListener("ended", () => {
        if (this.isPlaying && !this.isPaused) {
          this.nextSentence();
        }
      });

      this.audio.addEventListener("error", (e) => {
        if (!this.isPlaying || this.isPaused) return;
        console.warn("[ListenPlayer] Audio playback issue, falling back to browser speech synthesis:", e);
        this.fallbackToBrowserSpeech();
      });
    }

    /**
     * Formats seconds into MM:SS display.
     */
    formatTime(seconds) {
      if (isNaN(seconds) || seconds < 0) return "0:00";
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
    }

    /**
     * Populates available voices dropdown from backend and local speech synthesis.
     */
    async loadVoices() {
      let serverVoices = [];
      try {
        const res = await fetch(`${API_BASE_URL}/api/listen/voices`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          serverVoices = data.voices || [];
        }
      } catch (err) {
        console.warn("[ListenPlayer] Could not fetch server voices:", err.message);
      }

      const sel = this.elements.selectVoice;
      if (!sel) return;
      sel.innerHTML = "";

      // Server neural studio voices first
      const cfGroup = document.createElement("optgroup");
      cfGroup.label = "Studio Neural Voices (Cloudflare)";

      const browserGroup = document.createElement("optgroup");
      browserGroup.label = "Device / Browser Voices";

      serverVoices.forEach(v => {
        if (!v) return;
        const opt = document.createElement("option");
        opt.value = v.id || v.voice || "";
        const displayName = v.name || v.label || v.displayName || v.id || "Voice";
        opt.textContent = `${displayName}${v.isStudio ? " ✦" : ""}`;
        if (opt.textContent.includes("undefined")) {
          opt.textContent = opt.value || "Neural Voice";
        }
        if (v.provider === "cloudflare" || v.provider === "google" || (v.id && (v.id.startsWith("cf:") || v.id.startsWith("gcp:")))) {
          cfGroup.appendChild(opt);
        } else {
          browserGroup.appendChild(opt);
        }
      });

      // Also dynamically populate device SpeechSynthesis voices
      if ("speechSynthesis" in window) {
        const localVoices = window.speechSynthesis.getVoices() || [];
        localVoices.forEach(lv => {
          if (!lv) return;
          const name = lv.name || lv.voiceURI || "Device Voice";
          const id = `browser:${name}`;
          if (!browserGroup.querySelector(`option[value="${id}"]`)) {
            const opt = document.createElement("option");
            opt.value = id;
            opt.textContent = lv.lang ? `${name} (${lv.lang})` : name;
            if (opt.textContent.includes("undefined")) {
              opt.textContent = name;
            }
            browserGroup.appendChild(opt);
          }
        });

        // Listen for async voice loading on Chrome/Safari/Edge
        if (localVoices.length === 0 && !this._voicesBound) {
          this._voicesBound = true;
          window.speechSynthesis.onvoiceschanged = () => {
            this.loadVoices();
          };
        }
      }

      if (cfGroup.children.length > 0) sel.appendChild(cfGroup);
      if (browserGroup.children.length > 0) sel.appendChild(browserGroup);

      if (this.voiceId && sel.querySelector(`option[value="${this.voiceId}"]`)) {
        sel.value = this.voiceId;
      } else if (sel.options.length > 0) {
        sel.selectedIndex = 0;
        this.voiceId = sel.value;
      }
    }

    /**
     * Fetches normalized reading blocks for the current document.
     */
    async loadDocumentBlocks() {
      if (!this.documentId) return;

      try {
        this.isLoadingBlocks = true;
        if (!this.blocks.length) {
          this.elements.blockLabel.textContent = "Analyzing document structure...";
        }
        const res = await fetch(`${API_BASE_URL}/api/listen/document/${encodeURIComponent(this.documentId)}/blocks`, {
          credentials: "include"
        });

        if (!res.ok) throw new Error("Unable to fetch reading blocks");
        const data = await res.json();

        if (data.blocks && data.blocks.length > 0) {
          this.blocks = data.blocks;
          this.elements.docTitle.textContent = `🎧 ${data.title || "Study Document"}`;

          // If an initial or user-selected page was passed, cue that page directly
          if (this.pendingInitialPage && this.pendingInitialPage > 1) {
            const foundIdx = this.blocks.findIndex(b => b.pageNumber === this.pendingInitialPage);
            if (foundIdx !== -1) {
              this.currentBlockIndex = foundIdx;
              this.currentSentenceIndex = 0;
            }
          }

          this.updatePageSelectOptions();
          this.updateBlockUI({ syncViewer: false });
          if (this.playWhenReady) {
            this.playWhenReady = false;
            this.play();
          }
        } else if (!this.blocks.length) {
          this.elements.blockLabel.textContent = "Ready for playback";
        }
      } catch (err) {
        console.warn("[ListenPlayer] Block loading notice:", err.message);
        if (!this.blocks.length) {
          this.elements.blockLabel.textContent = "Ready for playback";
        }
      } finally {
        this.isLoadingBlocks = false;
      }
    }

    /**
     * Populates the page dropdown with all available pages.
     */
    updatePageSelectOptions() {
      const sel = this.elements.selectPage;
      if (!sel) return;
      sel.innerHTML = "";
      const pageNumbers = [...new Set(this.blocks.map(b => b.pageNumber || 1))].sort((a, b) => a - b);
      if (pageNumbers.length === 0) {
        const opt = document.createElement("option");
        opt.value = "1";
        opt.textContent = "Page 1";
        sel.appendChild(opt);
        return;
      }
      pageNumbers.forEach(p => {
        const opt = document.createElement("option");
        opt.value = String(p);
        opt.textContent = `Page ${p}`;
        sel.appendChild(opt);
      });
      const currentBlock = this.blocks[this.currentBlockIndex];
      const currPage = currentBlock?.pageNumber || 1;
      sel.value = String(currPage);
    }

    /**
     * Updates the status badge and label based on current block and sentence.
     */
    updateBlockUI(options = {}) {
      const block = this.blocks[this.currentBlockIndex];
      if (!block) return;

      const pageNum = block.pageNumber || 1;
      if (this.elements.selectPage && this.elements.selectPage.value !== String(pageNum)) {
        this.elements.selectPage.value = String(pageNum);
      }
      if (this.elements.pageBadge && this.elements.pageBadge !== this.elements.selectPage) {
        this.elements.pageBadge.textContent = `Page ${pageNum}`;
      }

      const totalSentences = block.sentences?.length || 1;
      this.elements.blockLabel.textContent = `${block.title || "Section"} • Sentence ${this.currentSentenceIndex + 1}/${totalSentences}`;

      // Notify page wrapper ONLY when actively reading and followAlong is active
      if (options.syncViewer !== false && this.isPlaying && this.followAlong && typeof this.onPageChangeCallback === "function") {
        this.onPageChangeCallback(pageNum);
      }
    }

    /**
     * Jumps directly to a target page number.
     */
    jumpToPage(targetPageNum) {
      if (!this.blocks.length) return;
      const targetIdx = this.blocks.findIndex(b => b.pageNumber === targetPageNum);
      if (targetIdx !== -1) {
        if (this.elements.btnContinuePage) {
          this.elements.btnContinuePage.style.display = "none";
        }
        this.nextPendingPageNum = null;
        this.currentBlockIndex = targetIdx;
        this.currentSentenceIndex = 0;
        if (this.onPageChangeCallback) {
          this.onPageChangeCallback(targetPageNum);
        }
        this.updateBlockUI({ syncViewer: false });
        if (this.isPlaying) {
          this.playSentence(this.currentBlockIndex, 0);
        }
      }
    }

    /**
     * Advances to first sentence of next page.
     */
    nextPage() {
      if (!this.blocks.length) return;
      const currentBlock = this.blocks[this.currentBlockIndex];
      const currentPageNum = currentBlock?.pageNumber || 1;
      const maxPage = Math.max(...this.blocks.map(b => b.pageNumber || 1));
      const targetPageNum = Math.min(maxPage, currentPageNum + 1);
      this.jumpToPage(targetPageNum);
    }

    /**
     * Jumps to first sentence of previous page.
     */
    previousPage() {
      if (!this.blocks.length) return;
      const currentBlock = this.blocks[this.currentBlockIndex];
      const currentPageNum = currentBlock?.pageNumber || 1;
      const targetPageNum = Math.max(1, currentPageNum - 1);
      this.jumpToPage(targetPageNum);
    }

    /**
     * Synchronizes reading position when user manually navigates in the PDF viewer.
     */
    syncPage(pageNumber) {
      const page = parseInt(pageNumber, 10);
      if (isNaN(page) || page < 1 || !this.blocks.length) return;
      const targetIdx = this.blocks.findIndex(b => b.pageNumber === page);
      if (targetIdx !== -1 && targetIdx !== this.currentBlockIndex) {
        this.currentBlockIndex = targetIdx;
        this.currentSentenceIndex = 0;
        this.updateBlockUI({ syncViewer: false });
        if (this.isPlaying) {
          this.playSentence(this.currentBlockIndex, 0);
        }
      }
    }

    /**
     * Plays or pauses audio playback.
     */
    togglePlay() {
      if (this.isPlaying && !this.isPaused) {
        this.pause();
      } else {
        this.play();
      }
    }

    /**
     * Begins or resumes playback.
     */
    async play() {
      // If waiting on page boundary, Continue button has priority
      if (this.elements.btnContinuePage && this.elements.btnContinuePage.style.display !== "none") {
        this.continueToNextPage();
        return;
      }

      // Check if paused HTML5 audio can be resumed directly
      if (this.isPaused && this.audio.src) {
        try {
          await this.audio.play();
          this.isPlaying = true;
          this.isPaused = false;
          this.elements.btnPlayToggle.textContent = "⏸";
          if (this.elements.btnContinuePage) this.elements.btnContinuePage.style.display = "none";
          this.highlightCurrentSentence();
          return;
        } catch (e) {
          console.warn("[ListenPlayer] Resume failed, replaying sentence:", e);
        }
      }

      this.isPlaying = true;
      this.isPaused = false;
      this.playWhenReady = false;
      if (this.elements.btnPlayToggle) {
        this.elements.btnPlayToggle.textContent = "⏸";
      }
      if (this.elements.btnContinuePage) {
        this.elements.btnContinuePage.style.display = "none";
      }

      if (this.isLoadingBlocks) {
        this.playWhenReady = true;
        this.elements.blockLabel.textContent = "⏳ Loading reading blocks...";
        return;
      }

      if (!this.blocks || this.blocks.length === 0) {
        this.playWhenReady = true;
        this.elements.blockLabel.textContent = "⏳ Loading document audio...";
        await this.loadDocumentBlocks();
        if (!this.blocks || this.blocks.length === 0) {
          this.elements.blockLabel.textContent = "⚠️ No readable text found for speech synthesis.";
          this.isPlaying = false;
          this.playWhenReady = false;
          if (this.elements.btnPlayToggle) this.elements.btnPlayToggle.textContent = "▶";
          return;
        }
      }

      // If current block has no valid spoken text, find first playable block
      let currBlock = this.blocks[this.currentBlockIndex];
      let currSpoken = currBlock?.sentences?.[this.currentSentenceIndex]?.spoken || currBlock?.spokenText || currBlock?.rawText;
      if (!currBlock || !currSpoken || !currSpoken.trim()) {
        const validIdx = this.blocks.findIndex(b => {
          const t = b.spokenText || b.rawText || (b.sentences && b.sentences[0] && (b.sentences[0].spoken || b.sentences[0].raw));
          return t && t.trim().length > 0;
        });
        if (validIdx !== -1) {
          this.currentBlockIndex = validIdx;
          this.currentSentenceIndex = 0;
        }
      }

      await this.playSentence(this.currentBlockIndex, this.currentSentenceIndex);
    }

    /**
     * Pauses playback.
     */
    pause() {
      this.isPlaying = false;
      this.isPaused = true;
      this.playWhenReady = false;
      this.elements.btnPlayToggle.textContent = "▶";

      if (this.sentencePauseTimer) {
        clearTimeout(this.sentencePauseTimer);
        this.sentencePauseTimer = null;
      }

      if (this.currentAbortController) {
        try { this.currentAbortController.abort(); } catch (_) {}
        this.currentAbortController = null;
      }

      if (this.audio) {
        this.audio.pause();
      }
      if ("speechSynthesis" in window) {
        try {
          window.speechSynthesis.pause();
        } catch (_) {}
      }
      this.saveHistoryProgress();
    }

    /**
     * Stops playback and resets progress.
     */
    stop() {
      this.isPlaying = false;
      this.isPaused = false;
      this.playWhenReady = false;
      this.elements.btnPlayToggle.textContent = "▶";

      if (this.sentencePauseTimer) {
        clearTimeout(this.sentencePauseTimer);
        this.sentencePauseTimer = null;
      }

      if (this.elements.btnContinuePage) {
        this.elements.btnContinuePage.style.display = "none";
      }
      this.nextPendingPageNum = null;

      if (this.currentAbortController) {
        try { this.currentAbortController.abort(); } catch (_) {}
        this.currentAbortController = null;
      }

      if (this.audio) {
        this.audio.pause();
        this.audio.currentTime = 0;
        if (this.audio.src) {
          try {
            URL.revokeObjectURL(this.audio.src);
            this.audio.removeAttribute("src");
            this.audio.load();
          } catch (_) {}
        }
      }

      if ("speechSynthesis" in window) {
        try {
          window.speechSynthesis.cancel();
        } catch (_) {}
      }

      this.currentUtterance = null;
      window._activeSpeechUtterance = null;

      this.clearHighlights();
      this.elements.sliderFill.style.width = "0%";
      this.elements.timeElapsed.textContent = "0:00";
    }

    /**
     * Seeks playback forward or backward by seconds.
     */
    seekBy(seconds) {
      if (this.audio && this.audio.duration) {
        this.audio.currentTime = Math.max(0, Math.min(this.audio.duration, this.audio.currentTime + seconds));
      }
    }

    /**
     * Handles page complete boundary: stops playback and shows Continue button.
     */
    handlePageCompleteBoundary(nextPageNum) {
      this.isPlaying = false;
      this.isPaused = true;
      if (this.elements.btnPlayToggle) {
        this.elements.btnPlayToggle.textContent = "▶";
      }

      const currentBlock = this.blocks[this.currentBlockIndex];
      const curPage = currentBlock?.pageNumber || 1;

      if (this.elements.blockLabel) {
        this.elements.blockLabel.textContent = `✅ Completed Page ${curPage}. Click Continue for Page ${nextPageNum}`;
      }

      if (this.elements.btnContinuePage) {
        this.elements.btnContinuePage.textContent = `▶ Continue to Page ${nextPageNum}`;
        this.elements.btnContinuePage.style.display = "inline-flex";
      }

      this.nextPendingPageNum = nextPageNum;
    }

    /**
     * User clicks Continue to advance to next page.
     */
    continueToNextPage() {
      if (this.elements.btnContinuePage) {
        this.elements.btnContinuePage.style.display = "none";
      }
      const targetPage = this.nextPendingPageNum || (this.blocks[this.currentBlockIndex]?.pageNumber || 1) + 1;
      this.nextPendingPageNum = null;
      this.jumpToPage(targetPage);
      this.play();
    }

    /**
     * Advances to next sentence with background prefetching and crisp 400ms pause.
     */
    async nextSentence() {
      if (this.sentencePauseTimer) {
        clearTimeout(this.sentencePauseTimer);
        this.sentencePauseTimer = null;
      }

      const currentBlock = this.blocks[this.currentBlockIndex];
      if (!currentBlock) return;

      const currentPageNum = currentBlock.pageNumber || 1;

      // Check next sentence within current block
      if (this.currentSentenceIndex + 1 < (currentBlock.sentences?.length || 0)) {
        this.currentSentenceIndex++;
      } else if (this.currentBlockIndex + 1 < this.blocks.length) {
        const nextBlock = this.blocks[this.currentBlockIndex + 1];
        const nextPageNum = nextBlock.pageNumber || (currentPageNum + 1);

        // PAGE BOUNDARY CHECK:
        // Once one page is read, stop and require Continue button click
        if (nextPageNum !== currentPageNum) {
          this.handlePageCompleteBoundary(nextPageNum);
          return;
        }

        this.currentBlockIndex++;
        this.currentSentenceIndex = 0;
      } else {
        // Reached end of document
        this.stop();
        if (this.elements.blockLabel) {
          this.elements.blockLabel.textContent = "✅ Completed reading document.";
        }
        return;
      }

      this.updateBlockUI();
      if (this.isPlaying && !this.isPaused) {
        // Reduced pause between lines: exactly 400ms (strictly <= 1.0s)
        this.sentencePauseTimer = setTimeout(() => {
          if (this.isPlaying && !this.isPaused) {
            this.playSentence(this.currentBlockIndex, this.currentSentenceIndex);
          }
        }, 400);
      }
    }

    /**
     * Jumps to previous sentence.
     */
    async previousSentence() {
      if (this.sentencePauseTimer) {
        clearTimeout(this.sentencePauseTimer);
        this.sentencePauseTimer = null;
      }

      if (this.currentSentenceIndex > 0) {
        this.currentSentenceIndex--;
      } else if (this.currentBlockIndex > 0) {
        this.currentBlockIndex--;
        const prevBlock = this.blocks[this.currentBlockIndex];
        this.currentSentenceIndex = Math.max(0, (prevBlock.sentences?.length || 1) - 1);
      }

      this.updateBlockUI();
      if (this.isPlaying && !this.isPaused) {
        await this.playSentence(this.currentBlockIndex, this.currentSentenceIndex);
      }
    }

    /**
     * Deterministic preload key for sentence audio.
     */
    getPreloadKey(blockIndex, sentenceIndex) {
      return `${this.documentId}_b${blockIndex}_s${sentenceIndex}_v${this.voiceId}_sp${this.speed}`;
    }

    /**
     * Pre-fetches the next sentence in the background while current sentence plays.
     */
    async prefetchSentence(blockIndex, sentenceIndex) {
      if (this.voiceId.startsWith("browser:")) return;
      if (blockIndex >= this.blocks.length) return;

      const block = this.blocks[blockIndex];
      if (!block || !block.sentences || sentenceIndex >= block.sentences.length) return;

      const cacheKey = this.getPreloadKey(blockIndex, sentenceIndex);
      if (this.audioPreloadCache.has(cacheKey)) return;

      const sentenceObj = block.sentences[sentenceIndex];
      const spokenText = sentenceObj?.spoken || sentenceObj?.raw || block.spokenText || block.rawText;
      if (!spokenText || !spokenText.trim()) return;

      try {
        const response = await fetch(`${API_BASE_URL}/api/listen/document/${encodeURIComponent(this.documentId)}/synthesize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            text: spokenText,
            voice: this.voiceId,
            speed: this.speed,
            pageNumber: block.pageNumber || 1,
            chunkIndex: sentenceIndex
          })
        });

        if (response.ok) {
          const contentType = response.headers.get("content-type") || "";
          if (contentType.includes("audio/") || contentType.includes("octet-stream")) {
            const audioBlob = await response.blob();
            const objectUrl = URL.createObjectURL(audioBlob);
            this.audioPreloadCache.set(cacheKey, objectUrl);
          }
        }
      } catch (_) {
        // Non-blocking prefetch failure is fine; will fetch on demand
      }
    }

    /**
     * Triggers background prefetch for the upcoming sentence.
     */
    triggerPrefetchNext(blockIndex, sentenceIndex) {
      const block = this.blocks[blockIndex];
      if (!block) return;

      let nextB = blockIndex;
      let nextS = sentenceIndex + 1;
      if (nextS >= (block.sentences?.length || 0)) {
        nextB = blockIndex + 1;
        nextS = 0;
      }

      if (nextB < this.blocks.length) {
        const nextBlock = this.blocks[nextB];
        // Only prefetch if next sentence is on the same page
        if (nextBlock && nextBlock.pageNumber === block.pageNumber) {
          this.prefetchSentence(nextB, nextS);
        }
      }
    }

    /**
     * Synthesizes and plays a specific sentence from the active block.
     */
    async playSentence(blockIndex, sentenceIndex) {
      this.currentBlockIndex = blockIndex;
      this.currentSentenceIndex = sentenceIndex;
      this.updateBlockUI();

      const block = this.blocks[blockIndex];
      if (!block) return;

      const sentenceObj = block.sentences?.[sentenceIndex];
      const spokenText = sentenceObj?.spoken || sentenceObj?.raw || block.spokenText || block.rawText;
      if (!spokenText || !spokenText.trim()) {
        if (sentenceIndex + 1 < (block.sentences?.length || 0)) {
          return this.playSentence(blockIndex, sentenceIndex + 1);
        } else if (blockIndex + 1 < this.blocks.length) {
          return this.playSentence(blockIndex + 1, 0);
        } else {
          this.stop();
          return;
        }
      }

      if (!this.isPlaying || this.isPaused) return;

      this.isPlaying = true;
      this.isPaused = false;
      this.elements.btnPlayToggle.textContent = "⏸";

      if (this.followAlong) {
        this.highlightCurrentSentence();
      }

      // Check if user selected browser voice
      if (this.voiceId.startsWith("browser:")) {
        await this.speakWithBrowserVoice(spokenText);
        return;
      }

      // Check preloaded audio cache for instant playback (< 400ms transition)
      const cacheKey = this.getPreloadKey(blockIndex, sentenceIndex);
      let objectUrl = this.audioPreloadCache.get(cacheKey);

      if (!objectUrl) {
        // Create AbortController to cleanly cancel in-flight network requests on stop
        if (this.currentAbortController) {
          try { this.currentAbortController.abort(); } catch (_) {}
        }
        this.currentAbortController = new AbortController();
        const signal = this.currentAbortController.signal;

        try {
          const response = await fetch(`${API_BASE_URL}/api/listen/document/${encodeURIComponent(this.documentId)}/synthesize`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            signal,
            body: JSON.stringify({
              text: spokenText,
              voice: this.voiceId,
              speed: this.speed,
              pageNumber: block.pageNumber || 1,
              chunkIndex: sentenceIndex
            })
          });

          if (!this.isPlaying || this.isPaused) return;

          if (!response.ok) {
            throw new Error("Backend synthesis returned status " + response.status);
          }

          const contentType = response.headers.get("content-type") || "";
          if (contentType.includes("application/json")) {
            const data = await response.json();
            if (data.useClientSynthesis) {
              await this.speakWithBrowserVoice(spokenText);
              return;
            }
          }

          const audioBlob = await response.blob();
          if (!this.isPlaying || this.isPaused) return;

          objectUrl = URL.createObjectURL(audioBlob);
        } catch (err) {
          if (!this.isPlaying || this.isPaused || err.name === "AbortError") {
            return;
          }
          console.warn("[ListenPlayer] Neural synthesis error, falling back to browser speech:", err.message);
          await this.speakWithBrowserVoice(spokenText);
          return;
        }
      }

      if (!this.isPlaying || this.isPaused) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        return;
      }

      try {
        if (this.audio.src) {
          URL.revokeObjectURL(this.audio.src);
        }
        this.audio.src = objectUrl;
        this.audio.playbackRate = this.speed;
        await this.audio.play();

        this.saveHistoryProgress();

        // While this sentence is playing, trigger prefetch for next sentence in background!
        this.triggerPrefetchNext(blockIndex, sentenceIndex);
      } catch (playErr) {
        if (!this.isPlaying || this.isPaused) return;
        console.warn("[ListenPlayer] Audio play failed, falling back to browser speech:", playErr.message);
        await this.speakWithBrowserVoice(spokenText);
      }
    }

    /**
     * Browser speech synthesis with word-level boundary tracking.
     */
    speakWithBrowserVoice(text) {
      return new Promise((resolve) => {
        if (!("speechSynthesis" in window) || !text || !text.trim() || !this.isPlaying || this.isPaused) {
          resolve();
          return;
        }

        try {
          window.speechSynthesis.cancel();
          if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
          }
        } catch (_) {}

        const utterance = new SpeechSynthesisUtterance(text.trim());
        utterance.rate = this.speed || 1.0;

        if (this.voiceId && this.voiceId.startsWith("browser:")) {
          const voiceName = this.voiceId.replace("browser:", "");
          const voices = window.speechSynthesis.getVoices() || [];
          const matchedVoice = voices.find(v => v.name === voiceName || v.voiceURI === voiceName);
          if (matchedVoice) {
            utterance.voice = matchedVoice;
            utterance.lang = matchedVoice.lang;
          }
        }

        // Exact word pointing boundary event
        utterance.onboundary = (event) => {
          if (!this.followAlong) return;
          if (event.name === "word") {
            const charIdx = event.charIndex || 0;
            const charLen = event.charLength || 6;
            const word = text.substr(charIdx, charLen);
            this.highlightSpokenWord(word);
          }
        };

        utterance.onend = () => {
          this.currentUtterance = null;
          window._activeSpeechUtterance = null;
          if (this.isPlaying && !this.isPaused) {
            this.nextSentence();
          }
          resolve();
        };

        utterance.onerror = (err) => {
          this.currentUtterance = null;
          window._activeSpeechUtterance = null;
          if (this.isPlaying && !this.isPaused && err && err.error !== "canceled" && err.error !== "interrupted") {
            this.nextSentence();
          }
          resolve();
        };

        this.currentUtterance = utterance;
        window._activeSpeechUtterance = utterance;

        try {
          if (!this.isPlaying || this.isPaused) {
            resolve();
            return;
          }
          window.speechSynthesis.speak(utterance);
          if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
          }
        } catch (e) {
          console.warn("[ListenPlayer] Failed to invoke speech synthesis:", e);
          resolve();
        }
      });
    }

    /**
     * Synchronized Highlighting (Follow Along):
     * Finds matching text spans in #pdf-text-layer (or .docx-section-block / .pptx-slide-card)
     * and highlights them with luminous styling while smooth scrolling into view.
     */
    highlightCurrentSentence() {
      this.clearHighlights();

      const block = this.blocks[this.currentBlockIndex];
      if (!block) return;

      const sentenceObj = block.sentences?.[this.currentSentenceIndex];
      const rawSentence = (sentenceObj?.raw || "").trim();
      if (!rawSentence) return;

      // 1. PDF Text Layer Highlighting
      const textLayer = document.getElementById("pdf-text-layer");
      if (textLayer) {
        const spans = Array.from(textLayer.querySelectorAll("span"));
        const cleanWords = rawSentence.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length >= 3);

        let firstMatchSpan = null;
        for (const span of spans) {
          const spanText = (span.textContent || "").toLowerCase();
          const hitCount = cleanWords.filter(cw => spanText.includes(cw)).length;
          if (hitCount > 0) {
            span.classList.add("listen-highlight-sentence");
            if (!firstMatchSpan) firstMatchSpan = span;
          }
        }

        if (firstMatchSpan) {
          firstMatchSpan.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }

      // 2. DOCX & PPTX Card Highlighting
      const docxBlock = document.querySelector(`.docx-section-block[data-section="${block.sectionNumber || this.currentBlockIndex + 1}"]`);
      if (docxBlock) {
        docxBlock.classList.add("listen-active-section");
        docxBlock.scrollIntoView({ behavior: "smooth", block: "center" });
      }

      const pptxSlide = document.querySelector(`.pptx-slide-card[data-slide="${block.slideNumber || this.currentBlockIndex + 1}"]`);
      if (pptxSlide) {
        pptxSlide.classList.add("listen-active-section");
        pptxSlide.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }

    /**
     * Highlights the active spoken word with a luminous yellow glow (Word Follow-Along).
     */
    highlightSpokenWord(wordText) {
      if (!this.followAlong || !wordText) return;
      const cleanWord = wordText.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
      if (cleanWord.length < 2) return;

      // Clear previous word highlight
      document.querySelectorAll(".listen-highlight-word").forEach(el => el.classList.remove("listen-highlight-word"));

      const textLayer = document.getElementById("pdf-text-layer");
      if (!textLayer) return;

      // Search among sentence-highlighted spans first, then all spans
      const activeSentenceSpans = Array.from(textLayer.querySelectorAll(".listen-highlight-sentence"));
      const targetPool = activeSentenceSpans.length > 0 ? activeSentenceSpans : Array.from(textLayer.querySelectorAll("span"));

      for (const span of targetPool) {
        const spanText = (span.textContent || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        if (spanText.includes(cleanWord)) {
          span.classList.add("listen-highlight-word");
          break;
        }
      }
    }

    /**
     * Clears all highlighted sentences and sections.
     */
    clearHighlights() {
      document.querySelectorAll(".listen-highlight-sentence").forEach(el => el.classList.remove("listen-highlight-sentence"));
      document.querySelectorAll(".listen-highlight-word").forEach(el => el.classList.remove("listen-highlight-word"));
      document.querySelectorAll(".listen-active-section").forEach(el => el.classList.remove("listen-active-section"));
    }

    /**
     * Binds Click-to-Listen on the reader text layer and text documents.
     */
    bindClickToListen() {
      const textLayer = document.getElementById("pdf-text-layer");
      if (textLayer) {
        textLayer.addEventListener("click", (e) => {
          const span = e.target.closest("span");
          if (!span) return;
          const clickedText = span.textContent.trim().toLowerCase();
          if (!clickedText) return;

          // Find block & sentence matching clicked text
          for (let b = 0; b < this.blocks.length; b++) {
            const block = this.blocks[b];
            for (let s = 0; s < (block.sentences?.length || 0); s++) {
              const sent = block.sentences[s];
              if (sent.raw.toLowerCase().includes(clickedText) || clickedText.includes(sent.raw.slice(0, 15).toLowerCase())) {
                this.playSentence(b, s);
                return;
              }
            }
          }
        });
      }
    }

    /**
     * Checks previous listening history from the backend and displays Smart Resume banner.
     */
    async checkSmartResume() {
      if (!this.documentId || this.historyLoaded) return;
      this.historyLoaded = true;

      try {
        const res = await fetch(`${API_BASE_URL}/api/listen/history/${encodeURIComponent(this.documentId)}`, {
          credentials: "include"
        });

        if (!res.ok) return;
        const data = await res.json();
        const history = data.history;

        if (history && history.last_page) {
          this.showResumeBanner(history);
        }
      } catch (err) {
        console.warn("[ListenPlayer] Smart resume check notice:", err.message);
      }
    }

    /**
     * Displays non-intrusive banner offering to resume playback.
     */
    showResumeBanner(history) {
      let banner = document.getElementById("listen-resume-banner");
      if (banner) banner.remove();

      banner = document.createElement("div");
      banner.id = "listen-resume-banner";
      banner.className = "listen-resume-banner";
      banner.innerHTML = `
        <div class="listen-resume-text">
          <span>🎧</span>
          <span>Resume listening from <strong>Page ${history.last_page}</strong>?</span>
        </div>
        <div class="listen-resume-actions">
          <button type="button" id="btn-do-resume" class="btn-sm primary" style="padding: 4px 12px; font-size: 12px;">Resume</button>
          <button type="button" id="btn-dismiss-resume" class="btn-sm" style="padding: 4px 10px; font-size: 12px;">✕</button>
        </div>
      `;

      const viewerArea = document.querySelector(".pdf-viewer-area");
      if (viewerArea) {
        viewerArea.prepend(banner);
      }

      banner.querySelector("#btn-do-resume").addEventListener("click", () => {
        banner.remove();
        this.jumpToPage(history.last_page);
        this.play();
      });

      banner.querySelector("#btn-dismiss-resume").addEventListener("click", () => {
        banner.remove();
      });
    }

    /**
     * Saves user listening progress and preferences to server.
     */
    async saveHistoryProgress() {
      if (!this.documentId) return;
      const block = this.blocks[this.currentBlockIndex];
      const pageNum = block?.pageNumber || 1;

      try {
        await fetch(`${API_BASE_URL}/api/listen/history/${encodeURIComponent(this.documentId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            lastPage: pageNum,
            lastBlockId: block?.blockId,
            lastAudioTimestamp: this.audio.currentTime || 0,
            completionPercent: Math.round(((this.currentBlockIndex + 1) / (this.blocks.length || 1)) * 100),
            preferredVoice: this.voiceId,
            preferredSpeed: this.speed
          })
        });
      } catch (err) {
        // Non-blocking history save
      }
    }

    /**
     * Sets sleep timer to auto-pause after specified minutes.
     */
    setSleepTimer(minutesStr) {
      if (this.sleepTimerInterval) clearInterval(this.sleepTimerInterval);
      if (this.sleepTimer) clearTimeout(this.sleepTimer);

      if (minutesStr === "off") {
        this.elements.sleepBadge.style.display = "none";
        return;
      }

      const minutes = parseInt(minutesStr, 10);
      if (isNaN(minutes)) return;

      this.sleepTimerRemainingSeconds = minutes * 60;
      this.elements.sleepBadge.style.display = "inline-flex";
      this.elements.sleepBadge.textContent = `⏳ ${minutes}m`;

      this.sleepTimerInterval = setInterval(() => {
        this.sleepTimerRemainingSeconds--;
        if (this.sleepTimerRemainingSeconds <= 0) {
          clearInterval(this.sleepTimerInterval);
          this.pause();
          this.elements.sleepBadge.textContent = "💤 Sleep";
          setTimeout(() => {
            this.elements.sleepBadge.style.display = "none";
            this.elements.selectSleep.value = "off";
          }, 3000);
        } else {
          const m = Math.floor(this.sleepTimerRemainingSeconds / 60);
          const s = this.sleepTimerRemainingSeconds % 60;
          this.elements.sleepBadge.textContent = `⏳ ${m}:${s < 10 ? "0" : ""}${s}`;
        }
      }, 1000);
    }

    /**
     * Opens prompt to add a timestamped bookmark and note.
     */
    async openAddBookmarkPrompt() {
      const block = this.blocks[this.currentBlockIndex];
      const pageNum = block?.pageNumber || 1;
      const sentence = block?.sentences?.[this.currentSentenceIndex]?.raw || "";

      const note = prompt(`Add note for bookmark on Page ${pageNum}:\n"${sentence.slice(0, 60)}..."`, "");
      if (note === null) return;

      try {
        const res = await fetch(`${API_BASE_URL}/api/listen/bookmarks/${encodeURIComponent(this.documentId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            pageNumber: pageNum,
            blockId: block?.blockId,
            audioTimestamp: this.audio.currentTime || 0,
            title: `Bookmark: Page ${pageNum}`,
            note: note || sentence.slice(0, 100)
          })
        });

        if (res.ok) {
          this.loadBookmarks(true);
        }
      } catch (err) {
        alert("Failed to save bookmark: " + err.message);
      }
    }

    /**
     * Loads saved bookmarks into the drawer.
     */
    async loadBookmarks(openDrawer = false) {
      try {
        const res = await fetch(`${API_BASE_URL}/api/listen/bookmarks/${encodeURIComponent(this.documentId)}`, {
          credentials: "include"
        });
        if (!res.ok) return;
        const data = await res.json();
        const bookmarks = data.bookmarks || [];

        const list = this.elements.bookmarksList;
        if (bookmarks.length === 0) {
          list.innerHTML = `<p style="color: #64748b; font-size: 12px; margin: 0;">No bookmarks saved yet. Click '+ New' while listening to save key points.</p>`;
          if (openDrawer) {
            this.elements.drawer.classList.add("open");
          }
          return;
        }

        list.innerHTML = "";
        bookmarks.forEach(bm => {
          const item = document.createElement("div");
          item.className = "listen-bookmark-card";
          item.innerHTML = `
            <div style="display: flex; justify-content: space-between; font-weight: 700; font-size: 13px; color: #1e293b; margin-bottom: 4px;">
              <span>${bm.title}</span>
              <span style="color: #6366f1;">Page ${bm.page_number}</span>
            </div>
            <div style="font-size: 12px; color: #475569;">${bm.note || "No notes"}</div>
          `;
          item.addEventListener("click", () => {
            const targetBlockIdx = this.blocks.findIndex(b => b.pageNumber === bm.page_number);
            if (targetBlockIdx !== -1) {
              this.playSentence(targetBlockIdx, 0);
              this.elements.drawer.classList.remove("open");
            }
          });
          list.appendChild(item);
        });

        if (openDrawer) {
          this.elements.drawer.classList.add("open");
        }
      } catch (err) {
        console.warn("[ListenPlayer] Load bookmarks error:", err);
      }
    }

    /**
     * Sends current spoken text to AI Tutor chat for contextual explanation.
     */
    explainCurrentSentence() {
      const block = this.blocks[this.currentBlockIndex];
      const sentence = block?.sentences?.[this.currentSentenceIndex]?.raw || block?.rawText || "";
      if (!sentence) return;

      // Switch to AI Tutor panel
      const aiBtn = document.querySelector('[data-tool="ask-ai"]');
      if (aiBtn) aiBtn.click();

      const chatInput = document.getElementById("chat-input");
      if (chatInput) {
        chatInput.value = `Can you explain this part of the document in detail?\n\n"${sentence}"`;
        chatInput.focus();
      }
    }
  }

  window.StudyReaderListenPlayer = new ListenPlayer();
})();
