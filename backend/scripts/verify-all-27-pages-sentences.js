require("dotenv").config({ path: "backend/.env" });
const fs = require("fs");
const path = require("path");

function buildPageSentencesFromItems(items, pageNumber) {
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

  // Filter out standalone page number footer at the very bottom (y < 45 and pure number)
  const contentLines = lines.filter(line => {
    const lineText = line.items.map(it => it.str).join("").trim();
    if (line.y < 45 && /^\d+$/.test(lineText)) return false;
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
        sentences.push(finalizeSentence(curSent));
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
      sentences.push(finalizeSentence(curSent));
      curSent = { text: "", startSpanIdx: null, endSpanIdx: null, pageNumber };
    }

    line.items.forEach(it => {
      const itStr = it.str.trim();
      if (!itStr) return;

      if (curSent.startSpanIdx === null) {
        curSent.startSpanIdx = it.itemIdx;
      }
      curSent.endSpanIdx = it.itemIdx;

      // Check if item contains sentence terminator (. ! ?) followed by space, end, or quote
      const endsSentence = /[.!?](?:[\"\'\s]|$)/.test(itStr);
      const isAbbreviation = /\b(?:e\.g\.|i\.e\.|etc\.|vs\.|al\.)/i.test(itStr);

      if (endsSentence && !isAbbreviation) {
        curSent.text += (curSent.text ? " " : "") + itStr;
        sentences.push(finalizeSentence(curSent));
        curSent = { text: "", startSpanIdx: null, endSpanIdx: null, pageNumber };
      } else {
        curSent.text += (curSent.text ? " " : "") + itStr;
      }
    });
  });

  if (curSent.text && curSent.text.trim()) {
    sentences.push(finalizeSentence(curSent));
  }

  return sentences;
}

function finalizeSentence(s) {
  const cleanRaw = s.text.replace(/^[▪•\-\*]\s*/, "").replace(/\s+/g, " ").trim();
  return {
    raw: cleanRaw,
    spoken: cleanRaw,
    startSpanIdx: s.startSpanIdx,
    endSpanIdx: s.endSpanIdx,
    pageNumber: s.pageNumber
  };
}

async function verifyAll27() {
  const cloudStorage = require("../services/storage/cloud-storage");
  const tempPath = await cloudStorage.downloadToTemp("documents/89/1795266454444_2._Lecture_2__Intelligent_Agent_.pdf");
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(fs.readFileSync(tempPath));
  const pdfDoc = await pdfjsLib.getDocument({ data }).promise;

  let totalSentencesCount = 0;
  let pageErrors = 0;

  for (let p = 1; p <= pdfDoc.numPages; p++) {
    const page = await pdfDoc.getPage(p);
    const content = await page.getTextContent();
    const sentences = buildPageSentencesFromItems(content.items, p);

    let lastEndSpan = -1;
    sentences.forEach((s, i) => {
      totalSentencesCount++;
      if (s.startSpanIdx === null || s.endSpanIdx === null || s.startSpanIdx > s.endSpanIdx) {
        console.error(`ERROR on Page ${p} S${i}: Invalid span range [${s.startSpanIdx}..${s.endSpanIdx}]`);
        pageErrors++;
      }
      if (s.startSpanIdx < lastEndSpan) {
        // Overlap warning only if start is before previous start
      }
      lastEndSpan = s.endSpanIdx;
    });

    console.log(`Page ${p}: ${sentences.length} sentences extracted (items count: ${content.items.length}).`);
  }

  console.log(`\n============================================================`);
  console.log(`TOTAL SENTENCES EXTRACTED ACROSS ${pdfDoc.numPages} PAGES: ${totalSentencesCount}`);
  console.log(`PAGE ERRORS: ${pageErrors}`);
  console.log(`============================================================`);
  process.exit(pageErrors === 0 ? 0 : 1);
}

verifyAll27().catch(console.error);
