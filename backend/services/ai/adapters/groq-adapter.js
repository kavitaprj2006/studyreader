/**
 * StudyReader — Groq Provider Adapter
 *
 * High-speed LPU inference via Groq's OpenAI-compatible REST endpoint.
 * Supports dual-tier model failover:
 * 1. openai/gpt-oss-120b (Primary Groq: high-capacity reasoning & academic synthesis)
 * 2. openai/gpt-oss-20b (Secondary Groq: fast throughput failover)
 */

const GROQ_MODELS = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b"
];

function getApiKey() {
  return (process.env.GROQ_API_KEY || "").trim();
}

/**
 * Executes a text generation request against Groq.
 * @param {Object} params
 * @param {string} params.prompt
 * @param {string} [params.systemInstruction]
 * @param {number} [params.temperature=0.2]
 * @param {number} [params.maxOutputTokens=2048]
 * @param {number} [params.timeoutMs=15000]
 * @param {number} [params.modelIndex=0]
 */
async function generateText({
  prompt,
  systemInstruction = "",
  temperature = 0.2,
  maxOutputTokens = 2048,
  timeoutMs = 15000,
  modelIndex = 0
}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    const error = new Error("GROQ_API_KEY is not configured.");
    error.status = 401;
    error.isRecoverable = false;
    error.provider = "groq";
    throw error;
  }

  const model = GROQ_MODELS[modelIndex] || GROQ_MODELS[0];
  const url = "https://api.groq.com/openai/v1/chat/completions";

  const messages = [];
  if (systemInstruction) {
    messages.push({ role: "system", content: systemInstruction });
  }
  messages.push({ role: "user", content: prompt });

  const requestBody = {
    model,
    messages,
    temperature,
    max_tokens: maxOutputTokens
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
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
      const error = new Error(`Groq [${model}] failed (${response.status}): ${errorMsg}`);
      error.status = response.status;
      error.provider = "groq";
      error.model = model;

      // Failover to secondary Groq model if primary model fails (rate limit, overload, API error)
      if (modelIndex < GROQ_MODELS.length - 1) {
        console.warn(`[GroqAdapter] Model ${model} returned ${response.status}. Falling back to ${GROQ_MODELS[modelIndex + 1]}`);
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
    const text = data.choices?.[0]?.message?.content;

    if (!text || typeof text !== "string" || !text.trim()) {
      const error = new Error(`Groq [${model}] returned empty output.`);
      error.isRecoverable = true;
      error.provider = "groq";
      error.model = model;
      throw error;
    }

    return {
      text: text.trim(),
      provider: "groq",
      model,
      usage: data.usage || null
    };

  } catch (err) {
    clearTimeout(timer);

    if (modelIndex < GROQ_MODELS.length - 1) {
      console.warn(`[GroqAdapter] Model ${model} failed (${err.message}). Falling back to ${GROQ_MODELS[modelIndex + 1]}`);
      return generateText({
        prompt,
        systemInstruction,
        temperature,
        maxOutputTokens,
        timeoutMs,
        modelIndex: modelIndex + 1
      });
    }

    if (err.name === "AbortError") {
      const error = new Error(`Groq [${model}] request timed out after ${timeoutMs}ms`);
      error.status = 408;
      error.isRecoverable = true;
      error.provider = "groq";
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
  name: "groq",
  generateText,
  isAvailable
};
