const MAX_CHUNK_LENGTH = 1600;
const MAX_CONTEXT_CHUNKS = 6;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

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
  if (!apiKey || !apiKey.trim()) {
    throw new Error("GEMINI_API_KEY is not configured in backend/.env.");
  }

  const model = GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey.trim()
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2048
        }
      })
    });
  } catch (networkErr) {
    throw new Error(`Failed to reach Gemini API: ${networkErr.message}`);
  }

  if (!response.ok) {
    if (response.status === 429 && _retryCount < 2) {
      await new Promise((resolve) => setTimeout(resolve, 4000 * (_retryCount + 1)));
      return callGeminiApi({ apiKey, prompt, _retryCount: _retryCount + 1 });
    }

    let errorMessage = `Gemini API responded with status ${response.status}`;
    try {
      const errJson = await response.json();
      if (errJson.error?.message) {
        errorMessage = errJson.error.message.replace(/key=[^&\s]+/gi, "key=[REDACTED]");
      }
    } catch (_) {}

    if (response.status === 400 || response.status === 403) {
      throw new Error(`Gemini authentication error: ${errorMessage}`);
    } else if (response.status === 404) {
      throw new Error(`Gemini model '${model}' not found: ${errorMessage}`);
    } else if (response.status === 429) {
      throw new Error(`Gemini rate limit exceeded: ${errorMessage}`);
    } else {
      throw new Error(`Gemini service error (${response.status}): ${errorMessage}`);
    }
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini returned an empty response. Please try rephrasing your question.");
  }

  return text.trim();
}

async function answer({ mode, question = "", text = "", pages = [], history = [], summaryType = "" }) {
  const inputSource = Array.isArray(pages) && pages.length > 0 ? pages : text;
  const chunks = createChunks(inputSource);

  if (!chunks.length) {
    throw new Error("No extracted document text is available for AI processing.");
  }

  const selectedChunks =
    mode === "ask-ai" && question
      ? selectRelevantChunks(chunks, question)
      : chunks.slice(0, MAX_CONTEXT_CHUNKS);

  const sources = selectedChunks.map((chunk) => ({
    chunkId: chunk.id,
    pageNumber: chunk.pageNumber || null,
    slideNumber: chunk.slideNumber || null,
    sectionNumber: chunk.sectionNumber || null,
    preview: chunk.text.slice(0, 180)
  }));

  const prompt = buildPrompt(mode, question, selectedChunks, history, { summaryType });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error("GEMINI_API_KEY is not configured in backend/.env. Please provide a valid Gemini API key to enable AI tutoring.");
  }

  const geminiResponse = await callGeminiApi({
    apiKey,
    prompt
  });

  return {
    answer: geminiResponse,
    sources,
    provider: "gemini"
  };
}

module.exports = {
  answer,
  createChunks,
  selectRelevantChunks,
  retrieveRelevantChunks,
  buildPrompt,
  callGeminiApi
};
