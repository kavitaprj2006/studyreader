/**
 * StudyReader Smart Academic Subject Classifier (Inference Engine)
 * Pure JavaScript zero-dependency ML inference engine powered by
 * trained TF-IDF vectorization and Logistic Regression weights.
 *
 * Runs in < 2ms without external Python runtime dependencies.
 */

const fs = require('fs');
const path = require('path');

// Curated standard English stopwords matching Python preprocessor
const STOPWORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are",
  "aren't", "as", "at", "be", "because", "been", "before", "being", "below", "between", "both",
  "but", "by", "can", "can't", "cannot", "could", "couldn't", "did", "didn't", "do", "does",
  "doesn't", "doing", "don't", "down", "during", "each", "few", "for", "from", "further", "had",
  "hadn't", "has", "hasn't", "have", "haven't", "having", "he", "he'd", "he'll", "he's", "her",
  "here", "here's", "hers", "herself", "him", "himself", "his", "how", "how's", "i", "i'd",
  "i'll", "i'm", "i've", "if", "in", "into", "is", "isn't", "it", "it's", "its", "itself",
  "let's", "me", "more", "most", "mustn't", "my", "myself", "no", "nor", "not", "of", "off",
  "on", "once", "only", "or", "other", "ought", "our", "ours", "ourselves", "out", "over",
  "own", "same", "shan't", "she", "she'd", "she'll", "she's", "should", "shouldn't", "so",
  "some", "such", "than", "that", "that's", "the", "their", "theirs", "them", "themselves",
  "then", "there", "there's", "these", "they", "they'd", "they'll", "they're", "they've",
  "this", "those", "through", "to", "too", "under", "until", "up", "very", "was", "wasn't",
  "we", "we'd", "we'll", "we're", "we've", "were", "weren't", "what", "what's", "when",
  "when's", "where", "where's", "which", "while", "who", "who's", "whom", "why", "why's",
  "with", "won't", "would", "wouldn't", "you", "you'd", "you'll", "you're", "you've", "your",
  "yours", "yourself", "yourselves"
]);

// Subject alias map to facilitate dynamic catalog matching across institutions
const SUBJECT_ALIASES = {
  "Database Management Systems": ["dbms", "database", "databases", "rdbms", "sql", "database systems"],
  "Data Structures & Algorithms": ["dsa", "data structures", "algorithms", "algo", "adsa"],
  "Operating Systems": ["os", "operating system", "systems programming", "kernel"],
  "Computer Networks": ["cn", "networking", "networks", "data communication", "computer network"],
  "Software Engineering": ["se", "software dev", "software development", "software design", "oose"],
  "Machine Learning & AI": ["ml", "ai", "machine learning", "artificial intelligence", "deep learning"],
  "Cloud Computing & DevOps": ["cloud", "devops", "cloud computing", "aws", "distributed systems"],
  "Discrete Mathematics": ["discrete math", "discrete structures", "dms", "discrete mathematical structures"],
  "Mathematics": ["math", "maths", "calculus", "linear algebra", "applied mathematics"],
  "Physics": ["phy", "applied physics", "engineering physics", "mechanics"],
  "Chemistry": ["chem", "applied chemistry", "engineering chemistry", "organic chemistry"],
  "Biology": ["bio", "biological science", "life sciences", "botany", "zoology"],
  "English Literature": ["english", "literature", "professional english", "technical english", "communication skills"],
  "History & Civics": ["history", "civics", "political science", "social studies", "sst"],
  "Economics": ["econ", "macroeconomics", "microeconomics", "managerial economics", "engineering economics"]
};

class SubjectClassifier {
  constructor() {
    this.bundle = null;
    this.isLoaded = false;
    this.confidenceThreshold = 0.35; // Calibrated for 15 classes (random is 0.067)
    this.loadBundle();
  }

  loadBundle() {
    try {
      const bundlePath = path.join(__dirname, 'model-bundle.json');
      if (fs.existsSync(bundlePath)) {
        const raw = fs.readFileSync(bundlePath, 'utf8');
        this.bundle = JSON.parse(raw);
        this.classes = this.bundle.classes;
        this.vocabulary = this.bundle.vocabulary;
        this.idf = this.bundle.idf;
        this.lrCoefficients = this.bundle.logistic_regression.coefficients;
        this.lrIntercept = this.bundle.logistic_regression.intercept;
        this.version = this.bundle.version || "1.0.0";
        this.isLoaded = true;
        console.log(`[ML SubjectClassifier] Successfully loaded model bundle v${this.version} (${this.classes.length} classes, ${Object.keys(this.vocabulary).length} features)`);
      } else {
        console.warn(`[ML SubjectClassifier] model-bundle.json not found at ${bundlePath}. Classification will default to unclassified.`);
      }
    } catch (err) {
      console.error(`[ML SubjectClassifier] Failed to load model bundle:`, err.message);
      this.isLoaded = false;
    }
  }

  cleanText(text) {
    if (!text || typeof text !== 'string') return '';
    const lowered = text.toLowerCase();
    const withoutUrls = lowered.replace(/https?:\/\/\S+|www\.\S+/g, ' ');
    const normalized = withoutUrls.replace(/[\-\_\/\\\,\.\:\;\(\)\[\]\{\}\"\'\`\<\>\=\+\*\?\!\@\#\$\%\^\&]/g, ' ');
    const tokens = normalized.split(/\s+/);
    const filtered = tokens.filter(t => t.length > 1 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
    return filtered.join(' ');
  }

  transformTfidf(cleanedText) {
    if (!this.isLoaded || !cleanedText) return null;
    const words = cleanedText.split(' ');
    if (words.length === 0) return null;

    const termCounts = new Map();

    // 1. Unigrams
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (this.vocabulary[w] !== undefined) {
        const idx = this.vocabulary[w];
        termCounts.set(idx, (termCounts.get(idx) || 0) + 1);
      }
    }

    // 2. Bigrams
    for (let i = 0; i < words.length - 1; i++) {
      const bg = `${words[i]} ${words[i + 1]}`;
      if (this.vocabulary[bg] !== undefined) {
        const idx = this.vocabulary[bg];
        termCounts.set(idx, (termCounts.get(idx) || 0) + 1);
      }
    }

    if (termCounts.size === 0) return null;

    // 3. Sublinear TF * IDF: (1 + ln(count)) * IDF
    const tfidfVec = new Map();
    let normSq = 0.0;
    for (const [idx, count] of termCounts.entries()) {
      const val = (1.0 + Math.log(count)) * this.idf[idx];
      tfidfVec.set(idx, val);
      normSq += val * val;
    }

    // 4. L2 Normalization
    const l2Norm = Math.sqrt(normSq);
    if (l2Norm > 0) {
      for (const [idx, val] of tfidfVec.entries()) {
        tfidfVec.set(idx, val / l2Norm);
      }
    }

    return tfidfVec;
  }

  predict(text) {
    if (!this.isLoaded) {
      return {
        predictedSubject: null,
        confidence: 0,
        status: "unclassified",
        modelVersion: "none",
        reason: "Model bundle not loaded"
      };
    }

    const cleaned = this.cleanText(text);
    const tfidfVec = this.transformTfidf(cleaned);

    if (!tfidfVec || tfidfVec.size === 0) {
      return {
        predictedSubject: null,
        confidence: 0,
        status: "unclassified",
        modelVersion: this.version,
        reason: "Insufficient academic vocabulary in document"
      };
    }

    // Compute Logistic Regression logits
    const logits = new Array(this.classes.length);
    for (let c = 0; c < this.classes.length; c++) {
      let z = this.lrIntercept[c];
      const weights = this.lrCoefficients[c];
      for (const [featIdx, val] of tfidfVec.entries()) {
        z += weights[featIdx] * val;
      }
      logits[c] = z;
    }

    // Softmax with numerical stabilization
    let maxLogit = -Infinity;
    for (let i = 0; i < logits.length; i++) {
      if (logits[i] > maxLogit) maxLogit = logits[i];
    }

    let sumExp = 0.0;
    const expLogits = new Array(logits.length);
    for (let i = 0; i < logits.length; i++) {
      const e = Math.exp(logits[i] - maxLogit);
      expLogits[i] = e;
      sumExp += e;
    }

    let bestIdx = 0;
    let bestProb = -1;
    for (let i = 0; i < expLogits.length; i++) {
      const prob = expLogits[i] / sumExp;
      if (prob > bestProb) {
        bestProb = prob;
        bestIdx = i;
      }
    }

    const predictedSubject = this.classes[bestIdx];
    const confidence = Math.round(bestProb * 10000) / 10000;
    const status = confidence >= this.confidenceThreshold ? "classified" : "needs_review";

    return {
      predictedSubject,
      confidence,
      status,
      modelVersion: this.version
    };
  }

  /**
   * Matches predicted canonical subject name against user's active subject catalog
   */
  matchUserSubject(predictedSubject, availableSubjects = []) {
    if (!predictedSubject || !Array.isArray(availableSubjects) || availableSubjects.length === 0) {
      return null;
    }

    const target = predictedSubject.toLowerCase().trim();
    const aliases = (SUBJECT_ALIASES[predictedSubject] || []).map(a => a.toLowerCase().trim());
    aliases.push(target);

    // 1. Direct exact or alias match
    for (const sub of availableSubjects) {
      const subName = (sub.name || '').toLowerCase().trim();
      const subCode = (sub.code || '').toLowerCase().trim();

      if (aliases.includes(subName) || aliases.includes(subCode)) {
        return sub;
      }
    }

    // 2. Substring inclusion match (e.g. "DBMS Lab" matches "Database Management Systems")
    for (const sub of availableSubjects) {
      const subName = (sub.name || '').toLowerCase().trim();
      for (const alias of aliases) {
        if (subName.includes(alias) || alias.includes(subName)) {
          return sub;
        }
      }
    }

    return null;
  }

  /**
   * Full end-to-end classification pipeline for a document
   * Handles text extraction input, prediction, dynamic matching, and safe error fallback
   */
  classifyDocument(fullText, availableSubjects = []) {
    try {
      if (!fullText || typeof fullText !== 'string' || fullText.trim().length < 20) {
        return {
          predictedSubject: null,
          matchedSubjectId: null,
          matchedSubjectName: null,
          confidence: 0,
          status: "unclassified",
          modelVersion: this.version || "1.0.0",
          source: "unclassified"
        };
      }

      // Use up to the first 12,000 characters of text (covers syllabus, title, abstract, chapter headings)
      const sampleText = fullText.slice(0, 12000);
      const prediction = this.predict(sampleText);

      if (!prediction.predictedSubject || prediction.status === "unclassified") {
        return {
          predictedSubject: null,
          matchedSubjectId: null,
          matchedSubjectName: null,
          confidence: prediction.confidence || 0,
          status: "unclassified",
          modelVersion: prediction.modelVersion || this.version || "1.0.0",
          source: "unclassified"
        };
      }

      // Match against user catalog
      const matched = this.matchUserSubject(prediction.predictedSubject, availableSubjects);

      return {
        predictedSubject: prediction.predictedSubject,
        matchedSubjectId: matched ? matched.id : null,
        matchedSubjectName: matched ? matched.name : null,
        confidence: prediction.confidence,
        status: matched && prediction.confidence >= this.confidenceThreshold ? "classified" : "needs_review",
        modelVersion: prediction.modelVersion,
        source: "ml_auto"
      };
    } catch (err) {
      console.error("[ML SubjectClassifier] Classification error (safe fallback):", err);
      return {
        predictedSubject: null,
        matchedSubjectId: null,
        matchedSubjectName: null,
        confidence: 0,
        status: "unclassified",
        modelVersion: this.version || "1.0.0",
        source: "unclassified",
        error: err.message
      };
    }
  }
}

// Export singleton instance
const subjectClassifier = new SubjectClassifier();
module.exports = {
  SubjectClassifier,
  subjectClassifier
};
