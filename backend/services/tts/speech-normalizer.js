/**
 * StudyReader — Natural Speech & Formula Normalizer
 * Converts academic PDF text, equations, and expressions into fluid, natural human speech:
 * - Completely eliminates symbol artifacts: black squares, bullets, brackets, dots, icons
 * - Expands formulas naturally: addition, subtraction, multiplication, division, powers, roots
 */

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
  // List item e.g. "1. Introduction" -> "1: Introduction" (avoids "one dot introduction")
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

module.exports = {
  normalizeTextForSpeech
};
