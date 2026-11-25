/**
 * StudyReader Listen — Advanced Neural Audio Player & Synchronized Highlighting
 * 
 * Features:
 * - Neural voice synthesis (Cloudflare Deepgram Aura-2) with fallback to Browser SpeechSynthesis
 * - Synchronized PDF/DOCX/PPTX sentence highlighting (Follow Along)
 * - Click-to-listen navigation
 * - Smart Resume across sessions
 * - Bookmarks & Notes
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

      this.elements = {};
      this.onPageChangeCallback = null;
      this.historyLoaded = false;
    }

    /**
     * Mounts the Listen Player into the DOM and sets up event listeners.
     */
    init(options = {}) {
      this.documentId = options.documentId;
      this.onPageChangeCallback = options.onPageChange || null;

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
        <!-- Top Meta Row -->
        <div class="listen-bar-header">
          <div class="listen-track-info">
            <div class="listen-track-title">
              <span id="listen-doc-title">🎧 StudyReader Listen</span>
              <span id="listen-page-badge" class="listen-badge">Page 1</span>
            </div>
            <div class="listen-track-subtitle">
              <span id="listen-block-label">Loading natural reading blocks...</span>
              <span id="listen-sleep-badge" style="display: none; color: #f59e0b; font-weight: 700;">⏱ 00:00</span>
            </div>
          </div>

          <!-- Main Transport Controls -->
          <div class="listen-transport-controls">
            <button type="button" id="btn-listen-prev-sent" class="listen-btn" title="Previous Sentence">⏮</button>
            <button type="button" id="btn-listen-seek-back" class="listen-btn" title="Back 15s">↺ 15</button>
            <button type="button" id="btn-listen-play-toggle" class="listen-btn listen-btn-primary" title="Play">▶</button>
            <button type="button" id="btn-listen-seek-fwd" class="listen-btn" title="Forward 15s">15 ↻</button>
            <button type="button" id="btn-listen-next-sent" class="listen-btn" title="Next Sentence">⏭</button>
            <button type="button" id="btn-listen-stop" class="listen-btn" title="Stop">⏹</button>
          </div>

          <div style="display: flex; align-items: center; gap: 6px;">
            <button type="button" id="btn-listen-bookmark" class="listen-pill-btn" title="Add Bookmark at this sentence">🔖 Mark</button>
            <button type="button" id="btn-listen-focus" class="listen-pill-btn" title="Distraction-Free Focus Mode">🎯 Focus</button>
            <button type="button" id="btn-listen-close" class="listen-btn" style="width: 28px; height: 28px; font-size: 11px;" title="Close Player">✕</button>
          </div>
        </div>

        <!-- Scrubber Row -->
        <div class="listen-scrubber-row">
          <span id="listen-time-elapsed" class="listen-time">0:00</span>
          <div id="listen-slider-track" class="listen-slider-track">
            <div id="listen-slider-fill" class="listen-slider-fill"></div>
          </div>
          <span id="listen-time-remaining" class="listen-time">-0:00</span>
        </div>

        <!-- Options Row: Voice, Speed, Timer, Follow Along -->
        <div class="listen-options-row">
          <div class="listen-select-group">
            <label for="select-listen-voice" style="font-weight: 600; color: #475569;">Voice:</label>
            <select id="select-listen-voice" class="listen-select">
              <option value="cf:luna">Luna (Studio Natural)</option>
            </select>
          </div>

          <div class="listen-select-group">
            <label for="select-listen-speed" style="font-weight: 600; color: #475569;">Speed:</label>
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
            <label for="select-listen-sleep" style="font-weight: 600; color: #475569;">Sleep:</label>
            <select id="select-listen-sleep" class="listen-select">
              <option value="0">Off</option>
              <option value="5">5 min</option>
              <option value="10">10 min</option>
              <option value="15">15 min</option>
              <option value="30">30 min</option>
              <option value="60">60 min</option>
              <option value="paragraph">End of Paragraph</option>
              <option value="section">End of Section</option>
            </select>
          </div>

          <div style="display: flex; align-items: center; gap: 8px;">
            <button type="button" id="btn-toggle-follow" class="listen-pill-btn active" title="Synchronized Highlighting & Auto-scroll">
              <span id="follow-indicator">✨</span> Follow Along
            </button>
            <button type="button" id="btn-listen-ai-explain" class="listen-pill-btn" title="Explain spoken sentence with AI Tutor">
              <span>🤖</span> Explain
            </button>
          </div>
        </div>

        <!-- Bookmarks Drawer -->
        <div id="listen-bookmarks-drawer" class="listen-drawer">
          <div class="listen-drawer-head">
            <h3 style="margin: 0; font-size: 15px; font-weight: 700; color: #0f172a;">🔖 Listening Bookmarks</h3>
            <button type="button" id="btn-close-drawer" class="listen-btn" style="width: 28px; height: 28px;">✕</button>
          </div>
          <div class="listen-drawer-body" id="listen-bookmarks-list">
            <p style="color: #64748b; font-size: 13px;">No bookmarks saved yet. Click '🔖 Mark' while listening to save key points.</p>
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
        pageBadge: container.querySelector("#listen-page-badge"),
        blockLabel: container.querySelector("#listen-block-label"),
        sleepBadge: container.querySelector("#listen-sleep-badge"),
        btnPlayToggle: container.querySelector("#btn-listen-play-toggle"),
        btnPrevSent: container.querySelector("#btn-listen-prev-sent"),
        btnNextSent: container.querySelector("#btn-listen-next-sent"),
        btnSeekBack: container.querySelector("#btn-listen-seek-back"),
        btnSeekFwd: container.querySelector("#btn-listen-seek-fwd"),
        btnStop: container.querySelector("#btn-listen-stop"),
        btnBookmark: container.querySelector("#btn-listen-bookmark"),
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

      // Bookmarks Drawer
      el.btnBookmark.addEventListener("click", () => this.openAddBookmarkPrompt());
      el.btnCloseDrawer.addEventListener("click", () => el.drawer.classList.remove("open"));

      // AI Explain current sentence
      el.btnAiExplain.addEventListener("click", () => this.explainCurrentSentence());
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
      });

      this.audio.addEventListener("ended", () => {
        this.nextSentence();
      });

      this.audio.addEventListener("error", (e) => {
        console.warn("[ListenPlayer] Audio playback issue, falling back to browser speech synthesis:", e);
        this.fallbackToBrowserSpeech();
      });
    }

    /**
     * Formats seconds to mm:ss.
     */
    formatTime(sec) {
      const s = Math.floor(sec || 0);
      const m = Math.floor(s / 60);
      const rem = s % 60;
      return `${m}:${rem < 10 ? "0" : ""}${rem}`;
    }

    /**
     * Fetches all available voices from the backend and device speech synthesis.
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
      sel.innerHTML = "";

      // Server neural studio voices first
      const cfGroup = document.createElement("optgroup");
      cfGroup.label = "Studio Neural Voices (Cloudflare)";

      const browserGroup = document.createElement("optgroup");
      browserGroup.label = "Device / Browser Voices";

      serverVoices.forEach(v => {
        const opt = document.createElement("option");
        opt.value = v.id;
        const displayName = v.name || v.label || v.id;
        opt.textContent = `${displayName}${v.isStudio ? " ✦" : ""}`;
        if (v.provider === "cloudflare" || v.provider === "google" || v.id.startsWith("cf:") || v.id.startsWith("gcp:")) {
          cfGroup.appendChild(opt);
        } else {
          browserGroup.appendChild(opt);
        }
      });

      // Also dynamically populate device SpeechSynthesis voices
      if ("speechSynthesis" in window) {
        const localVoices = window.speechSynthesis.getVoices() || [];
        localVoices.forEach(lv => {
          const id = `browser:${lv.name}`;
          if (!browserGroup.querySelector(`option[value="${id}"]`)) {
            const opt = document.createElement("option");
            opt.value = id;
            opt.textContent = `${lv.name} (${lv.lang})`;
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
          this.updateBlockUI();
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
     * Updates the status badge and label based on current block and sentence.
     */
    updateBlockUI() {
      const block = this.blocks[this.currentBlockIndex];
      if (!block) return;

      const pageNum = block.pageNumber || 1;
      this.elements.pageBadge.textContent = `Page ${pageNum}`;

      const totalSentences = block.sentences?.length || 1;
      this.elements.blockLabel.textContent = `${block.title || "Section"} • Sentence ${this.currentSentenceIndex + 1}/${totalSentences}`;

      // Notify page wrapper if page changed
      if (this.onPageChangeCallback && typeof this.onPageChangeCallback === "function") {
        this.onPageChangeCallback(pageNum);
      }
    }

    /**
     * Plays or pauses audio playback.
     */
    togglePlay() {
      if (this.isPlaying) {
        this.pause();
      } else {
        this.play();
      }
    }

    /**
     * Begins or resumes playback.
     */
    async play() {
      if (this.isPaused && this.audio.src) {
        try {
          await this.audio.play();
          this.isPlaying = true;
          this.isPaused = false;
          this.elements.btnPlayToggle.textContent = "⏸";
          this.highlightCurrentSentence();
          return;
        } catch (e) {
          console.warn("[ListenPlayer] Resume failed, replaying sentence:", e);
        }
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
          this.playWhenReady = false;
          return;
        }
      }

      // If current block has no valid spoken text, find the first playable block
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
      this.elements.btnPlayToggle.textContent = "▶";
      this.audio.pause();
      if ("speechSynthesis" in window) {
        window.speechSynthesis.pause();
      }
      this.saveHistoryProgress();
    }

    /**
     * Stops playback and resets progress.
     */
    stop() {
      this.isPlaying = false;
      this.isPaused = false;
      this.elements.btnPlayToggle.textContent = "▶";
      this.audio.pause();
      this.audio.currentTime = 0;
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
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
     * Advances to next sentence.
     */
    async nextSentence() {
      const block = this.blocks[this.currentBlockIndex];
      if (!block) return;

      if (this.currentSentenceIndex + 1 < (block.sentences?.length || 0)) {
        this.currentSentenceIndex++;
      } else if (this.currentBlockIndex + 1 < this.blocks.length) {
        this.currentBlockIndex++;
        this.currentSentenceIndex = 0;
      } else {
        // Reached end of document
        this.stop();
        return;
      }

      this.updateBlockUI();
      if (this.isPlaying) {
        await this.playSentence(this.currentBlockIndex, this.currentSentenceIndex);
      }
    }

    /**
     * Jumps to previous sentence.
     */
    async previousSentence() {
      if (this.currentSentenceIndex > 0) {
        this.currentSentenceIndex--;
      } else if (this.currentBlockIndex > 0) {
        this.currentBlockIndex--;
        const prevBlock = this.blocks[this.currentBlockIndex];
        this.currentSentenceIndex = Math.max(0, (prevBlock.sentences?.length || 1) - 1);
      }

      this.updateBlockUI();
      if (this.isPlaying) {
        await this.playSentence(this.currentBlockIndex, this.currentSentenceIndex);
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

      // Fetch or stream neural audio from backend
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

        if (!response.ok) {
          throw new Error("Backend synthesis returned status " + response.status);
        }

        const audioBlob = await response.blob();
        if (this.audio.src) {
          URL.revokeObjectURL(this.audio.src);
        }
        this.audio.src = URL.createObjectURL(audioBlob);
        this.audio.playbackRate = this.speed;
        await this.audio.play();

        this.saveHistoryProgress();
      } catch (err) {
        console.warn("[ListenPlayer] Neural synthesis error, falling back to browser speech:", err.message);
        await this.speakWithBrowserVoice(spokenText);
      }
    }

    /**
     * Browser speech synthesis fallback.
     */
    speakWithBrowserVoice(text) {
      return new Promise((resolve) => {
        if (!("speechSynthesis" in window) || !text || !text.trim()) {
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

        utterance.onend = () => {
          this.currentUtterance = null;
          window._activeSpeechUtterance = null;
          if (this.isPlaying && !this.isPaused) {
            this.nextSentence();
          }
          resolve();
        };

        utterance.onerror = (err) => {
          console.warn("[ListenPlayer] Speech synthesis error:", err);
          this.currentUtterance = null;
          window._activeSpeechUtterance = null;
          resolve();
        };

        this.currentUtterance = utterance;
        window._activeSpeechUtterance = utterance;

        try {
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
      const rawSentence = (sentenceObj?.raw || "").trim().toLowerCase();

      // 1. PDF Text Layer Highlighting
      const textLayer = document.getElementById("pdf-text-layer");
      if (textLayer && rawSentence) {
        const spans = Array.from(textLayer.querySelectorAll("span"));
        let matched = false;

        // Extract key search words (>= 4 chars) to locate span
        const searchWords = rawSentence.split(/\s+/).filter(w => w.length >= 4).slice(0, 3);

        for (const span of spans) {
          const spanText = span.textContent.toLowerCase();
          if (searchWords.length > 0 && searchWords.every(sw => spanText.includes(sw))) {
            span.classList.add("listen-highlight-sentence");
            span.scrollIntoView({ behavior: "smooth", block: "center" });
            matched = true;
            break;
          }
        }

        if (!matched && spans.length > 0) {
          // Highlight first matching span
          const firstWord = searchWords[0] || rawSentence.slice(0, 8);
          for (const span of spans) {
            if (span.textContent.toLowerCase().includes(firstWord)) {
              span.classList.add("listen-highlight-sentence");
              span.scrollIntoView({ behavior: "smooth", block: "center" });
              break;
            }
          }
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
     * Clears all highlighted sentences and sections.
     */
    clearHighlights() {
      document.querySelectorAll(".listen-highlight-sentence").forEach(el => el.classList.remove("listen-highlight-sentence"));
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
        if (history.voice_used) this.elements.selectVoice.value = history.voice_used;
        if (history.speed_used) {
          this.speed = parseFloat(history.speed_used);
          this.elements.selectSpeed.value = String(history.speed_used);
        }

        // Locate block matching last page
        const targetBlockIdx = this.blocks.findIndex(b => b.pageNumber === history.last_page);
        const bIdx = targetBlockIdx !== -1 ? targetBlockIdx : 0;
        this.playSentence(bIdx, 0);
      });

      banner.querySelector("#btn-dismiss-resume").addEventListener("click", () => {
        banner.remove();
      });
    }

    /**
     * Persists playback progress to PostgreSQL via API.
     */
    async saveHistoryProgress() {
      if (!this.documentId || !this.blocks.length) return;

      const block = this.blocks[this.currentBlockIndex];
      const pageNum = block?.pageNumber || 1;
      const totalBlocks = this.blocks.length;
      const pct = Math.round(((this.currentBlockIndex + 1) / totalBlocks) * 100);

      try {
        await fetch(`${API_BASE_URL}/api/listen/history/${encodeURIComponent(this.documentId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            pageNumber: pageNum,
            blockId: block?.blockId || `b_${this.currentBlockIndex}`,
            audioTimestamp: this.audio.currentTime || 0,
            completionPercentage: pct,
            voice: this.voiceId,
            speed: this.speed
          })
        });
      } catch (_) {}
    }

    /**
     * Sets a sleep timer (minutes or paragraph/section trigger).
     */
    setSleepTimer(val) {
      if (this.sleepTimerInterval) clearInterval(this.sleepTimerInterval);
      this.elements.sleepBadge.style.display = "none";

      if (val === "0") return;

      if (val === "paragraph" || val === "section") {
        this.sleepTimer = val;
        this.elements.sleepBadge.textContent = `⏱ Stop @ ${val}`;
        this.elements.sleepBadge.style.display = "inline";
        return;
      }

      const mins = parseInt(val, 10);
      this.sleepTimerRemainingSeconds = mins * 60;
      this.elements.sleepBadge.style.display = "inline";

      this.sleepTimerInterval = setInterval(() => {
        this.sleepTimerRemainingSeconds--;
        if (this.sleepTimerRemainingSeconds <= 0) {
          clearInterval(this.sleepTimerInterval);
          this.stop();
          this.elements.sleepBadge.textContent = "⏱ Timed Out";
        } else {
          const m = Math.floor(this.sleepTimerRemainingSeconds / 60);
          const s = this.sleepTimerRemainingSeconds % 60;
          this.elements.sleepBadge.textContent = `⏱ ${m}:${s < 10 ? "0" : ""}${s}`;
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
          alert("Bookmark saved!");
          this.loadBookmarks();
        }
      } catch (err) {
        alert("Failed to save bookmark: " + err.message);
      }
    }

    /**
     * Loads saved bookmarks into the drawer.
     */
    async loadBookmarks() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/listen/bookmarks/${encodeURIComponent(this.documentId)}`, {
          credentials: "include"
        });
        if (!res.ok) return;
        const data = await res.json();
        const bookmarks = data.bookmarks || [];

        const list = this.elements.bookmarksList;
        if (bookmarks.length === 0) {
          list.innerHTML = `<p style="color: #64748b; font-size: 13px;">No bookmarks saved yet.</p>`;
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

        this.elements.drawer.classList.add("open");
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
