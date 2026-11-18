const MAX_CHUNK_LENGTH = 1600;
const MAX_CONTEXT_CHUNKS = 6;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const aiProviderRouter = require("./ai-provider-router");

const STOP_WORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and",
  "any", "are", "aren't", "as", "at", "be", "because", "been", "before", "being",
  "below", "between", "both", "but", "by", "can", "can't", "cannot", "could",
  "couldn't", "did", "didn't", "do", "does", "doesn't", "doing", "don't", "down",
  "during", "each", "few", "for", "from", "further", "had", "hadn't", "has",
  "hasn't", "have", "haven't", "having", "he", "he'd", "he'll", "he's", "her",
  "here", "here's", "hers", "herself", "him", "himself", "his", "how", "how's",
  "i", "i'd", "i'll", "i'm", "i've", "if", "in", "into", "is", "isn't", "it",
  "it's", "its", "itself", "let's", "me", "more", "most", "mustn't", "my",
  "myself", "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other",
  "ought", "our", "ours", "ourselves", "out", "over", "own", "same", "shan't",
  "she", "she'd", "she'll", "she's", "should", "shouldn't", "so", "some", "such",
  "than", "that", "that's", "the", "their", "theirs", "them", "themselves",
  "then", "there", "there's", "these", "they", "they'd", "they'll", "they're",
  "they've", "this", "those", "through", "to", "too", "under", "until", "up",
  "very", "was", "wasn't", "we", "we'd", "we'll", "we're", "we've", "were",
  "weren't", "what", "what's", "when", "when's", "where", "where's", "which",
  "while", "who", "who's", "whom", "why", "why's", "with", "won't", "would",
  "wouldn't", "you", "you'd", "you'll", "you're", "you've", "your", "yours",
  "yourself", "yourselves", "tell", "explain", "describe", "give", "please"
]);

function splitText(text) {
  const sentences =
    String(text || "")
      .replace(/\s+/g, " ")
      .trim()
      .match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];

  const chunks = [];
  let current = "";

  sentences.forEach((sentence) => {
    const cleanSentence = sentence.trim();
    if (!cleanSentence) return;

    if (
      current &&
      current.length + cleanSentence.length + 1 > MAX_CHUNK_LENGTH
    ) {
      chunks.push(current);
      current = "";
    }

    current = current ? `${current} ${cleanSentence}` : cleanSentence;
  });

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

/**
 * Creates page/slide/section-aware document chunks.
 * @param {Array|string} input - Either an array of { pageNumber, slideNumber, sectionNumber, text } or a plain text string.
 * @returns {Array} Array of chunk objects with metadata.
 */
function createChunks(input) {
  if (Array.isArray(input)) {
    const chunks = [];
    let globalId = 0;

    input.forEach((item) => {
      const pageNum = typeof item.pageNumber === "number" ? item.pageNumber : null;
      const slideNum = typeof item.slideNumber === "number" ? item.slideNumber : null;
      const sectionNum = typeof item.sectionNumber === "number" ? item.sectionNumber : null;
      const rawText = String(item.text || "").trim();
      if (!rawText) return;

      const pageChunks = splitText(rawText);
      pageChunks.forEach((chunkText) => {
        chunks.push({
          id: globalId++,
          pageNumber: pageNum,
          slideNumber: slideNum,
          sectionNumber: sectionNum,
          text: chunkText
        });
      });
    });

    return chunks;
  }

  return splitText(input).map((chunk, index) => ({
    id: index,
    pageNumber: null,
    slideNumber: null,
    sectionNumber: null,
    text: chunk
  }));
}

/**
 * Tokenize a text string into normalized terms, removing punctuation and short tokens.
 */
function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 1);
}

/**
 * Enhanced Lexical Retrieval using BM25 Ranking.
 * Features:
 * - Term Frequency (TF) saturation with k1 = 1.2
 * - Document Length normalization with b = 0.75
 * - Inverse Document Frequency (IDF) with Robertson-Spärck Jones formula
 * - Stopword pruning for high-signal content matching
 * - Multi-word verbatim phrase bonus
 *
 * Architecture note: Modular and extensible for future vector/embedding-based retrievers.
 */
function selectRelevantChunks(chunks, question, options = {}) {
  const maxChunks = options.maxChunks || MAX_CONTEXT_CHUNKS;

  if (!chunks || chunks.length === 0) return [];
  if (!question || !String(question).trim()) {
    return chunks.slice(0, maxChunks);
  }

  const rawTerms = tokenize(question);
  const queryTerms = rawTerms.filter((term) => !STOP_WORDS.has(term));
  const effectiveTerms = queryTerms.length > 0 ? queryTerms : rawTerms;

  if (effectiveTerms.length === 0) {
    return chunks.slice(0, maxChunks);
  }

  const N = chunks.length;
  let totalLength = 0;
  const chunkTokens = chunks.map((chunk) => {
    const tokens = tokenize(chunk.text);
    totalLength += tokens.length;
    return tokens;
  });
  const avgdl = totalLength / N || 1;

  // Compute Document Frequency (DF) for each term
  const df = {};
  effectiveTerms.forEach((term) => {
    let count = 0;
    for (let i = 0; i < N; i++) {
      if (chunkTokens[i].includes(term)) {
        count++;
      }
    }
    df[term] = count;
  });

  // Calculate IDF for each term
  const idf = {};
  effectiveTerms.forEach((term) => {
    const docFreq = df[term] || 0;
    idf[term] = Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1);
  });

  const k1 = 1.2;
  const b = 0.75;
  const cleanQuestion = String(question).toLowerCase().trim();

  // Score each chunk using BM25 + phrase match bonus
  const scoredChunks = chunks.map((chunk, index) => {
    const tokens = chunkTokens[index];
    const docLen = tokens.length;
    const lowerText = chunk.text.toLowerCase();

    // Compute Term Frequencies in this chunk
    const tf = {};
    tokens.forEach((token) => {
      tf[token] = (tf[token] || 0) + 1;
    });

    let bm25Score = 0;
    effectiveTerms.forEach((term) => {
      const termFreq = tf[term] || 0;
      if (termFreq > 0) {
        const numerator = termFreq * (k1 + 1);
        const denominator = termFreq + k1 * (1 - b + (b * docLen) / avgdl);
        bm25Score += (idf[term] || 0) * (numerator / denominator);
      }
    });

    // Exact phrase match bonus if multi-word query appears verbatim
    if (effectiveTerms.length >= 2 && lowerText.includes(cleanQuestion)) {
      bm25Score += 3.0;
    }

    return {
      ...chunk,
      score: bm25Score
    };
  });

  // Sort descending by BM25 relevance score
  scoredChunks.sort((a, b) => b.score - a.score);

  // If no chunks scored > 0, fallback gracefully to initial chunks
  if (scoredChunks[0].score === 0) {
    return chunks.slice(0, maxChunks);
  }

  return scoredChunks.slice(0, maxChunks);
}

/**
 * Unified extensible retriever interface.
 * Can be augmented with embedding-based vector search in future phases.
 */
function retrieveRelevantChunks(chunks, query, options = {}) {
  const method = options.method || "bm25";
  if (method === "bm25") {
    return selectRelevantChunks(chunks, query, options);
  }
  return selectRelevantChunks(chunks, query, options);
}

function buildPrompt(mode, question, chunks, history = [], options = {}) {
  const summaryType = options.summaryType || "quick";

  const context = chunks
    .map((chunk, index) => {
      let header = `[Document Excerpt ${index + 1}]`;
      if (typeof chunk.pageNumber === "number" && chunk.pageNumber > 0) {
        header = `[Document Page ${chunk.pageNumber}, Excerpt ${index + 1}]`;
      } else if (typeof chunk.slideNumber === "number" && chunk.slideNumber > 0) {
        header = `[Document Slide ${chunk.slideNumber}, Excerpt ${index + 1}]`;
      } else if (typeof chunk.sectionNumber === "number" && chunk.sectionNumber > 0) {
        header = `[Document Section ${chunk.sectionNumber}, Excerpt ${index + 1}]`;
      }
      return `${header}\n${chunk.text}`;
    })
    .join("\n\n");

  let conversationHistoryText = "";
  if (Array.isArray(history) && history.length > 0) {
    const formattedHistory = history
      .slice(-6)
      .map((h) => `${h.role === "user" ? "Student" : "Tutor"}: ${h.message}`)
      .join("\n");
    conversationHistoryText = `\nRecent Discussion Turns:\n${formattedHistory}\n`;
  }

  let task = "";
  if (mode === "overview") {
    task = "Provide a structured, comprehensive curriculum overview of the document: key topics, core concepts, and exam importance.";
  } else if (mode === "summary") {
    if (summaryType === "quick") {
      task = `Provide an executive 3-bullet summary highlighting the most critical concepts from the document.
CRITICAL FORMATTING CONSTRAINTS:
- Output EXACTLY 3 bullet points, each starting with '* '.
- Do NOT output any introductory greetings, conversational fluff, preambles (e.g. do NOT write "Here is a 3-bullet summary:"), or concluding remarks.
- Each bullet must be dense, clear, and informative.
- Include accurate page/slide citations in brackets (e.g. [Page X]) if page metadata is available in the excerpt headers.`;
    } else if (summaryType === "takeaways") {
      task = `Generate a high-yield exam revision sheet strictly grounded in this study material.
CRITICAL SUBJECT-ADAPTIVE RULES:
- Adapt the structure strictly to the subject matter of the document. Do NOT force formulas, mathematical laws, or comparison tables if the document is conceptual, qualitative, or does not contain them.
- Only include sections that genuinely apply to the content:
  * ## 🎯 Essential Terms & Core Definitions (bulleted list of examinable terminology and clear definitions grounded in the text)
  * If the document contains quantitative formulas, equations, or formal laws, include: ## 📐 Key Formulas, Principles & Laws
  * If the document compares techniques, models, or paradigms, include: ## ⚖️ Crucial Distinctions & Comparisons (in a clean markdown table)
  * ## 📝 High-Probability Exam Questions (3-5 realistic exam questions with concise model answers grounded entirely in the document)
- Maintain an objective, high-yield academic revision tone without conversational fluff or greetings.
- Include accurate page/slide citations (e.g. [Page X]) where supported by the excerpt headers.`;
    } else {
      // Detailed summary
      task = `Provide a comprehensive, in-depth academic study breakdown across the main sections of this document.
CRITICAL FORMATTING CONSTRAINTS:
- Organize into structured markdown sections using clear headings (e.g., '## Overview', '### Key Theoretical Foundations', '### Core Concepts & Mechanisms', '### Practical Implications & Applications').
- Provide complete, thorough explanations under each heading.
- Use clean markdown lists and bold definitions. Ensure all markdown headings are well-formed on their own lines.
- Do NOT output conversational filler, greetings, or preambles.
- Include accurate page/slide citations (e.g. [Page X]) where supported by the excerpt headers.`;
    }
  } else if (mode === "explanation") {
    task = `Explain the following concept or excerpt in clear, friendly pedagogical terms with an intuitive real-world analogy: "${question}".`;
  } else {
    task = `Answer the student's question: "${question}".`;
  }

  const personaInstruction = mode === "summary"
    ? "1. Output strictly the requested academic summary or exam revision sheet. Start directly with the content or section header. Do NOT include any conversational greetings (e.g., do NOT write 'Hello there!', 'Welcome', or 'As StudyReader...'), preambles, or concluding remarks."
    : "1. Answer as StudyReader, an encouraging, knowledgeable college teacher whose primary goal is to make the student truly understand.";

  return `Task: ${task}
${conversationHistoryText}
Provided Document Excerpts:
${context || "No readable excerpts extracted."}

Instructions for your response:
${personaInstruction}
2. Ground your response strictly in the Provided Document Excerpts above.
3. CITATION RULES:
   - When citing or referencing information from a specific page or slide indicated in the excerpts, provide the citation in brackets (e.g., [Page 3] or [Slide 4]).
   - Validate that the cited page or slide matches the actual excerpt header.
   - For non-page documents (such as Word documents or unpaged text), do NOT invent or guess page numbers.
   - NEVER invent, extrapolate, or hallucinate citations not present in the excerpt headers.
4. If the information needed to answer the question is NOT present in the provided document excerpts, state clearly: "This topic could not be found in the provided study document." You may then provide a brief general explanation while reminding the student that it is outside this document.
5. Use clear, conversational English with intuitive analogies when explaining difficult concepts.`;
}

async function callGeminiApi({ apiKey, prompt, _retryCount = 0 }) {
  try {
    const result = await aiProviderRouter.generateWithFallback({ prompt });
    return result.text;
  } catch (err) {
    throw err;
  }
}

// Intermediate section digest cache: documentId/contentKey -> { totalPages, extractedPages, emptyPages, batchesProcessed, pageRangesCovered, combinedDigest, timestamp }
const intermediateDigestCache = new Map();

async function mapConcurrent(items, fn, limit = 3) {
  const results = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const currentIdx = idx++;
      results[currentIdx] = await fn(items[currentIdx], currentIdx);
    }
  });
  await Promise.all(workers);
  return results;
}

function buildReducePrompt(summaryType, totalPages, combinedDigest) {
  if (summaryType === "quick") {
    return `You are an academic tutor preparing an executive 3-bullet summary of a complete academic document containing ${totalPages} pages.
You must synthesize the full scope from the intermediate section digests below, ensuring the beginning, middle, and end of the document are all represented.

Intermediate Section Digests Across Entire Document (Pages 1 to ${totalPages}):
${combinedDigest}

CRITICAL CONSTRAINTS:
1. Output EXACTLY 3 bullet points, each starting with '* '.
2. Do NOT output any title, introductory greetings, preamble (e.g., do NOT write "Here is the 3-bullet summary"), or concluding remarks.
3. Distribution:
   - Bullet 1 must capture the foundational concepts, definitions, and motivations from the beginning of the document (cites initial pages, e.g. [Pages 1–15]).
   - Bullet 2 must capture the core mechanisms, methods, formal rules, or frameworks from the middle of the document (cites middle pages).
   - Bullet 3 must capture the advanced applications, theorems, conclusions, and synthesis from the final sections of the document (cites final pages up to [Page ${totalPages}]).
4. Each bullet must be dense, clear, academically precise, and include accurate bracketed page citations based strictly on the section digests.`;
  }

  if (summaryType === "takeaways") {
    return `You are an academic professor preparing a high-yield exam revision sheet of a complete academic document across all ${totalPages} pages.
Synthesize the intermediate section digests below into an actionable revision sheet.

Intermediate Section Digests Across Entire Document (Pages 1 to ${totalPages}):
${combinedDigest}

CRITICAL SUBJECT-ADAPTIVE RULES:
1. Adapt the structure strictly to the subject matter of the document. Ground all questions and revision points strictly in the source material across all sections (Pages 1 to ${totalPages}).
2. Do NOT include conversational greetings, preambles, or concluding filler. Start immediately with the first section heading.
3. Structure:
   ## 🎯 Essential Terms & Core Definitions
   (Dense bulleted list of examinable terminology and definitions spanning the entire document, citing [Page X]).

   (Include ONLY if formal laws, formulas, or equations appear in the source)
   ## 📐 Key Formulas, Principles & Laws
   (Mathematical formulas, formal inference rules, or scientific laws with explanations).

   (Include ONLY if comparisons or distinctions appear in the source)
   ## ⚖️ Crucial Distinctions & Comparisons
   (A clean markdown table contrasting key models, paradigms, or techniques).

   ## 📝 High-Probability Exam Questions & Model Answers
   (4 to 6 realistic exam questions spanning the beginning, middle, and end of the document. Each question must have a concise, accurate model answer grounded entirely in the material, with [Page X] citations).`;
  }

  // Default: Detailed summary
  return `You are an academic professor providing a comprehensive, in-depth academic study breakdown across all ${totalPages} pages of this document.
Synthesize the intermediate section digests below into a coherent, structured study guide.

Intermediate Section Digests Across Entire Document (Pages 1 to ${totalPages}):
${combinedDigest}

CRITICAL FORMATTING CONSTRAINTS:
1. Organize into structured markdown sections using clear headings on their own lines:
   ## 1. Foundational Concepts & Background
   ## 2. Core Methodologies, Principles & Formalisms
   ## 3. Advanced Topics & Specialized Applications
   ## 4. Key Takeaways & Synthesis
2. Ensure thorough coverage of the entire document trajectory from Page 1 to Page ${totalPages}.
3. Bold key terms and maintain an objective, academic tone.
4. Include accurate bracketed page citations (e.g. [Page X] or [Pages X–Y]) grounded in the provided digests.
5. Do NOT output greetings, conversational filler, or preambles. Start directly with the first section heading.`;
}

async function generateHierarchicalSummary({ pages = [], text = "", summaryType = "quick", documentId = null, apiKey }) {
  let readablePages = [];
  let totalPages = 0;
  let emptyPages = 0;

  if (Array.isArray(pages) && pages.length > 0) {
    totalPages = pages.length;
    pages.forEach((p, idx) => {
      const pageText = String(p.text || "").trim();
      const pageNum = typeof p.pageNumber === "number" ? p.pageNumber : (idx + 1);
      if (pageText) {
        readablePages.push({
          pageNumber: pageNum,
          slideNumber: typeof p.slideNumber === "number" ? p.slideNumber : null,
          sectionNumber: typeof p.sectionNumber === "number" ? p.sectionNumber : null,
          text: pageText
        });
      } else {
        emptyPages++;
      }
    });
  } else if (text && String(text).trim()) {
    const raw = String(text).trim();
    const chunkSize = 10000;
    let offset = 0;
    let pNum = 1;
    while (offset < raw.length) {
      readablePages.push({
        pageNumber: pNum++,
        text: raw.slice(offset, offset + chunkSize)
      });
      offset += chunkSize;
    }
    totalPages = readablePages.length;
  }

  if (readablePages.length === 0) {
    throw new Error("No readable pages extracted from the document.");
  }

  const cacheKey = documentId ? `doc-${documentId}` : `hash-${readablePages.length}-${readablePages[0].text.slice(0, 40)}`;

  let intermediateData = intermediateDigestCache.get(cacheKey);

  if (!intermediateData) {
    const batches = [];
    let currentBatch = [];
    let currentChars = 0;
    const MAX_BATCH_PAGES = 8;
    const MAX_BATCH_CHARS = 16000;

    readablePages.forEach((page) => {
      const pageLen = page.text.length;
      if (
        currentBatch.length >= MAX_BATCH_PAGES ||
        (currentChars + pageLen > MAX_BATCH_CHARS && currentBatch.length >= 3)
      ) {
        batches.push(currentBatch);
        currentBatch = [page];
        currentChars = pageLen;
      } else {
        currentBatch.push(page);
        currentChars += pageLen;
      }
    });
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    const batchDigests = await mapConcurrent(batches, async (batch) => {
      const startPage = batch[0].pageNumber;
      const endPage = batch[batch.length - 1].pageNumber;
      const isSlide = batch[0].slideNumber != null;
      const unitLabel = isSlide ? "Slide" : "Page";
      const range = startPage === endPage ? `${unitLabel} ${startPage}` : `${unitLabel}s ${startPage}–${endPage}`;
      const batchText = batch.map((p) => `[${unitLabel} ${p.pageNumber || p.slideNumber || p.sectionNumber}]\n${p.text}`).join("\n\n");

      const mapPrompt = `You are an academic researcher creating an accurate, high-density factual digest of a textbook or slide section.
Coverage: ${range} of ${totalPages} total ${unitLabel.toLowerCase()}s.

Document Section Excerpts:
${batchText}

Task:
Synthesize a concise, factually dense academic digest of this specific section (${range}).
Requirements:
1. Cover all core concepts, definitions, formal models, algorithms, or theorems introduced in these pages.
2. Label specific concepts with their exact page citation from the excerpt header, e.g. [${unitLabel} ${startPage}].
3. If formulas, inference rules, comparisons, or architectures appear, include their exact formulations.
4. Keep the digest concise and high-yield (approx 200–350 words).
5. Output ONLY the factual digest. Do NOT include greetings, preambles, or conversational filler.`;

      const digest = await callGeminiApi({ apiKey, prompt: mapPrompt });
      return { range, startPage, endPage, digest };
    }, 3);

    const combinedDigest = batchDigests
      .map((b) => `=== Section (${b.range}) ===\n${b.digest}`)
      .join("\n\n");

    const firstPage = readablePages[0].pageNumber;
    const lastPage = readablePages[readablePages.length - 1].pageNumber;

    intermediateData = {
      totalPages,
      extractedPages: readablePages.length,
      emptyPages,
      batchesProcessed: batches.length,
      pageRangesCovered: `${firstPage}–${lastPage}`,
      batchDigests,
      combinedDigest,
      timestamp: Date.now()
    };

    if (intermediateDigestCache.size > 50) {
      const oldestKey = intermediateDigestCache.keys().next().value;
      intermediateDigestCache.delete(oldestKey);
    }
    intermediateDigestCache.set(cacheKey, intermediateData);
  }

  const reducePrompt = buildReducePrompt(summaryType, intermediateData.totalPages, intermediateData.combinedDigest);
  const synthesizedAnswer = await callGeminiApi({ apiKey, prompt: reducePrompt });

  const sources = (intermediateData.batchDigests || []).map((b, idx) => ({
    chunkId: idx + 1,
    pageRange: b.range,
    pageNumber: b.startPage,
    preview: b.digest.slice(0, 180)
  }));

  return {
    answer: synthesizedAnswer,
    sources,
    coverage: {
      totalPages: intermediateData.totalPages,
      extractedPages: intermediateData.extractedPages,
      emptyPages: intermediateData.emptyPages,
      batchesProcessed: intermediateData.batchesProcessed,
      pageRangesCovered: intermediateData.pageRangesCovered,
      synthesisCompleted: true
    },
    provider: "gemini"
  };
}

async function answer({ mode, question = "", text = "", pages = [], history = [], summaryType = "", documentId = null, chunks = null, selectedChunks: preselectedChunks = null }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error("GEMINI_API_KEY is not configured in backend/.env. Please provide a valid Gemini API key to enable AI tutoring.");
  }

  if (mode === "summary") {
    return generateHierarchicalSummary({
      pages,
      text,
      summaryType,
      documentId,
      apiKey
    });
  }

  let selectedChunks;
  if (Array.isArray(preselectedChunks) && preselectedChunks.length > 0) {
    selectedChunks = preselectedChunks;
  } else {
    const inputSource = (Array.isArray(chunks) && chunks.length > 0)
      ? chunks
      : (Array.isArray(pages) && pages.length > 0 ? pages : text);
    const chunkList = (Array.isArray(chunks) && chunks.length > 0)
      ? chunks
      : createChunks(inputSource);

    if (!chunkList.length) {
      throw new Error("No extracted document text is available for AI processing.");
    }

    selectedChunks =
      mode === "ask-ai" && question
        ? selectRelevantChunks(chunkList, question)
        : chunkList.slice(0, MAX_CONTEXT_CHUNKS);
  }

  const sources = selectedChunks.map((chunk) => ({
    chunkId: chunk.id,
    pageNumber: chunk.pageNumber || null,
    slideNumber: chunk.slideNumber || null,
    sectionNumber: chunk.sectionNumber || null,
    preview: chunk.text.slice(0, 180)
  }));

  const prompt = buildPrompt(mode, question, selectedChunks, history, { summaryType });

  const validPages = selectedChunks.map(c => c.pageNumber).filter(Boolean);
  const aiResult = await aiProviderRouter.generateWithFallback({
    prompt,
    requireCitations: mode === "ask-ai" || mode === "explanation",
    validPages
  });

  return {
    answer: aiResult.text,
    sources,
    provider: aiResult.provider,
    model: aiResult.model,
    fallbackOccurred: aiResult.fallbackOccurred
  };
}

module.exports = {
  answer,
  createChunks,
  selectRelevantChunks,
  retrieveRelevantChunks,
  buildPrompt,
  callGeminiApi,
  generateHierarchicalSummary,
  intermediateDigestCache,
  aiProviderRouter
};
