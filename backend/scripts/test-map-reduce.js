require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const fs = require("fs");
const path = require("path");
const officeParser = require("officeparser");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

if (!GEMINI_API_KEY) {
  console.error("Missing GEMINI_API_KEY");
  process.exit(1);
}

async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY.trim()
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 2048 }
    })
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini error ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
}

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

async function run() {
  const pdfPath = path.join(__dirname, "../uploads/1794814236729-781165567.pdf");
  console.log("1. Parsing 60-page PDF:", pdfPath);
  const ast = await officeParser.parseOffice(pdfPath);
  const readablePages = [];
  ast.content.forEach((node, idx) => {
    const text = String(node.text || "").trim();
    if (text) {
      readablePages.push({
        pageNumber: Number(node.metadata?.pageNumber) || (idx + 1),
        text
      });
    }
  });
  console.log(`Extracted ${readablePages.length} readable pages (first: ${readablePages[0].pageNumber}, last: ${readablePages[readablePages.length - 1].pageNumber})`);

  // Batching
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
  if (currentBatch.length > 0) batches.push(currentBatch);

  console.log(`Divided into ${batches.length} sequential batches:`);
  batches.forEach((b, i) => {
    console.log(`  Batch ${i + 1}: Pages ${b[0].pageNumber} to ${b[b.length - 1].pageNumber} (${b.length} pages, ${b.reduce((acc, p) => acc + p.text.length, 0)} chars)`);
  });

  // Map Phase
  console.log("\n2. Executing Map Phase (concurrency: 3)...");
  const t0 = Date.now();
  const batchDigests = await mapConcurrent(batches, async (batch, i) => {
    const startPage = batch[0].pageNumber;
    const endPage = batch[batch.length - 1].pageNumber;
    const range = startPage === endPage ? `Page ${startPage}` : `Pages ${startPage}–${endPage}`;
    const batchText = batch.map((p) => `[Page ${p.pageNumber}]\n${p.text}`).join("\n\n");

    const prompt = `You are an academic researcher creating an accurate, high-density factual digest of a textbook section.
Coverage: ${range} of ${readablePages.length} total pages.

Document Section Excerpts:
${batchText}

Task:
Synthesize a concise, factually dense academic digest of this specific section (${range}).
Requirements:
1. Cover all core concepts, definitions, formal models, algorithms, or theorems introduced in these pages.
2. Label specific concepts with their exact page citation from the excerpt header, e.g. [Page ${startPage}].
3. If formulas, inference rules, comparisons, or architectures appear, include their exact formulations.
4. Keep the digest concise and high-yield (approx 200–350 words).
5. Output ONLY the factual digest. Do NOT include greetings, preambles, or conversational filler.`;

    const digest = await callGemini(prompt);
    console.log(`  Completed Batch ${i + 1} (${range}): ${digest.length} chars`);
    return { range, startPage, endPage, digest };
  }, 3);

  const mapTime = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`Map Phase completed in ${mapTime}s.`);

  const combinedDigest = batchDigests
    .map((b) => `=== Section (${b.range}) ===\n${b.digest}`)
    .join("\n\n");

  // Reduce Phase: Quick 3-bullet summary
  console.log("\n3. Executing Reduce Phase: Quick (3-Bullet)...");
  const quickPrompt = `You are an academic tutor preparing an executive 3-bullet summary of a complete academic document containing ${readablePages.length} pages.
You must synthesize the full scope from the intermediate section digests below, ensuring the beginning, middle, and end of the document are all represented.

Intermediate Section Digests Across Entire Document (Pages 1 to ${readablePages.length}):
${combinedDigest}

CRITICAL CONSTRAINTS:
1. Output EXACTLY 3 bullet points, each starting with '* '.
2. Do NOT output any title, introductory greetings, preamble, or concluding remarks.
3. Distribution:
   - Bullet 1 must capture the foundational concepts, definitions, and motivations from the beginning of the document (cites initial pages, e.g. [Pages 1–15]).
   - Bullet 2 must capture the core mechanisms, methods, formal rules, or frameworks from the middle of the document (cites middle pages).
   - Bullet 3 must capture the advanced applications, theorems, conclusions, and synthesis from the final sections of the document (cites final pages up to [Page ${readablePages.length}]).
4. Each bullet must be dense, clear, academically precise, and include accurate bracketed page citations based strictly on the section digests.`;

  const t1 = Date.now();
  const quickResult = await callGemini(quickPrompt);
  const quickTime = ((Date.now() - t1) / 1000).toFixed(1);
  console.log(`Quick Summary generated in ${quickTime}s:\n`);
  console.log(quickResult);

  // Reduce Phase: Exam Sheet
  console.log("\n4. Executing Reduce Phase: Exam Sheet...");
  const examPrompt = `You are an academic professor preparing a high-yield exam revision sheet of a complete academic document across all ${readablePages.length} pages.
Synthesize the intermediate section digests below into an actionable revision sheet.

Intermediate Section Digests Across Entire Document (Pages 1 to ${readablePages.length}):
${combinedDigest}

CRITICAL SUBJECT-ADAPTIVE RULES:
1. Adapt the structure strictly to the subject matter of the document. Ground all questions and revision points strictly in the source material across all sections (Pages 1 to ${readablePages.length}).
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

  const t2 = Date.now();
  const examResult = await callGemini(examPrompt);
  const examTime = ((Date.now() - t2) / 1000).toFixed(1);
  console.log(`Exam Sheet generated in ${examTime}s:\n`);
  console.log(examResult.slice(0, 1000) + "\n...[truncated for display]...");

  console.log("\n--- TEST COMPLETED SUCCESSFULLY ---");
}

run().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
