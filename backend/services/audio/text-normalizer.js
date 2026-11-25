/**
 * StudyReader Listen — Natural Text Normalizer & Pronunciation Engine
 * 
 * Prepares academic, scientific, and technical PDF content for fluid neural voice synthesis:
 * - Cleans headers, footers, page numbers, decorative symbols, and hyphenated line breaks.
 * - Context-aware normalization for formulas, math, units, dates, chemical notation, and lists.
 * - Preserves structural reading blocks and sentence-level offsets for synchronized highlighting.
 * - Maintains original text mapping (never mutates or overwrites the raw extracted text).
 * - Applies technical pronunciation dictionary and user-defined phonetic overrides.
 */

// ============================================================
// 1. TECHNICAL & COMPUTER SCIENCE PRONUNCIATION DICTIONARY
// ============================================================
const DEFAULT_PRONUNCIATION_DICTIONARY = {
  // Programming & Data Formats
  "JSON": "J-son",
  "SQL": "sequel",
  "NoSQL": "no sequel",
  "MySQL": "my sequel",
  "PostgreSQL": "post-gres-Q-L",
  "Postgres": "post-gres",
  "REGEX": "reg-ex",
  "RegEx": "reg-ex",
  "Regex": "reg-ex",
  "HTML": "H-T-M-L",
  "CSS": "C-S-S",
  "XML": "X-M-L",
  "YAML": "yam-el",
  "CSV": "C-S-V",
  "AJAX": "ay-jacks",
  "DOM": "dom",
  "BOM": "bom",
  
  // Architectures & Cloud
  "SaaS": "sass",
  "PaaS": "pass",
  "IaaS": "eye-ass",
  "REST": "rest",
  "RESTful": "rest-ful",
  "API": "A-P-I",
  "APIs": "A-P-Eyes",
  "OAuth": "O-auth",
  "JWT": "J-W-T",
  "CORS": "corz",
  "CRUD": "crud",
  "CI/CD": "C-I C-D",
  "SDK": "S-D-K",
  "IDE": "I-D-E",
  "CLI": "C-L-I",
  "GUI": "gooey",
  "WYSIWYG": "wizzy-wig",
  
  // Hardware & CS Fundamentals
  "CPU": "C-P-U",
  "GPU": "G-P-U",
  "TPU": "T-P-U",
  "RAM": "ram",
  "ROM": "rom",
  "FIFO": "fye-foe",
  "LIFO": "lye-foe",
  "IO": "I-O",
  "I/O": "I-O",
  "OS": "O-S",
  "BIOS": "bye-oss",
  "TCP/IP": "T-C-P I-P",
  "DNS": "D-N-S",
  "URL": "U-R-L",
  "URI": "U-R-I",
  "HTTP": "H-T-T-P",
  "HTTPS": "H-T-T-P-S",
  "SSL": "S-S-L",
  "TLS": "T-L-S",
  "LAN": "lan",
  "WAN": "wan",
  "VPN": "V-P-N",
  "NAT": "nat",
  "RAG": "rag",
  "LLM": "L-L-M",
  "LLMs": "L-L-Ms",
  "NLP": "N-L-P",
  "TTS": "T-T-S",
  "OCR": "O-C-R",
  "KNN": "K-N-N",
  "SVM": "S-V-M",
  "CNN": "C-N-N",
  "RNN": "R-N-N",
  "GAN": "gan",
  "CUDA": "coo-duh"
};

// ============================================================
// 2. CHEMICAL FORMULAS & SCIENTIFIC NOTATION
// ============================================================
const CHEMICAL_FORMULAS = [
  { regex: /\bH2O\b/g, spoken: "H two O" },
  { regex: /\bH₂O\b/g, spoken: "H two O" },
  { regex: /\bCO2\b/g, spoken: "C O two" },
  { regex: /\bCO₂\b/g, spoken: "C O two" },
  { regex: /\bO2\b/g, spoken: "O two" },
  { regex: /\bO₂\b/g, spoken: "O two" },
  { regex: /\bN2\b/g, spoken: "N two" },
  { regex: /\bN₂\b/g, spoken: "N two" },
  { regex: /\bNaCl\b/g, spoken: "sodium chloride, N a C l" },
  { regex: /\bH2SO4\b/g, spoken: "H two S O four" },
  { regex: /\bH₂SO₄\b/g, spoken: "H two S O four" },
  { regex: /\bHCl\b/g, spoken: "H C l" },
  { regex: /\bCH4\b/g, spoken: "C H four, methane" },
  { regex: /\bCH₄\b/g, spoken: "C H four, methane" },
  { regex: /\bNH3\b/g, spoken: "N H three, ammonia" },
  { regex: /\bNH₃\b/g, spoken: "N H three, ammonia" },
  { regex: /\bCaCO3\b/g, spoken: "calcium carbonate" },
  { regex: /\bC6H12O6\b/g, spoken: "glucose, C six H twelve O six" }
];

// ============================================================
// 3. UNITS & ABBREVIATIONS
// ============================================================
function expandUnits(str) {
  return str
    .replace(/(\d+(?:\.\d+)?)\s*(?:km\/h|kmph)\b/gi, "$1 kilometers per hour")
    .replace(/(\d+(?:\.\d+)?)\s*(?:m\/s)\b/gi, "$1 meters per second")
    .replace(/(\d+(?:\.\d+)?)\s*mph\b/gi, "$1 miles per hour")
    .replace(/(\d+(?:\.\d+)?)\s*GHz\b/gi, "$1 gigahertz")
    .replace(/(\d+(?:\.\d+)?)\s*MHz\b/gi, "$1 megahertz")
    .replace(/(\d+(?:\.\d+)?)\s*kHz\b/gi, "$1 kilohertz")
    .replace(/(\d+(?:\.\d+)?)\s*Hz\b/gi, "$1 hertz")
    .replace(/(\d+(?:\.\d+)?)\s*Gbps\b/gi, "$1 gigabits per second")
    .replace(/(\d+(?:\.\d+)?)\s*Mbps\b/gi, "$1 megabits per second")
    .replace(/(\d+(?:\.\d+)?)\s*kbps\b/gi, "$1 kilobits per second")
    .replace(/(\d+(?:\.\d+)?)\s*TB\b/g, "$1 terabytes")
    .replace(/(\d+(?:\.\d+)?)\s*GB\b/g, "$1 gigabytes")
    .replace(/(\d+(?:\.\d+)?)\s*MB\b/g, "$1 megabytes")
    .replace(/(\d+(?:\.\d+)?)\s*KB\b/g, "$1 kilobytes")
    .replace(/(\d+(?:\.\d+)?)\s*bytes\b/gi, "$1 bytes")
    .replace(/(\d+(?:\.\d+)?)\s*ms\b/gi, "$1 milliseconds")
    .replace(/(\d+(?:\.\d+)?)\s*μs\b/gi, "$1 microseconds")
    .replace(/(\d+(?:\.\d+)?)\s*ns\b/gi, "$1 nanoseconds")
    .replace(/(\d+(?:\.\d+)?)\s*kg\b/gi, "$1 kilograms")
    .replace(/(\d+(?:\.\d+)?)\s*mg\b/gi, "$1 milligrams")
    .replace(/(\d+(?:\.\d+)?)\s*cm\b/gi, "$1 centimeters")
    .replace(/(\d+(?:\.\d+)?)\s*mm\b/gi, "$1 millimeters")
    .replace(/(\d+(?:\.\d+)?)\s*km\b/gi, "$1 kilometers")
    .replace(/(\d+(?:\.\d+)?)\s*°C\b/gi, "$1 degrees Celsius")
    .replace(/(\d+(?:\.\d+)?)\s*°F\b/gi, "$1 degrees Fahrenheit")
    .replace(/(\d+(?:\.\d+)?)\s*V\b/g, "$1 volts")
    .replace(/(\d+(?:\.\d+)?)\s*mV\b/gi, "$1 millivolts")
    .replace(/(\d+(?:\.\d+)?)\s*mA\b/gi, "$1 milliamps")
    .replace(/(\d+(?:\.\d+)?)\s*A\b/g, "$1 amps")
    .replace(/(\d+(?:\.\d+)?)\s*Ω|ohms?\b/gi, "$1 ohms")
    .replace(/(\d+(?:\.\d+)?)\s*kΩ\b/gi, "$1 kilo-ohms");
}

// ============================================================
// 4. MATHEMATICAL & FORMULA NORMALIZATION
// ============================================================
function normalizeMathFormulas(str) {
  let text = str;

  // Probability & conditional notation: P(A | B) -> probability of A given B
  text = text.replace(/\bP\(([a-zA-Z0-9]+)\s*\|\s*([a-zA-Z0-9]+)\)/g, "probability of $1 given $2");
  text = text.replace(/\bP\(([a-zA-Z0-9\s∩∪+]+)\)/g, "probability of $1");

  // Mathematical functions f(x), g(x), sin(x), log(x)
  text = text.replace(/\b([fgh])\(([a-zA-Z0-9]+)\)/g, "$1 of $2");
  text = text.replace(/\b(sin|cos|tan|sec|cosec|cot)\(([a-zA-Z0-9]+)\)/gi, "$1 of $2");
  text = text.replace(/\blog\(([a-zA-Z0-9]+)\)/gi, "log of $1");
  text = text.replace(/\bln\(([a-zA-Z0-9]+)\)/gi, "natural log of $1");
  text = text.replace(/\blim_\{([^}]+)\}/gi, "limit as $1");

  // Roots
  text = text.replace(/(?:√|\\sqrt)\s*([a-zA-Z0-9]+)/g, "square root of $1");
  text = text.replace(/\bsqrt\(([^)]+)\)/gi, "square root of $1");
  text = text.replace(/∛\s*([a-zA-Z0-9]+)/g, "cube root of $1");

  // Exponents & powers: x^2 -> x squared, x^3 -> x cubed, x^n -> x to the power of n
  text = text.replace(/([a-zA-Z0-9α-ωΑ-Ω_]+)\^2\b/g, "$1 squared");
  text = text.replace(/([a-zA-Z0-9α-ωΑ-Ω_]+)\^3\b/g, "$1 cubed");
  text = text.replace(/([a-zA-Z0-9α-ωΑ-Ω_]+)\^([a-zA-Z0-9α-ωΑ-Ω_]+)/g, "$1 to the power of $2");
  text = text.replace(/²/g, " squared");
  text = text.replace(/³/g, " cubed");
  text = text.replace(/⁴/g, " to the fourth power");
  text = text.replace(/ⁿ/g, " to the power of n");

  // Plus / minus
  text = text.replace(/±|\\pm|\+\/-/g, " plus or minus ");
  text = text.replace(/∓|\\mp/g, " minus or plus ");

  // Greek letters commonly used in engineering / science
  const greekLetters = [
    { regex: /\\alpha|α/g, word: "alpha" },
    { regex: /\\beta|β/g, word: "beta" },
    { regex: /\\gamma|γ/g, word: "gamma" },
    { regex: /\\theta|θ/g, word: "theta" },
    { regex: /\\lambda|λ/g, word: "lambda" },
    { regex: /\\mu|μ/g, word: "mu" },
    { regex: /\\pi|π/g, word: "pi" },
    { regex: /\\sigma|σ/g, word: "sigma" },
    { regex: /\\omega|ω/g, word: "omega" },
    { regex: /\\Delta|Δ/g, word: "delta" },
    { regex: /\\epsilon|ε/g, word: "epsilon" },
    { regex: /\\phi|φ/g, word: "phi" },
    { regex: /\\psi|ψ/g, word: "psi" },
    { regex: /\\rho|ρ/g, word: "rho" }
  ];
  greekLetters.forEach(({ regex, word }) => {
    text = text.replace(regex, word);
  });

  // Relational & set operators
  text = text
    .replace(/!=|≠|\\neq/g, " is not equal to ")
    .replace(/<=|≤|\\leq/g, " is less than or equal to ")
    .replace(/>=|≥|\\geq/g, " is greater than or equal to ")
    .replace(/==/g, " is equal to ")
    .replace(/≈|\\approx/g, " is approximately ")
    .replace(/≡|\\equiv/g, " is equivalent to ")
    .replace(/∝|\\propto/g, " is proportional to ")
    .replace(/->|→|⇒|\\to/g, " implies ")
    .replace(/<->|↔|⇔/g, " if and only if ")
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

  // Arithmetic operators between tokens (preserves hyphenated words)
  text = text
    .replace(/([a-zA-Z0-9])\s*[\*×]\s*([a-zA-Z0-9])/g, "$1 times $2")
    .replace(/([a-zA-Z0-9])\s*÷\s*([a-zA-Z0-9])/g, "$1 divided by $2")
    .replace(/\s+[\/÷]\s+/g, " divided by ")
    .replace(/(\b[a-zA-Z]\b|\d+)\s*\/\s*(\b[a-zA-Z]\b|\d+)\b/g, "$1 divided by $2")
    .replace(/([a-zA-Z0-9])\s*\+\s*([a-zA-Z0-9])/g, "$1 plus $2")
    .replace(/\s+\+\s+/g, " plus ")
    .replace(/(\b[a-zA-Z]\b|\d+)\s*[-–—]\s*(\b[a-zA-Z]\b|\d+)/g, "$1 minus $2")
    .replace(/\s+[-–—]\s+(?=[a-zA-Z0-9])/g, " minus ")
    .replace(/([a-zA-Z0-9])\s*=\s*([a-zA-Z0-9])/g, "$1 equals $2")
    .replace(/\s+=\s+/g, " equals ")
    .replace(/([a-zA-Z0-9])\s*<\s*([a-zA-Z0-9])/g, "$1 is less than $2")
    .replace(/([a-zA-Z0-9])\s*>\s*([a-zA-Z0-9])/g, "$1 is greater than $2");

  return text;
}

// ============================================================
// 5. TEXT CLEANUP & ARTIFACT STRIPPING
// ============================================================
function cleanArtifacts(rawText) {
  let str = String(rawText || "");

  // 1. Remove broken hyphenated line breaks (e.g. "con-\nclusion" -> "conclusion")
  str = str.replace(/(\b[a-zA-Z]{2,})-\s*\n\s*([a-zA-Z]{2,}\b)/g, "$1$2");

  // 2. Remove standalone page number footers (e.g. "Page 1 of 12", "--- 12 ---", "- 12 -")
  str = str.replace(/^(?:page|\s*[-–—]*)\s*\d+\s*(?:of\s*\d+)?\s*[-–—]*$/gim, "");

  // 3. Remove URLs & long email noise (read naturally instead of spelling out character by character)
  str = str.replace(/https?:\/\/[^\s]+/gi, "link to resource");
  str = str.replace(/www\.[^\s]+/gi, "website");
  str = str.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, "email address");

  // 4. Remove shape glyphs, black squares, geometric bullets, and Wingdings
  const geometricSymbols = /[\u25A0-\u25FF\u2B1B\u2B1C\u2022\u25E6\u2023\u2043\u25C6\u25C7\u27A2\u27A4\u2794\u279C\u2600-\u26FF\u2700-\u27BF\uF0A0-\uF0FF§¶]/g;
  str = str.replace(geometricSymbols, " ");

  // 5. Remove citations like [1], [2, 3], [4-7]
  str = str.replace(/\[\s*\d+(?:[\s,\-–]+\d+)*\s*\]/g, "");

  // 6. Brackets: replace square & curly braces with spacing (keep parentheses for math parsing)
  str = str.replace(/[\[\]{【】〔〕［］⟨⟩‹›«»]/g, " ");

  // 7. Academic abbreviations
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

  // 8. Percentages, currency, fractions
  str = str
    .replace(/(\d+(?:\.\d+)?)\s*%/g, "$1 percent")
    .replace(/\$([0-9]+(?:\.[0-9]+)?)/g, "$1 dollars")
    .replace(/₹([0-9]+(?:\.[0-9]+)?)/g, "$1 rupees")
    .replace(/\b1\/2\b/g, "one half")
    .replace(/\b1\/3\b/g, "one third")
    .replace(/\b2\/3\b/g, "two thirds")
    .replace(/\b1\/4\b/g, "one quarter")
    .replace(/\b3\/4\b/g, "three quarters");

  // 9. Decimal numbers: 3.14 -> 3 point 1 4
  str = str.replace(/\b(\d+)\.(\d+)\b/g, "$1 point $2");

  // 10. Numbered headings e.g. "1.1 Introduction" -> "Section 1.1, Introduction"
  str = str.replace(/(^|\n|\s)(\d+\.\d+(?:\.\d+)?)\s+([A-Z])/g, "$1Section $2, $3");
  // Simple numbered lists e.g. "1. Step one" -> "Item 1, Step one"
  str = str.replace(/(^|\n|\s)(\d+)\.\s+/g, "$1Item $2, ");

  // 11. Normalize excessive whitespace & duplicate punctuation
  str = str
    .replace(/\.{2,}/g, ". ")
    .replace(/,\s*,+/g, ",")
    .replace(/\s*,\s*\./g, ".")
    .replace(/["“”'‘’`]/g, "")
    .replace(/\s+[—–-]\s+/g, ", ")
    .replace(/\s+/g, " ")
    .trim();

  return str;
}

// ============================================================
// 6. MAIN TEXT NORMALIZATION FUNCTION
// ============================================================
function normalizeText(text, userOverrides = {}) {
  if (!text) return "";

  // 1. Clean formatting and artifacts
  let cleaned = cleanArtifacts(text);

  // 2. Expand chemical formulas
  for (const { regex, spoken } of CHEMICAL_FORMULAS) {
    cleaned = cleaned.replace(regex, spoken);
  }

  // 3. Expand units and measurements
  cleaned = expandUnits(cleaned);

  // 4. Normalize mathematical expressions and equations
  cleaned = normalizeMathFormulas(cleaned);

  // 5. Replace remaining non-math parentheses with natural comma pauses
  cleaned = cleaned
    .replace(/\s*[（(]\s*/g, ", ")
    .replace(/\s*[）)]\s*/g, ", ");

  // 6. Apply technical vocabulary pronunciation rules
  const dict = { ...DEFAULT_PRONUNCIATION_DICTIONARY, ...(userOverrides || {}) };
  for (const [term, phonetic] of Object.entries(dict)) {
    // Word boundary regex with case-sensitive or exact matching
    const regex = new RegExp(`\\b${term}\\b`, "g");
    cleaned = cleaned.replace(regex, phonetic);
  }

  // Final cleanup of spaces
  return cleaned.replace(/\s+/g, " ").trim();
}

// ============================================================
// 7. SENTENCE TOKENIZER WITH EXACT CHAR OFFSETS
// ============================================================
function splitIntoSentences(rawText) {
  if (!rawText) return [];

  // Match sentences ending in ., !, ? followed by space or newline, or end of string
  const regex = /[^.!?]+(?:[.!?]+(?=\s+|$)|$)/g;
  const sentences = [];
  let match;

  while ((match = regex.exec(rawText)) !== null) {
    const rawSentence = match[0].trim();
    if (!rawSentence) continue;

    const start = match.index;
    const end = start + match[0].length;

    sentences.push({
      start,
      end,
      rawSentence,
      spokenSentence: normalizeText(rawSentence)
    });
  }

  return sentences;
}

// ============================================================
// 8. STRUCTURED READING BLOCKS GENERATOR (PAGE-AWARE)
// ============================================================
/**
 * Decomposes extracted page/document sections into structured reading blocks
 * mapped to exact page numbers and raw text for synchronized Follow Along highlighting.
 */
function createReadingBlocks(extractedSections, docId = "doc", userOverrides = {}) {
  const blocks = [];

  if (!Array.isArray(extractedSections)) {
    return blocks;
  }

  extractedSections.forEach((section, secIdx) => {
    const pageNum = Number(section.pageNumber || section.slideNumber || secIdx + 1);
    const rawContent = section.text || section.content || "";
    if (!rawContent.trim()) return;

    // Split section into distinct paragraphs/blocks
    const paragraphs = rawContent.split(/\n\s*\n+/).map(p => p.trim()).filter(Boolean);

    paragraphs.forEach((para, paraIdx) => {
      const blockId = `${docId}_p${pageNum}_b${paraIdx + 1}`;
      
      // Determine block type
      let blockType = "paragraph";
      if (/^(?:chapter|section|unit|experiment|\d+\.\d+)\b/i.test(para) || para.length < 80 && !para.endsWith(".")) {
        blockType = "heading";
      } else if (/^(?:[-*•]|\d+\.)\s+/m.test(para)) {
        blockType = "list_item";
      } else if (/^[A-Za-z0-9_\s\+\-\*\/\=\<\>\(\)]+$/.test(para) && para.includes("=")) {
        blockType = "equation";
      }

      // Sentence boundaries with source offsets
      const sentences = splitIntoSentences(para);
      const normalizedSpoken = normalizeText(para, userOverrides);

      // Build SSML representation with appropriate pause
      let pauseDuration = "250ms";
      if (blockType === "heading") pauseDuration = "450ms";
      else if (blockType === "list_item") pauseDuration = "180ms";
      else if (blockType === "equation") pauseDuration = "350ms";

      const ssmlText = `<p>${sentences.map(s => `<s>${escapeXml(s.spokenSentence)}</s>`).join(" ")}</p><break time="${pauseDuration}"/>`;

      blocks.push({
        id: blockId,
        pageNumber: pageNum,
        blockIndex: paraIdx,
        type: blockType,
        rawText: para,
        spokenText: normalizedSpoken,
        ssmlText,
        sentenceCount: sentences.length,
        sentences: sentences.map((s, idx) => ({
          sentenceIndex: idx,
          start: s.start,
          end: s.end,
          raw: s.rawSentence,
          spoken: s.spokenSentence
        }))
      });
    });
  });

  return blocks;
}

// XML escaping for SSML safety
function escapeXml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

module.exports = {
  normalizeText,
  cleanArtifacts,
  normalizeMathFormulas,
  expandUnits,
  splitIntoSentences,
  createReadingBlocks,
  DEFAULT_PRONUNCIATION_DICTIONARY
};
