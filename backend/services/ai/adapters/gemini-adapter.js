/**
 * StudyReader — Gemini Provider Adapter
 *
 * Direct REST integration with Google Generative Language v1beta API.
 * Supports primary model with automatic sub-tier model failover (3.5-flash-lite -> 3.1-flash-lite -> 3-flash-preview).
 */

const DEFAULT_MODELS = [
  process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3-flash-preview"
];

function getApiKey() {
  return (process.env.GEMINI_API_KEY || "").trim();
}

/**
 * Executes a text generation request against Google Gemini.
 * @param {Object} params
 * @param {string} params.prompt
 * @param {string} [params.systemInstruction]
 * @param {number} [params.temperature=0.2]
 * @param {number} [params.maxOutputTokens=2048]
 * @param {number} [params.timeoutMs=20000]
 * @param {number} [params.modelIndex=0]
 */
async function generateText({
  prompt,
  systemInstruction = "",
  temperature = 0.2,
  maxOutputTokens = 2048,
  timeoutMs = 20000,
  modelIndex = 0
}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    const error = new Error("GEMINI_API_KEY is not configured.");
    error.status = 401;
    error.isRecoverable = false;
    throw error;
  }

  const model = DEFAULT_MODELS[modelIndex] || DEFAULT_MODELS[0];
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const requestBody = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      temperature,
      maxOutputTokens
    }
  };

  if (systemInstruction) {
    requestBody.systemInstruction = {
      parts: [{ text: systemInstruction }]
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    clearTimeout(timer);

    if (!response.ok) {
      const errText = await response.text();
      let parsedErr = {};
      try {
        parsedErr = JSON.parse(errText);
      } catch (_) {}

      const errorMsg = parsedErr.error?.message || errText.slice(0, 300) || `HTTP ${response.status}`;
      const error = new Error(`Gemini [${model}] failed (${response.status}): ${errorMsg}`);
      error.status = response.status;
      error.provider = "gemini";
      error.model = model;

      // 429 quota exhaustion or 503 high demand: try next Gemini model in list before giving up
      if ((response.status === 429 || response.status === 503 || response.status === 404) && modelIndex < DEFAULT_MODELS.length - 1) {
        console.warn(`[GeminiAdapter] Model ${model} returned ${response.status}. Falling back to next sub-tier: ${DEFAULT_MODELS[modelIndex + 1]}`);
        return generateText({
          prompt,
          systemInstruction,
          temperature,
          maxOutputTokens,
          timeoutMs,
          modelIndex: modelIndex + 1
        });
      }

      error.isRecoverable = response.status === 429 || response.status === 503 || response.status >= 500;
      throw error;
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text;

    if (!text || typeof text !== "string" || !text.trim()) {
      const finishReason = candidate?.finishReason || "UNKNOWN";
      const error = new Error(`Gemini [${model}] returned empty output (finishReason: ${finishReason})`);
      error.isRecoverable = true;
      error.provider = "gemini";
      error.model = model;
      throw error;
    }

    return {
      text: text.trim(),
      provider: "gemini",
      model,
      usage: data.usageMetadata || null
    };

  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      const error = new Error(`Gemini [${model}] request timed out after ${timeoutMs}ms`);
      error.status = 408;
      error.isRecoverable = true;
      error.provider = "gemini";
      error.model = model;
      throw error;
    }
    throw err;
  }
}

function isAvailable() {
  return Boolean(getApiKey());
}

module.exports = {
  name: "gemini",
  generateText,
  isAvailable
};
