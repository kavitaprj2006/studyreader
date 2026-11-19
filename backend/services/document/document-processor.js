/**
 * StudyReader — Unified Multi-Format Document Processing Pipeline
 *
 * Provides robust, page/slide/section-aware document text extraction,
 * semantic structuring, and HTML rendering for:
 * 1. PDF Documents (page-by-page extraction via pdfjs / officeparser)
 * 2. DOCX Documents (semantic HTML, headings, tables, lists via mammoth)
 * 3. PPTX Presentations (slide-by-slide XML parsing with slide numbers, titles, bullets, tables via jszip)
 */

const fs = require("fs");
const path = require("path");
const mammoth = require("mammoth");
const JSZip = require("jszip");

// Helper to decode XML entities
function decodeXmlEntities(str) {
  if (!str || typeof str !== "string") return "";
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// Clean and normalize text
function cleanText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Parses PPTX slide XML into structured slide data
 */
function parsePptxSlideXml(xmlContent, slideNumber) {
  const slide = {
    slideNumber,
    title: "",
    text: "",
    bullets: [],
    tables: [],
    html: ""
  };

  try {
    // 1. Identify slide title
    // Check for title shape (<p:ph type="title"/> or <p:ph type="ctrTitle"/>)
    const titleShapeRegex = /<p:sp\b[^>]*>[\s\S]*?<p:ph\b[^>]*type=["'](?:title|ctrTitle)["'][\s\S]*?<\/p:sp>/gi;
    let titleMatch = titleShapeRegex.exec(xmlContent);

    if (titleMatch) {
      const titleTextRuns = [...titleMatch[0].matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/gi)];
      slide.title = decodeXmlEntities(titleTextRuns.map(m => m[1]).join("")).trim();
    }

    // 2. Extract tables
    const tableRegex = /<a:tbl\b[^>]*>([\s\S]*?)<\/a:tbl>/gi;
    let tblMatch;
    const tableHtmlParts = [];
    while ((tblMatch = tableRegex.exec(xmlContent)) !== null) {
      const tableXml = tblMatch[1];
      const rowRegex = /<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/gi;
      const rows = [];
      let rowMatch;
      while ((rowMatch = rowRegex.exec(tableXml)) !== null) {
        const rowXml = rowMatch[1];
        const cellRegex = /<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/gi;
        const cells = [];
        let cellMatch;
        while ((cellMatch = cellRegex.exec(rowXml)) !== null) {
          const textRuns = [...cellMatch[1].matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/gi)];
          cells.push(decodeXmlEntities(textRuns.map(m => m[1]).join("")).trim());
        }
        if (cells.some(c => c.length > 0)) {
          rows.push(cells);
        }
      }
      if (rows.length > 0) {
        slide.tables.push(rows);
        let tHtml = '<table class="pptx-table" style="width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; border: 1px solid #e2e8f0;">';
        rows.forEach((row, rIdx) => {
          tHtml += `<tr style="${rIdx === 0 ? 'background: #f1f5f9; font-weight: 700;' : ''}">`;
          row.forEach(cell => {
            const tag = rIdx === 0 ? 'th' : 'td';
            tHtml += `<${tag} style="padding: 8px 12px; border: 1px solid #e2e8f0; text-align: left;">${cell || '&nbsp;'}</${tag}>`;
          });
          tHtml += '</tr>';
        });
        tHtml += '</table>';
        tableHtmlParts.push(tHtml);
      }
    }

    // 3. Extract all paragraphs and text runs
    const paragraphRegex = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/gi;
    const paragraphs = [];
    let pMatch;
    while ((pMatch = paragraphRegex.exec(xmlContent)) !== null) {
      const pXml = pMatch[1];
      const textRuns = [...pXml.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/gi)];
      const pText = decodeXmlEntities(textRuns.map(m => m[1]).join("")).trim();
      if (pText) {
        paragraphs.push(pText);
      }
    }

    // If title was not found via placeholder, use the first short paragraph
    if (!slide.title && paragraphs.length > 0 && paragraphs[0].length < 120) {
      slide.title = paragraphs[0];
    } else if (!slide.title) {
      slide.title = `Slide ${slideNumber}`;
    }

    // Filter out title from body paragraphs
    const bodyParagraphs = paragraphs.filter(p => p !== slide.title);
    slide.bullets = bodyParagraphs;

    // Build plain text for AI chunking and RAG
    const textParts = [];
    if (slide.title && slide.title !== `Slide ${slideNumber}`) {
      textParts.push(`Slide Title: ${slide.title}`);
    }
    if (bodyParagraphs.length > 0) {
      textParts.push(bodyParagraphs.join("\n"));
    }
    if (slide.tables.length > 0) {
      slide.tables.forEach(table => {
        textParts.push(table.map(row => row.join(" | ")).join("\n"));
      });
    }
    slide.text = textParts.join("\n\n").trim();

    // Build HTML representation for viewer
    let slideHtml = `<div class="pptx-slide-card" data-slide="${slideNumber}" style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">`;
    slideHtml += `<div class="pptx-slide-header" style="display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #e0e7ff; padding-bottom: 12px; margin-bottom: 16px;">`;
    slideHtml += `<h3 style="font-size: 17px; font-weight: 700; color: #1e293b; margin: 0;">${escapeHtml(slide.title)}</h3>`;
    slideHtml += `<span class="slide-badge" style="background: #e0e7ff; color: #4338ca; font-weight: 700; font-size: 12px; padding: 4px 10px; border-radius: 9999px;">Slide ${slideNumber}</span>`;
    slideHtml += `</div>`;

    if (bodyParagraphs.length > 0) {
      slideHtml += `<ul class="pptx-bullet-list" style="margin: 0 0 16px 20px; padding: 0; line-height: 1.6; font-size: 14px; color: #334155;">`;
      bodyParagraphs.forEach(b => {
        slideHtml += `<li style="margin-bottom: 8px;">${escapeHtml(b)}</li>`;
      });
      slideHtml += `</ul>`;
    }

    if (tableHtmlParts.length > 0) {
      slideHtml += tableHtmlParts.join("\n");
    }

    if (bodyParagraphs.length === 0 && tableHtmlParts.length === 0) {
      slideHtml += `<p style="color: #94a3b8; font-style: italic; font-size: 13px;">(Visual or graphic content slide)</p>`;
    }

    slideHtml += `</div>`;
    slide.html = slideHtml;

  } catch (err) {
    console.warn(`[DocumentProcessor] Error parsing slide ${slideNumber}:`, err.message);
    slide.title = `Slide ${slideNumber}`;
    slide.text = `Slide ${slideNumber}`;
    slide.html = `<div class="pptx-slide-card" data-slide="${slideNumber}"><p>Slide ${slideNumber}</p></div>`;
  }

  return slide;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Unified Document Processor class
 */
class DocumentProcessor {
  /**
   * Main extraction entrypoint. Detects format and routes to appropriate extractor.
   * @param {string} filePath - Absolute or relative path to file on disk.
   * @param {string} [originalFilename=""] - Original uploaded filename.
   * @returns {Promise<{ fileType: string, title: string, pageCount: number, sections: Array, fullText: string, formattedHtml: string }>}
   */
  async extractDocument(filePath, originalFilename = "") {
    const ext = path.extname(originalFilename || filePath).toLowerCase();
    const filename = path.basename(originalFilename || filePath);

    if (ext === ".docx") {
      return this.extractDocx(filePath, filename);
    } else if (ext === ".pptx") {
      return this.extractPptx(filePath, filename);
    } else if (ext === ".pdf") {
      return this.extractPdf(filePath, filename);
    } else {
      throw new Error(`Unsupported document format '${ext}'. StudyReader supports PDF, DOCX, and PPTX.`);
    }
  }

  /**
   * Robust DOCX extractor using Mammoth.
   * Extracts semantic HTML, headings, tables, bullet lists, and section boundaries.
   */
  async extractDocx(filePath, originalFilename) {
    try {
      const buffer = fs.readFileSync(filePath);

      // 1. Generate semantic HTML
      const htmlResult = await mammoth.convertToHtml({ buffer }, {
        styleMap: [
          "p[style-name='Heading 1'] => h1:fresh",
          "p[style-name='Heading 2'] => h2:fresh",
          "p[style-name='Heading 3'] => h3:fresh",
          "p[style-name='Title'] => h1:fresh",
          "p[style-name='Subtitle'] => h2:fresh"
        ]
      });

      // 2. Extract raw text
      const textResult = await mammoth.extractRawText({ buffer });
      const rawText = cleanText(textResult.value);
      const rawHtml = htmlResult.value || "";

      // 3. Segment into logical sections based on headings (h1, h2, h3) or paragraphs
      const sections = [];
      const headingSplitRegex = /<(h[1-3])[^>]*>([\s\S]*?)<\/\1>/gi;
      let lastIndex = 0;
      let sectionIndex = 1;
      let match;

      const headingMatches = [];
      while ((match = headingSplitRegex.exec(rawHtml)) !== null) {
        headingMatches.push({
          index: match.index,
          endIndex: headingSplitRegex.lastIndex,
          tag: match[1],
          title: cleanText(decodeXmlEntities(match[2].replace(/<[^>]+>/g, "")))
        });
      }

      if (headingMatches.length > 0) {
        for (let i = 0; i < headingMatches.length; i++) {
          const current = headingMatches[i];
          const next = headingMatches[i + 1];
          const sectionHtmlChunk = rawHtml.substring(current.index, next ? next.index : rawHtml.length);
          const plainTextChunk = cleanText(decodeXmlEntities(sectionHtmlChunk.replace(/<[^>]+>/g, " ")));

          if (plainTextChunk) {
            sections.push({
              sectionNumber: sectionIndex++,
              title: current.title || `Section ${sectionIndex - 1}`,
              text: plainTextChunk,
              html: sectionHtmlChunk
            });
          }
        }
      } else {
        // Fallback: split by paragraph blocks if no headings exist
        const paragraphs = rawHtml.split(/<\/p>/i)
          .map(p => p.replace(/<p[^>]*>/i, "").trim())
          .filter(p => p.length > 0);

        const groupSize = 4; // group 4 paragraphs per section
        for (let i = 0; i < paragraphs.length; i += groupSize) {
          const group = paragraphs.slice(i, i + groupSize);
          const groupHtml = group.map(p => `<p>${p}</p>`).join("");
          const plainText = cleanText(decodeXmlEntities(group.join(" ").replace(/<[^>]+>/g, " ")));

          if (plainText) {
            sections.push({
              sectionNumber: sectionIndex++,
              title: `Section ${sectionIndex - 1}`,
              text: plainText,
              html: groupHtml
            });
          }
        }
      }

      // If document was completely empty
      if (sections.length === 0) {
        const fallbackText = rawText || originalFilename;
        sections.push({
          sectionNumber: 1,
          title: "Document Content",
          text: fallbackText,
          html: `<p>${escapeHtml(fallbackText)}</p>`
        });
      }

      // Build styled viewer HTML
      let formattedHtml = `<div class="docx-study-document" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.7; color: #1e293b; max-width: 860px; margin: 0 auto; padding: 24px;">`;
      formattedHtml += `<div class="docx-doc-header" style="border-bottom: 2px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 28px;">`;
      formattedHtml += `<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">`;
      formattedHtml += `<span style="background: #eff6ff; color: #2563eb; font-weight: 700; font-size: 11px; padding: 4px 8px; border-radius: 4px; border: 1px solid #bfdbfe;">DOCX DOCUMENT</span>`;
      formattedHtml += `<span style="font-size: 12px; color: #64748b;">${sections.length} Section${sections.length === 1 ? '' : 's'}</span>`;
      formattedHtml += `</div>`;
      formattedHtml += `<h1 style="font-size: 24px; font-weight: 800; color: #0f172a; margin: 0;">${escapeHtml(originalFilename.replace(/\.docx$/i, ''))}</h1>`;
      formattedHtml += `</div>`;

      // Render each section with a clear visual section boundary
      sections.forEach(sec => {
        formattedHtml += `<section class="docx-section-block" data-section="${sec.sectionNumber}" style="margin-bottom: 32px; padding-bottom: 24px; border-bottom: 1px dashed #e2e8f0;">`;
        formattedHtml += `<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px;">`;
        formattedHtml += `<span style="background: #f1f5f9; color: #475569; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 4px;">Section ${sec.sectionNumber}</span>`;
        formattedHtml += `</div>`;
        formattedHtml += `<div class="docx-section-content" style="font-size: 15px;">${sec.html}</div>`;
        formattedHtml += `</section>`;
      });
      formattedHtml += `</div>`;

      return {
        fileType: "docx",
        title: originalFilename,
        pageCount: sections.length,
        sections,
        fullText: rawText,
        formattedHtml
      };

    } catch (err) {
      console.error(`[DocumentProcessor] DOCX extraction failed for ${originalFilename}:`, err);
      throw new Error(`Unable to extract text from DOCX file: ${err.message}`);
    }
  }

  /**
   * Robust PPTX extractor using JSZip.
   * Extracts slide XMLs in natural order, preserving slide numbers, titles, bullet points, and tables.
   */
  async extractPptx(filePath, originalFilename) {
    try {
      const buffer = fs.readFileSync(filePath);
      const zip = await JSZip.loadAsync(buffer);

      // Locate all slide XML entries and sort numerically (slide1, slide2, ..., slide10)
      const slideFileNames = Object.keys(zip.files)
        .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
        .sort((a, b) => {
          const matchA = a.match(/slide(\d+)\.xml/i);
          const matchB = b.match(/slide(\d+)\.xml/i);
          const numA = matchA ? parseInt(matchA[1], 10) : 0;
          const numB = matchB ? parseInt(matchB[1], 10) : 0;
          return numA - numB;
        });

      if (slideFileNames.length === 0) {
        throw new Error("No slide files found in PPTX presentation.");
      }

      const sections = [];
      for (let i = 0; i < slideFileNames.length; i++) {
        const slidePath = slideFileNames[i];
        const slideNumber = i + 1;
        const xml = await zip.files[slidePath].async("string");
        const parsedSlide = parsePptxSlideXml(xml, slideNumber);
        sections.push(parsedSlide);
      }

      const fullText = sections.map(s => `[Slide ${s.slideNumber}: ${s.title}]\n${s.text}`).join("\n\n");

      // Build structured PPTX viewer HTML
      let formattedHtml = `<div class="pptx-study-presentation" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 860px; margin: 0 auto; padding: 24px;">`;
      formattedHtml += `<div class="pptx-deck-header" style="border-bottom: 2px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 28px;">`;
      formattedHtml += `<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">`;
      formattedHtml += `<span style="background: #fff7ed; color: #ea580c; font-weight: 700; font-size: 11px; padding: 4px 8px; border-radius: 4px; border: 1px solid #ffedd5;">PPTX PRESENTATION</span>`;
      formattedHtml += `<span style="font-size: 12px; color: #64748b;">${sections.length} Slides</span>`;
      formattedHtml += `</div>`;
      formattedHtml += `<h1 style="font-size: 24px; font-weight: 800; color: #0f172a; margin: 0;">${escapeHtml(originalFilename.replace(/\.pptx$/i, ''))}</h1>`;
      formattedHtml += `</div>`;

      // Append each slide card
      sections.forEach(slide => {
        formattedHtml += slide.html;
      });
      formattedHtml += `</div>`;

      return {
        fileType: "pptx",
        title: originalFilename,
        pageCount: sections.length,
        sections,
        fullText,
        formattedHtml
      };

    } catch (err) {
      console.error(`[DocumentProcessor] PPTX extraction failed for ${originalFilename}:`, err);
      throw new Error(`Unable to extract slides from PPTX file: ${err.message}`);
    }
  }

  /**
   * PDF extractor retaining page-based structure.
   */
  async extractPdf(filePath, originalFilename) {
    try {
      const officeParser = require("officeparser");
      const ast = await officeParser.parseOffice(filePath);
      const sections = [];

      if (ast && Array.isArray(ast.content) && ast.content.length > 0) {
        ast.content.forEach((node, idx) => {
          const text = cleanText(node.text);
          if (text) {
            const pageNum = Number(node.metadata?.pageNumber) || (idx + 1);
            sections.push({
              pageNumber: pageNum,
              text,
              title: `Page ${pageNum}`
            });
          }
        });
      }

      if (sections.length === 0 && ast) {
        const parsed = await ast.to("text");
        const fallbackText = cleanText(parsed?.value);
        if (fallbackText) {
          sections.push({
            pageNumber: 1,
            text: fallbackText,
            title: "Page 1"
          });
        }
      }

      const fullText = sections.map(s => s.text).join("\n\n");

      return {
        fileType: "pdf",
        title: originalFilename,
        pageCount: sections.length > 0 ? sections.length : 1,
        sections,
        fullText,
        formattedHtml: "" // PDFs are rendered via PDF.js canvas
      };

    } catch (err) {
      console.error(`[DocumentProcessor] PDF extraction failed for ${originalFilename}:`, err);
      throw new Error(`Unable to extract text from PDF: ${err.message}`);
    }
  }

  /**
   * Normalizes document sections into standard page chunks for RAG/embedding indexing.
   * Directly compatible with createChunks(pages).
   */
  toPageChunks(extracted) {
    if (!extracted || !Array.isArray(extracted.sections)) {
      return [{ text: extracted?.fullText || "Document Content" }];
    }

    return extracted.sections.map(sec => ({
      pageNumber: sec.pageNumber || null,
      slideNumber: sec.slideNumber || null,
      sectionNumber: sec.sectionNumber || null,
      text: sec.text
    }));
  }
}

module.exports = new DocumentProcessor();
