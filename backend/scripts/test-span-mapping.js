const assert = require('assert');

/**
 * Finds the exact contiguous span range [startIdx, endIdx] in textLayer spans
 * matching a target sentence text.
 */
function findContiguousSpanRange(spans, targetSentence) {
  if (!spans || spans.length === 0 || !targetSentence || !targetSentence.trim()) {
    return null;
  }

  // Normalize target sentence into non-empty tokens
  const targetTokens = targetSentence
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (targetTokens.length === 0) return null;

  // Build token stream from spans, preserving span index for each token
  const spanTokens = [];
  spans.forEach((span, spanIdx) => {
    const text = (span.textContent || "")
      .toLowerCase()
      .replace(/[^\w\s]/g, " ");
    const words = text.split(/\s+/).filter(Boolean);
    words.forEach(word => {
      spanTokens.push({ word, spanIdx });
    });
  });

  if (spanTokens.length === 0) return null;

  // Find the start position in spanTokens that best matches targetTokens sequentially
  let bestMatch = null;
  let maxScore = 0;

  // Look for match using the first 2-3 tokens of the sentence
  const anchorTokens = targetTokens.slice(0, Math.min(3, targetTokens.length));

  for (let i = 0; i < spanTokens.length; i++) {
    // Check if anchor matches
    let matchesAnchor = false;
    if (spanTokens[i].word === anchorTokens[0]) {
      matchesAnchor = true;
      for (let a = 1; a < anchorTokens.length && (i + a) < spanTokens.length; a++) {
        if (spanTokens[i + a].word !== anchorTokens[a]) {
          matchesAnchor = false;
          break;
        }
      }
    }

    if (matchesAnchor) {
      // Score how many consecutive target tokens match from this position
      let matchCount = 0;
      let spanTokenIdx = i;
      let targetIdx = 0;

      while (targetIdx < targetTokens.length && spanTokenIdx < spanTokens.length) {
        if (spanTokens[spanTokenIdx].word === targetTokens[targetIdx]) {
          matchCount++;
          targetIdx++;
          spanTokenIdx++;
        } else {
          // If a small punctuation/hyphen difference skipped a token, allow sliding up to 1 token
          if (spanTokenIdx + 1 < spanTokens.length && spanTokens[spanTokenIdx + 1].word === targetTokens[targetIdx]) {
            spanTokenIdx++;
          } else {
            targetIdx++;
          }
        }
      }

      if (matchCount > maxScore) {
        maxScore = matchCount;
        const startSpanIdx = spanTokens[i].spanIdx;
        const endSpanIdx = spanTokens[Math.min(spanTokens.length - 1, spanTokenIdx - 1)].spanIdx;
        bestMatch = { startSpanIdx, endSpanIdx, score: matchCount };
      }
    }
  }

  // Fallback: If strict anchor match failed, do sliding window match
  if (!bestMatch || maxScore < Math.min(3, targetTokens.length)) {
    const firstWord = targetTokens[0];
    for (let i = 0; i < spanTokens.length; i++) {
      if (spanTokens[i].word === firstWord || spanTokens[i].word.startsWith(firstWord.slice(0, 4))) {
        const startSpanIdx = spanTokens[i].spanIdx;
        let endSpanIdx = startSpanIdx;
        let t = 0;
        let s = i;
        while (t < targetTokens.length && s < spanTokens.length) {
          if (spanTokens[s].word.includes(targetTokens[t]) || targetTokens[t].includes(spanTokens[s].word)) {
            endSpanIdx = spanTokens[s].spanIdx;
            t++;
          }
          s++;
        }
        bestMatch = { startSpanIdx, endSpanIdx };
        break;
      }
    }
  }

  return bestMatch;
}

// SIMULATE Page 3 from "2. Lecture 2 (Intelligent Agent).pdf":
// Top heading: "AGENT (CONTD.)"
// Diagram items: "Environment", "Sensors", "Actuators"
// Paragraph 1: "Sensor: Sensor is a device which detects the change in the environment and sends the information to other electronic devices."
// Paragraph 2: "An agent observes its environment through sensors."
const mockPage3Spans = [
  { textContent: "AGENT (CONTD.)" }, // span 0: Heading with words "agent"
  { textContent: "Environment" },    // span 1: Diagram with "environment"
  { textContent: "Sensors" },        // span 2: Diagram with "sensors"
  { textContent: "Actuators" },      // span 3: Diagram
  { textContent: "• Sensor: " },     // span 4: Start of sentence 1
  { textContent: "Sensor is a device which detects " }, // span 5
  { textContent: "the change in the environment " },    // span 6
  { textContent: "and sends the information " },        // span 7
  { textContent: "to other electronic devices." },      // span 8: End of sentence 1
  { textContent: "• Actuators: " },  // span 9: Sentence 2
  { textContent: "Actuators are the component " },     // span 10
  { textContent: "of machines that converts energy into motion." } // span 11
];

console.log("==================================================");
console.log("TESTING CONTIGUOUS SPAN MAPPING ON PDF TEXT LAYER");
console.log("==================================================");

// Target sentence 1: "Sensor: Sensor is a device which detects the change in the environment and sends the information to other electronic devices."
const targetSent1 = "Sensor: Sensor is a device which detects the change in the environment and sends the information to other electronic devices.";
const match1 = findContiguousSpanRange(mockPage3Spans, targetSent1);

console.log("Match 1 Result:", match1);
assert(match1 !== null, "Must find match for sentence 1");
assert(match1.startSpanIdx === 4, `startSpanIdx should be 4, got ${match1.startSpanIdx}`);
assert(match1.endSpanIdx === 8, `endSpanIdx should be 8, got ${match1.endSpanIdx}`);

// Verify that Heading (span 0) and Diagram (spans 1, 2) are NOT in the range!
assert(match1.startSpanIdx > 0, "Heading span 0 must NOT be in highlight range!");
assert(match1.startSpanIdx > 2, "Diagram spans 1, 2 must NOT be in highlight range!");
assert(match1.endSpanIdx < 9, "Next bullet span 9 must NOT be in highlight range!");
console.log("✔ Test 1 PASSED: Only spans 4 through 8 highlighted. Heading and diagram completely excluded!");

// Target sentence 2: "Actuators are the component of machines that converts energy into motion."
const targetSent2 = "Actuators: Actuators are the component of machines that converts energy into motion.";
const match2 = findContiguousSpanRange(mockPage3Spans, targetSent2);
console.log("Match 2 Result:", match2);
assert(match2.startSpanIdx === 9, `startSpanIdx should be 9, got ${match2.startSpanIdx}`);
assert(match2.endSpanIdx === 11, `endSpanIdx should be 11, got ${match2.endSpanIdx}`);
console.log("✔ Test 2 PASSED: Only spans 9 through 11 highlighted. No overlap with sentence 1 or diagram!");

console.log("\nALL HIGHLIGHTING SPAN MAPPING TESTS PASSED 100%!");
