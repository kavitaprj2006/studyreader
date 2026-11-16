/**
 * StudyReader — Document Text Normalization & Preprocessing Utilities
 * 
 * Provides text cleaning and structural analysis for academic documents.
 * Note: Hardcoded mock AI answers have been removed in favor of direct
 * Google Gemini 2.5 Flash API grounding.
 */

/* ============================================================
   1. DOCUMENT PREPROCESSING & NORMALIZATION
   ============================================================ */

function cleanDocumentText(rawText) {
  if (!rawText) return "";
  let text = String(rawText).replace(/\r\n/g, "\n");

  // Fix common OCR / PDF extraction artifacts
  text = text.replace(/([a-z])([A-Z])/g, "$1 $2"); // camelCase artifacts
  text = text.replace(/([a-z])- \n([a-z])/gi, "$1$2"); // hyphenated line breaks
  text = text.replace(/[ \t]+/g, " ");

  return text.trim();
}

function parseDocumentStructure(cleanedText) {
  const lines = cleanedText.split("\n").map((l) => l.trim()).filter(Boolean);

  let documentTitle = "";
  const sections = [];
  let currentSection = { title: "Introduction", content: [] };

  // Detect likely document title from first few lines
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const line = lines[i];
    if (/^[A-Z0-9\s\-:]{4,60}$/.test(line) && !line.includes("Page") && !/^\d+$/.test(line)) {
      documentTitle = line;
      break;
    }
  }
  if (!documentTitle && lines.length > 0) {
    documentTitle = lines[0].slice(0, 60);
  }

  // Detect sections & headings
  lines.forEach((line) => {
    const isHeading =
      /^[A-Z0-9\s\-:?]{4,60}$/.test(line) &&
      !line.endsWith(".") &&
      !line.startsWith("-") &&
      !line.startsWith("•") &&
      !/^\d+$/.test(line);

    if (isHeading && currentSection.content.length > 0) {
      sections.push({
        title: currentSection.title,
        text: currentSection.content.join(" ")
      });
      currentSection = { title: line, content: [] };
    } else {
      currentSection.content.push(line);
    }
  });

  if (currentSection.content.length > 0) {
    sections.push({
      title: currentSection.title,
      text: currentSection.content.join(" ")
    });
  }

  // Extract explicit bullet points and definitions
  const bulletItems = [];
  const definedTerms = new Map();

  lines.forEach((line) => {
    if (/^[-*•]\s+(.+)/.test(line)) {
      bulletItems.push(line.replace(/^[-*•]\s+/, "").trim());
    }

    const termMatch = line.match(/^[-*•]?\s*([A-Z][A-Za-z0-9\s]{2,30})\s*[:\-]\s*(.+)/);
    if (termMatch) {
      const termKey = termMatch[1].trim().toLowerCase();
      const def = termMatch[2].trim();
      if (!definedTerms.has(termKey) && def.length > 10) {
        definedTerms.set(termKey, { term: termMatch[1].trim(), definition: def });
      }
    }
  });

  return {
    documentTitle,
    sections,
    bulletItems,
    definedTerms,
    fullText: cleanedText
  };
}

/* ============================================================
   2. HEURISTIC FALLBACK GUARD
   ============================================================ */

function generateAcademicTeachingResponse({ mode, question = "", text = "", history = [] }) {
  throw new Error(
    "Local mock response generator has been disabled. All answers must be generated using Google Gemini API to ensure genuine document grounding."
  );
}

module.exports = {
  cleanDocumentText,
  parseDocumentStructure,
  generateAcademicTeachingResponse
};
