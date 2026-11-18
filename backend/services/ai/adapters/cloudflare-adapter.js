/**
 * StudyReader — Cloudflare Workers AI Provider Adapter
 *
 * Serverless GPU inference hosted globally across Cloudflare's edge network.
 * Uses OpenAI-compatible REST endpoint at /accounts/{account_id}/ai/v1/chat/completions.
 */

const CF_MODEL = process.env.CLOUDFLARE_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

function getCredentials() {
  const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const apiToken = (process.env.CLOUDFLARE_API_TOKEN || "").trim();
  return { accountId, apiToken };
}

/**
 * Executes a text generation request against Cloudflare Workers AI.
 * @param {Object} params
 * @param {string} params.prompt
 * @param {string} [params.systemInstruction]
 * @param {number} [params.temperature=0.2]
 * @param {number} [params.maxOutputTokens=2048]
 * @param {number} [params.timeoutMs=15000]
 */
async function generateText({
  prompt,
  systemInstruction = "",
  temperature = 0.2,
  maxOutputTokens = 2048,
  timeoutMs = 15000
}) {
  const { accountId, apiToken } = getCredentials();
  if (!accountId || !apiToken) {
    const error = new Error("CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN is not configured.");
    error.status = 401;
    error.isRecoverable = false;
    error.provider = "cloudflare";
    throw error;
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/v1/chat/completions`;

  const messages = [];
  if (systemInstruction) {
    messages.push({ role: "system", content: systemInstruction });
  }
  messages.push({ role: "user", content: prompt });

  const requestBody = {
    model: CF_MODEL,
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
        "Authorization": `Bearer ${apiToken}`
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

      const errorMsg = parsedErr.errors?.[0]?.message || parsedErr.error?.message || errText.slice(0, 300) || `HTTP ${response.status}`;
      const error = new Error(`Cloudflare [${CF_MODEL}] failed (${response.status}): ${errorMsg}`);
      error.status = response.status;
      error.provider = "cloudflare";
      error.model = CF_MODEL;
      error.isRecoverable = response.status === 429 || response.status === 503 || response.status >= 500;
      throw error;
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || data.result?.response;

    if (!text || typeof text !== "string" || !text.trim()) {
      const error = new Error(`Cloudflare [${CF_MODEL}] returned empty output.`);
      error.isRecoverable = true;
      error.provider = "cloudflare";
      error.model = CF_MODEL;
      throw error;
    }

    return {
      text: text.trim(),
      provider: "cloudflare",
      model: CF_MODEL,
      usage: data.usage || null
    };

  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      const error = new Error(`Cloudflare [${CF_MODEL}] request timed out after ${timeoutMs}ms`);
      error.status = 408;
      error.isRecoverable = true;
      error.provider = "cloudflare";
      error.model = CF_MODEL;
      throw error;
    }
    throw err;
  }
}

function isAvailable() {
  const { accountId, apiToken } = getCredentials();
  return Boolean(accountId && apiToken);
}

module.exports = {
  name: "cloudflare",
  generateText,
  isAvailable
};
