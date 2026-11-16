/* ============================================================
   STUDYREADER - ENHANCED NEURAL & BROWSER READ ALOUD PLAYER
   Supports high-quality browser SpeechSynthesis & backend TTS
   ============================================================ */

(function () {
  const API_BASE_URL = window.API_BASE_URL || "http://127.0.0.1:3000";

  const state = {
    sections: [],
    sectionIndex: 0,
    chunkIndex: 0,
    chunks: [],
    audio: new Audio(),
    playing: false,
    paused: false,
    readAll: false,
    voiceName: null,
    language: "en-US",
    rate: 1,
    useBrowserSynthesis: true,
    currentUtterance: null
  };

  let documentId = null;
  let elements = null;
  let onSectionChange = null;
  let restoredChunkIndex = 0;
  let browserVoicesLoaded = false;
  let eventsBound = false;

  function getProgressStorageKey() {
    return `studyreader-read-aloud-${documentId}`;
  }

  function saveProgress() {
    if (!documentId) return;
    try {
      localStorage.setItem(
        getProgressStorageKey(),
        JSON.stringify({
          sectionIndex: state.sectionIndex,
          chunkIndex: state.chunkIndex,
          voiceName: state.voiceName,
          rate: state.rate
        })
      );
    } catch (_) {}
  }

  function restoreProgress() {
    if (!documentId) return;
    const savedProgress = localStorage.getItem(getProgressStorageKey());
    if (!savedProgress) return;

    try {
      const progress = JSON.parse(savedProgress);
      if (
        Number.isInteger(progress.sectionIndex) &&
        progress.sectionIndex >= 0 &&
        progress.sectionIndex < state.sections.length
      ) {
        state.sectionIndex = progress.sectionIndex;
      }
      if (Number.isInteger(progress.chunkIndex)) {
        restoredChunkIndex = Math.max(0, progress.chunkIndex);
      }
      if (progress.voiceName) {
        state.voiceName = progress.voiceName;
      }
      if (progress.rate) {
        state.rate = Number(progress.rate) || 1;
      }
    } catch (error) {
      console.warn("Unable to restore Read Aloud progress:", error);
    }
  }

  /* ============================================================
     NATURAL SPEECH & FORMULA NORMALIZATION ENGINE
     - Eliminates symbol artifacts (black squares, bullets, brackets, dots)
     - Reads formulas & equations naturally (plus, minus, times, divided by, equals, squared, etc.)
     ============================================================ */
  function normalizeTextForSpeech(text) {
    if (!text) return "";
    let str = String(text);

    // 1. Remove raw markdown syntax
    str = str
      .replace(/#{1,6}\s+/g, "")
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      .replace(/(\*|_)(.*?)\1/g, "$2")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/```[\s\S]*?```/g, "Code block omitted.")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

    // 2. Remove all shapes, black squares, bullets, geometric icons, Wingdings/Symbol glyphs
    // (Prevents voice from saying "black square", "bullet", "white square", etc.)
    const geometricSymbols = /[\u25A0-\u25FF\u2B1B\u2B1C\u2022\u25E6\u2023\u2043\u25C6\u25C7\u27A2\u27A4\u2794\u279C\u2600-\u26FF\u2700-\u27BF\uF0A0-\uF0FF§¶]/g;
    str = str.replace(geometricSymbols, " ");

    // 3. Expand common academic abbreviations
    str = str
      .replace(/\be\.g\.,?\s*/gi, "for example, ")
      .replace(/\bi\.e\.,?\s*/gi, "that is, ")
      .replace(/\betc\.\s*/gi, "and so on, ")
      .replace(/\bvs\.?\s*/gi, "versus ")
      .replace(/\bfig\.\s*(\d+)/gi, "Figure $1")
      .replace(/\bch\.\s*(\d+)/gi, "Chapter $1")
      .replace(/\bsec\.\s*(\d+)/gi, "Section $1")
      .replace(/\bp\.\s*(\d+)/gi, "page $1")
      .replace(/\bpp\.\s*(\d+)/gi, "pages $1")
      .replace(/\bw\/o\b/gi, "without")
      .replace(/\bw\/\b/gi, "with")
      .replace(/\band\/or\b/gi, "and or");

    // 4. Common fractions
    str = str
      .replace(/\b1\/2\b/g, "one half")
      .replace(/\b1\/3\b/g, "one third")
      .replace(/\b2\/3\b/g, "two thirds")
      .replace(/\b1\/4\b/g, "one quarter")
      .replace(/\b3\/4\b/g, "three quarters")
      .replace(/\b1\/8\b/g, "one eighth");

    // 5. Percent and Currency
    str = str
      .replace(/(\d+(?:\.\d+)?)\s*%/g, "$1 percent")
      .replace(/\$([0-9]+(?:\.[0-9]+)?)/g, "$1 dollars")
      .replace(/₹([0-9]+(?:\.[0-9]+)?)/g, "$1 rupees");

    // 6. Mathematical & Formula Normalization (Before removing parentheses)
    // Probability & math functions
    str = str
      .replace(/\bP\(([a-zA-Z0-9]+)\s*\|\s*([a-zA-Z0-9]+)\)/g, "probability of $1 given $2")
      .replace(/\bP\(([a-zA-Z0-9\s∩∪]+)\)/g, "probability of $1")
      .replace(/\b([fgh])\(([a-zA-Z0-9]+)\)/g, "$1 of $2")
      .replace(/\b(sin|cos|tan)\(([a-zA-Z0-9]+)\)/g, "$1 of $2")
      .replace(/\blog\(([a-zA-Z0-9]+)\)/g, "log of $1")
      .replace(/\bln\(([a-zA-Z0-9]+)\)/g, "natural log of $1");

    // Roots
    str = str
      .replace(/(?:√|\\sqrt)\s*([a-zA-Z0-9]+)/g, "square root of $1")
      .replace(/\bsqrt\(([^)]+)\)/gi, "square root of $1")
      .replace(/∛\s*([a-zA-Z0-9]+)/g, "cube root of $1");

    // Exponents and powers
    str = str
      .replace(/([a-zA-Z0-9α-ωΑ-Ω_]+)\^2\b/g, "$1 squared")
      .replace(/([a-zA-Z0-9α-ωΑ-Ω_]+)\^3\b/g, "$1 cubed")
      .replace(/([a-zA-Z0-9α-ωΑ-Ω_]+)\^([a-zA-Z0-9α-ωΑ-Ω_]+)/g, "$1 to the power of $2")
      .replace(/²/g, " squared")
      .replace(/³/g, " cubed")
      .replace(/⁴/g, " to the fourth power")
      .replace(/ⁿ/g, " to the power of n");

    // Plus/minus
    str = str
      .replace(/±|\\pm|\+\/-/g, " plus or minus ")
      .replace(/∓|\\mp/g, " minus or plus ");

    // Greek letters commonly used in academic formulas
    str = str
      .replace(/\\alpha|α/g, "alpha")
      .replace(/\\beta|β/g, "beta")
      .replace(/\\gamma|γ/g, "gamma")
      .replace(/\\theta|θ/g, "theta")
      .replace(/\\lambda|λ/g, "lambda")
      .replace(/\\mu|μ/g, "mu")
      .replace(/\\pi|π/g, "pi")
      .replace(/\\sigma|σ/g, "sigma")
      .replace(/\\omega|ω/g, "omega")
      .replace(/\\Delta|Δ/g, "delta")
      .replace(/\\epsilon|ε/g, "epsilon");

    // Relational operators & comparisons
    str = str
      .replace(/!=|≠|\\neq/g, " is not equal to ")
      .replace(/<=|≤|\\leq/g, " is less than or equal to ")
      .replace(/>=|≥|\\geq/g, " is greater than or equal to ")
      .replace(/==/g, " is equal to ")
      .replace(/≈|\\approx/g, " is approximately ")
      .replace(/≡|\\equiv/g, " is equivalent to ")
      .replace(/∝|\\propto/g, " is proportional to ")
      .replace(/->|→|⇒|\\to/g, " implies ")
      .replace(/<->|↔|⇔/g, " if and only if ");

    // Set theory & calculus
    str = str
      .replace(/∩|\\cap/g, " intersection ")
      .replace(/∪|\\cup/g, " union ")
      .replace(/∈|\\in/g, " is in ")
      .replace(/∉|\\notin/g, " is not in ")
      .replace(/⊆|\\subseteq|⊂|\\subset/g, " is a subset of ")
      .replace(/∀|\\forall/g, " for all ")
      .replace(/∃|\\exists/g, " there exists ")
      .replace(/∑|\\sum/g, "summation of ")
      .replace(/∏|\\prod/g, "product of ")
      .replace(/∫|\\int/g, "integral of ")
      .replace(/∂|\\partial/g, "partial derivative of ")
      .replace(/∞|\\infty/g, "infinity");

    // Arithmetic operators in equations & expressions
    str = str
      // Multiplication: * or ×
      .replace(/([a-zA-Z0-9α-ωΑ-Ω])\s*[\*×]\s*([a-zA-Z0-9α-ωΑ-Ω])/g, "$1 times $2")
      // Division: / or ÷
      .replace(/([a-zA-Z0-9α-ωΑ-Ω])\s*÷\s*([a-zA-Z0-9α-ωΑ-Ω])/g, "$1 divided by $2")
      .replace(/\s+[\/÷]\s+/g, " divided by ")
      .replace(/(\b[a-zA-Z]\b|\d+)\s*\/\s*(\b[a-zA-Z]\b|\d+)\b/g, "$1 divided by $2")
      // Addition: +
      .replace(/([a-zA-Z0-9α-ωΑ-Ω])\s*\+\s*([a-zA-Z0-9α-ωΑ-Ω])/g, "$1 plus $2")
      .replace(/\s+\+\s+/g, " plus ")
      // Subtraction: - (with spaces or between single variables/numbers; preserves hyphenated words like real-world)
      .replace(/(\b[a-zA-Z]\b|\d+)\s*[-–—]\s*(\b[a-zA-Z]\b|\d+)/g, "$1 minus $2")
      .replace(/\s+[-–—]\s+(?=[a-zA-Z0-9])/g, " minus ")
      // Equality: = (between terms)
      .replace(/([a-zA-Z0-9α-ωΑ-Ω])\s*=\s*([a-zA-Z0-9α-ωΑ-Ω])/g, "$1 equals $2")
      .replace(/\s+=\s+/g, " equals ")
      // Inequalities: < or >
      .replace(/([a-zA-Z0-9α-ωΑ-Ω])\s*<\s*([a-zA-Z0-9α-ωΑ-Ω])/g, "$1 is less than $2")
      .replace(/([a-zA-Z0-9α-ωΑ-Ω])\s*>\s*([a-zA-Z0-9α-ωΑ-Ω])/g, "$1 is greater than $2");

    // 7. Bracket and Citation Normalization (Never speak "small bracket" or "left parenthesis")
    // Remove citations like [1], [1, 2], [1-3]
    str = str.replace(/\[\s*\d+(?:[\s,\-–]+\d+)*\s*\]/g, "");
    // Replace square brackets, curly braces, and fullwidth brackets with subtle spacing
    str = str.replace(/[\[\]{【】〔〕［］⟨⟩‹›«»]/g, " ");

    // Parentheses (including fullwidth （ and ）):
    // Replace with a natural comma/pause so the voice pauses naturally without pronouncing "bracket" or "parenthesis"
    str = str
      .replace(/\s*[（(]\s*/g, ", ")
      .replace(/\s*[）)]\s*/g, ", ");

    // 8. Dots and Numbered Lists
    // Ellipsis / multiple dots '...' -> single full stop
    str = str.replace(/\.{2,}/g, ". ");
    // List item e.g. "1. Introduction" -> "1, Introduction" (avoids "one dot introduction")
    str = str.replace(/(^|\n|\s)(\d+)\.\s+/g, "$1$2, ");

    // 9. Clean standalone symbols, quotes, and punctuation clutter
    str = str
      // Remove quotes around words
      .replace(/["“”'‘’`]/g, "")
      // Remove standalone dashes between words
      .replace(/\s+[—–-]\s+/g, ", ")
      // Clean duplicate or conflicting punctuation
      .replace(/:\s*,/g, ":")
      .replace(/,\s*:/g, ":")
      .replace(/,\s*,+/g, ",")
      .replace(/\s*,\s*\./g, ".")
      .replace(/\s+\./g, ".")
      .replace(/\s+/g, " ")
      .trim();

    return str;
  }

  function splitIntoChunks(text, maxLength = 800) {
    const cleanText = normalizeTextForSpeech(text);
    if (!cleanText) return [];

    const sentences = cleanText.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [cleanText];
    const chunks = [];
    let current = "";

    sentences.forEach((sentence) => {
      const cleanSentence = sentence.trim();
      if (!cleanSentence) return;

      if (current && current.length + cleanSentence.length + 1 > maxLength) {
        chunks.push(current);
        current = cleanSentence;
      } else {
        current = current ? `${current} ${cleanSentence}` : cleanSentence;
      }
    });

    if (current) {
      chunks.push(current);
    }

    return chunks.length ? chunks : [cleanText];
  }

  function updateProgress() {
    if (!elements || !state.sections.length) return;

    const section = state.sections[state.sectionIndex];
    const sectionLabel = section ? section.label : `Page ${state.sectionIndex + 1}`;
    const chunkInfo = state.chunks.length > 1
      ? ` • Part ${state.chunkIndex + 1}/${state.chunks.length}`
      : "";

    elements.progress.textContent = `${sectionLabel} (${state.sectionIndex + 1} of ${state.sections.length})${chunkInfo}`;

    if (onSectionChange) {
      onSectionChange(state.sectionIndex);
    }
  }

  function showError(message) {
    if (!elements || !elements.error) return;
    elements.error.hidden = false;
    elements.error.textContent = message;
  }

  function clearError() {
    if (elements && elements.error) {
      elements.error.hidden = true;
      elements.error.textContent = "";
    }
  }

  function getBrowserVoices() {
    if (!("speechSynthesis" in window)) return [];
    return window.speechSynthesis.getVoices() || [];
  }

  async function loadVoices() {
    clearError();
    let browserVoices = getBrowserVoices();

    // If voices aren't ready yet, listen for the event
    if (!browserVoices.length && "speechSynthesis" in window && !browserVoicesLoaded) {
      window.speechSynthesis.onvoiceschanged = () => {
        browserVoicesLoaded = true;
        loadVoices();
      };
    }

    let backendVoices = [];
    try {
      const response = await fetch(`${API_BASE_URL}/api/tts/voices`, { credentials: "include" });
      if (response.ok) {
        const data = await response.json();
        backendVoices = data.voices || [];
      }
    } catch (_) {
      // Backend TTS endpoint optional - fallback to browser speech synthesis
    }

    if (!elements || !elements.voice) return;

    elements.voice.innerHTML = "";

    // Prefer high-quality browser voices
    if (browserVoices.length > 0) {
      // Filter for English voices first, then others
      const englishVoices = browserVoices.filter(v => v.lang.startsWith("en"));
      const otherVoices = browserVoices.filter(v => !v.lang.startsWith("en"));
      const sortedVoices = [...englishVoices, ...otherVoices];

      sortedVoices.forEach((voice) => {
        const option = document.createElement("option");
        option.value = `browser:${voice.name}`;
        // Add neat label with indicator if it's natural/neural
        const isNatural = /natural|neural|online|google|siri/i.test(voice.name);
        option.textContent = `${voice.name} (${voice.lang})${isNatural ? " ✦" : ""}`;
        option.dataset.language = voice.lang;
        option.dataset.type = "browser";
        elements.voice.appendChild(option);
      });
    }

    // Append any server voices
    backendVoices.forEach((voice) => {
      const option = document.createElement("option");
      option.value = voice.id;
      option.textContent = voice.label || voice.name;
      option.dataset.language = voice.language || "en-US";
      option.dataset.type = "backend";
      elements.voice.appendChild(option);
    });

    if (elements.voice.options.length === 0) {
      const defaultOption = document.createElement("option");
      defaultOption.value = "default";
      defaultOption.textContent = "System Default Voice";
      elements.voice.appendChild(defaultOption);
    }

    // Restore selected voice or pick the first natural / english voice
    if (state.voiceName) {
      elements.voice.value = state.voiceName;
    }
    if (!elements.voice.value && elements.voice.options.length > 0) {
      elements.voice.selectedIndex = 0;
    }

    state.voiceName = elements.voice.value || null;
    const selectedOption = elements.voice.selectedOptions[0];
    if (selectedOption) {
      state.language = selectedOption.dataset.language || "en-US";
      state.useBrowserSynthesis = !selectedOption.dataset.type || selectedOption.dataset.type === "browser";
    }
  }

  async function prepareSection() {
    const section = state.sections[state.sectionIndex];
    if (!section) {
      throw new Error("No document section available to read.");
    }

    state.chunks = splitIntoChunks(section.text);
    if (!state.chunks.length) {
      state.chunks = ["Section has no readable text."];
    }

    state.chunkIndex = Math.min(
      restoredChunkIndex,
      Math.max(0, state.chunks.length - 1)
    );
    restoredChunkIndex = 0;
    updateProgress();
  }

  function speakWithBrowserSynthesis(text) {
    return new Promise((resolve, reject) => {
      if (!("speechSynthesis" in window)) {
        reject(new Error("Browser speech synthesis is not supported on this device."));
        return;
      }

      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = Math.max(0.5, Math.min(2.0, state.rate));
      utterance.pitch = 1.0;

      // Select specific voice if configured
      if (state.voiceName && state.voiceName.startsWith("browser:")) {
        const targetVoiceName = state.voiceName.replace(/^browser:/, "");
        const voices = getBrowserVoices();
        const matchedVoice = voices.find(v => v.name === targetVoiceName);
        if (matchedVoice) {
          utterance.voice = matchedVoice;
          utterance.lang = matchedVoice.lang;
        }
      } else if (state.language) {
        utterance.lang = state.language;
      }

      state.currentUtterance = utterance;

      utterance.onend = () => {
        state.currentUtterance = null;
        resolve();
      };

      utterance.onerror = (event) => {
        state.currentUtterance = null;
        // Ignore "interrupted" or "canceled" errors when user pressed pause/stop
        if (event.error === "interrupted" || event.error === "canceled") {
          resolve();
        } else {
          console.warn("Speech synthesis notice:", event.error);
          resolve();
        }
      };

      window.speechSynthesis.speak(utterance);
    });
  }

  async function playCurrentChunk() {
    clearError();

    if (!state.chunks.length) {
      await prepareSection();
    }

    const chunk = state.chunks[state.chunkIndex];
    if (!chunk) {
      await moveNext(true);
      return;
    }

    updateProgress();
    state.playing = true;
    state.paused = false;

    // Check if voice is configured for browser speech or backend audio
    const isBrowserVoice = !state.voiceName || state.voiceName.startsWith("browser:") || state.voiceName === "default";

    if (isBrowserVoice || !navigator.onLine) {
      try {
        await speakWithBrowserSynthesis(chunk);
        if (state.playing && !state.paused) {
          await moveNext(false);
        }
      } catch (err) {
        showError(err.message || "Unable to play speech synthesis.");
        state.playing = false;
      }
      return;
    }

    // Try backend audio request with graceful fallback to browser synthesis
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/pdfs/${encodeURIComponent(documentId)}/tts`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: chunk,
            voiceName: state.voiceName,
            language: state.language,
            rate: state.rate
          })
        }
      );

      const contentType = response.headers.get("content-type") || "";

      if (contentType.includes("application/json")) {
        const json = await response.json();
        if (json.useClientSynthesis || !response.ok) {
          // Gracefully speak via browser synthesis
          await speakWithBrowserSynthesis(chunk);
          if (state.playing && !state.paused) {
            await moveNext(false);
          }
          return;
        }
      }

      if (!response.ok) {
        throw new Error("Backend speech unavailable, falling back to local speech.");
      }

      const audioBlob = await response.blob();
      if (state.audio.src) {
        URL.revokeObjectURL(state.audio.src);
      }
      state.audio.src = URL.createObjectURL(audioBlob);
      state.audio.playbackRate = state.rate;
      await state.audio.play();
    } catch (error) {
      console.warn("Backend TTS fell back to browser speech synthesis:", error.message);
      await speakWithBrowserSynthesis(chunk);
      if (state.playing && !state.paused) {
        await moveNext(false);
      }
    }
  }

  async function moveNext(manualTrigger = false) {
    stopCurrentPlayback();

    const hasMoreChunks = state.chunkIndex + 1 < state.chunks.length;
    const hasMoreSections = state.sectionIndex + 1 < state.sections.length;

    if (hasMoreChunks) {
      state.chunkIndex += 1;
    } else if (hasMoreSections) {
      state.sectionIndex += 1;
      await prepareSection();
      state.chunkIndex = 0;
    } else {
      // Reached the very end
      state.playing = false;
      state.paused = false;
      updateProgress();
      return;
    }

    saveProgress();
    updateProgress();

    // Auto-advance if "Read entire document" is enabled or was continuing playback
    if (state.readAll || (state.playing && !manualTrigger)) {
      await playCurrentChunk();
    }
  }

  async function movePrevious() {
    stopCurrentPlayback();

    if (state.chunkIndex > 0) {
      state.chunkIndex -= 1;
    } else if (state.sectionIndex > 0) {
      state.sectionIndex -= 1;
      await prepareSection();
      state.chunkIndex = Math.max(0, state.chunks.length - 1);
    }

    updateProgress();
    saveProgress();

    if (state.playing) {
      await playCurrentChunk();
    }
  }

  function stopCurrentPlayback() {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    if (state.audio) {
      state.audio.pause();
      state.audio.currentTime = 0;
    }
  }

  function stop() {
    stopCurrentPlayback();
    state.playing = false;
    state.paused = false;
    updateProgress();
    saveProgress();
  }

  async function play() {
    clearError();

    // If currently paused in browser synthesis, resume
    if (state.paused && "speechSynthesis" in window && window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      state.paused = false;
      state.playing = true;
      return;
    }

    // If audio element was paused
    if (state.audio.src && state.audio.paused && state.paused) {
      state.playing = true;
      state.paused = false;
      await state.audio.play();
      return;
    }

    await playCurrentChunk();
  }

  function pause() {
    state.paused = true;
    state.playing = false;

    if ("speechSynthesis" in window && window.speechSynthesis.speaking) {
      window.speechSynthesis.pause();
    }
    if (state.audio && !state.audio.paused) {
      state.audio.pause();
    }
    saveProgress();
  }

  function initialize(options) {
    documentId = options.documentId;
    elements = options.elements;
    state.sections = options.sections || [];
    state.sectionIndex = options.startIndex || 0;
    state.language = options.language || "en-US";
    onSectionChange = options.onSectionChange || null;

    restoreProgress();

    if (!eventsBound && elements) {
      eventsBound = true;

      state.audio.addEventListener("ended", () => {
        moveNext(false).catch((error) => showError(error.message));
      });

      elements.play.addEventListener("click", () => {
        play().catch((error) => showError(error.message));
      });

      elements.pause.addEventListener("click", pause);
      elements.stop.addEventListener("click", stop);

      elements.next.addEventListener("click", () => {
        moveNext(true).catch((error) => showError(error.message));
      });

      elements.previous.addEventListener("click", () => {
        movePrevious().catch((error) => showError(error.message));
      });

      if (elements.all) {
        elements.all.addEventListener("change", () => {
          state.readAll = elements.all.checked;
        });
      }

      if (elements.speed) {
        elements.speed.addEventListener("change", () => {
          state.rate = Number(elements.speed.value) || 1;
          state.audio.playbackRate = state.rate;
          // If speaking via browser synthesis, restart current chunk at new rate
          if (state.playing && !state.paused) {
            playCurrentChunk().catch((error) => showError(error.message));
          }
        });
      }

      if (elements.voice) {
        elements.voice.addEventListener("change", () => {
          state.voiceName = elements.voice.value;
          const selectedOption = elements.voice.selectedOptions[0];
          if (selectedOption) {
            state.language = selectedOption.dataset.language || "en-US";
          }
          if (state.playing && !state.paused) {
            playCurrentChunk().catch((error) => showError(error.message));
          }
        });
      }
    }

    updateProgress();
    loadVoices().catch((error) => console.warn("Notice loading voices:", error.message));
  }

  window.StudyReaderReadAloud = {
    initialize,
    play: () => play().catch((error) => showError(error.message)),
    pause,
    stop,
    next: () => moveNext(true),
    previous: movePrevious,
    normalizeText: normalizeTextForSpeech
  };

  window.StudyReaderSpeechNormalizer = {
    normalize: normalizeTextForSpeech
  };
})();
