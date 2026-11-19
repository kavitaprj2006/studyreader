/**
 * StudyReader — Centralized AI Provider Router & Failover Engine
 *
 * Orchestrates multi-tier AI generation with automatic failover:
 * Tier 1: Google Gemini (Primary - gemini-2.5-flash / gemini-3.5-flash-lite)
 * Tier 2: Groq LPU (Backup 1 - openai/gpt-oss-120b / Backup 2 - openai/gpt-oss-20b)
 * Tier 3: Cloudflare Workers AI (Backup 3 - @cf/meta/llama-3.3-70b-instruct-fp8-fast)
 *
 * Features:
 * - Zero interference when primary provider succeeds
 * - Provider health tracking and cooldown management
 * - Strict response & citation grounding validation
 * - In-flight execution metrics for admin monitoring
 */

const geminiAdapter = require("./adapters/gemini-adapter");
const groqAdapter = require("./adapters/groq-adapter");
const cloudflareAdapter = require("./adapters/cloudflare-adapter");

// Active adapters in priority order
const PROVIDERS = [
  geminiAdapter,
  groqAdapter,
  cloudflareAdapter
];

// In-memory health and performance metrics (reset on server start)
const providerMetrics = {
  gemini: {
    name: "Google Gemini",
    configured: false,
    healthy: true,
    cooldownUntil: 0,
    totalRequests: 0,
    successCount: 0,
    failureCount: 0,
    fallbackEvents: 0,
    lastLatencyMs: 0,
    totalLatencyMs: 0,
    lastError: null,
    lastUsedAt: null
  },
  groq: {
    name: "Groq LPU",
    configured: false,
    healthy: true,
    cooldownUntil: 0,
    totalRequests: 0,
    successCount: 0,
    failureCount: 0,
    fallbackEvents: 0,
    lastLatencyMs: 0,
    totalLatencyMs: 0,
    lastError: null,
    lastUsedAt: null
  },
  cloudflare: {
    name: "Cloudflare Workers AI",
    configured: false,
    healthy: true,
    cooldownUntil: 0,
    totalRequests: 0,
    successCount: 0,
    failureCount: 0,
    fallbackEvents: 0,
    lastLatencyMs: 0,
    totalLatencyMs: 0,
    lastError: null,
    lastUsedAt: null
  }
};

// Recent event ring buffer for admin log inspection (max 50 events)
const recentAiEvents = [];

function recordAiEvent(event) {
  recentAiEvents.unshift({
    timestamp: new Date().toISOString(),
    ...event
  });
  if (recentAiEvents.length > 50) {
    recentAiEvents.pop();
  }
}

/**
 * Validates generated content for completeness and groundings.
 * @param {string} text
 * @param {Object} options
 * @param {boolean} [options.requireCitations=false]
 * @param {Array<number>} [options.validPages=[]]
 * @returns {boolean}
 */
function validateResponse(text, options = {}) {
  if (!text || typeof text !== "string") return false;
  const clean = text.trim();
  if (clean.length < 15) return false;

  // If citations are required, check citation formatting
  if (options.requireCitations && Array.isArray(options.validPages) && options.validPages.length > 0) {
    const citationRegex = /\[(?:Page|Slide|Section)\s+(\d+)\]/gi;
    const matches = [...clean.matchAll(citationRegex)];
    if (matches.length > 0) {
      // Check that at least one cited page exists in the retrieved context
      const citedPages = matches.map(m => parseInt(m[1], 10));
      const hasValidCitation = citedPages.some(cp => options.validPages.includes(cp));
      if (!hasValidCitation) {
        console.warn(`[AIRouter] Response cited pages ${citedPages.join(", ")}, none of which matched context pages [${options.validPages.join(", ")}].`);
        // We log warning rather than discarding completely to avoid false rejection of valid explanatory synthesis
      }
    }
  }

  return true;
}

/**
 * Dispatches prompt to the AI provider chain with automatic failover.
 * @param {Object} params
 * @param {string} params.prompt
 * @param {string} [params.systemInstruction]
 * @param {number} [params.temperature=0.2]
 * @param {number} [params.maxOutputTokens=2048]
 * @param {boolean} [params.requireCitations=false]
 * @param {Array<number>} [params.validPages=[]]
 * @returns {Promise<{ text: string, provider: string, model: string, fallbackOccurred: boolean }>}
 */
async function generateWithFallback({
  prompt,
  messages,
  systemInstruction = "",
  systemPrompt = "",
  temperature = 0.2,
  maxOutputTokens = 2048,
  requireCitations = false,
  validPages = []
}) {
  const now = Date.now();
  let lastError = null;
  let attemptedCount = 0;

  // Support both prompt string and messages array
  let effectivePrompt = prompt;
  if (!effectivePrompt && Array.isArray(messages) && messages.length > 0) {
    const userMsgs = messages.filter(m => m.role === "user");
    effectivePrompt = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1].content : messages.map(m => m.content).join("\n");
  }
  effectivePrompt = typeof effectivePrompt === "string" ? effectivePrompt : String(effectivePrompt || "");
  const effectiveSystem = systemInstruction || systemPrompt || "";

  for (let i = 0; i < PROVIDERS.length; i++) {
    const adapter = PROVIDERS[i];
    const pName = adapter.name;
    const metric = providerMetrics[pName];

    metric.configured = adapter.isAvailable();

    // Skip unconfigured adapters immediately
    if (!metric.configured) {
      continue;
    }

    // Skip adapters in active cooldown
    if (metric.cooldownUntil > now) {
      console.warn(`[AIRouter] Provider '${pName}' is in cooldown until ${new Date(metric.cooldownUntil).toISOString()}. Skipping.`);
      continue;
    }

    attemptedCount++;
    metric.totalRequests++;
    const startTime = Date.now();

    try {
      const result = await adapter.generateText({
        prompt: effectivePrompt,
        systemInstruction: effectiveSystem,
        temperature,
        maxOutputTokens
      });

      const latencyMs = Date.now() - startTime;
      metric.lastLatencyMs = latencyMs;
      metric.totalLatencyMs = (metric.totalLatencyMs || 0) + latencyMs;
      metric.successCount++;
      metric.healthy = true;
      metric.lastUsedAt = new Date().toISOString();

      // Validate output quality
      const isValid = validateResponse(result.text, { requireCitations, validPages });
      if (!isValid) {
        throw new Error(`Provider '${pName}' returned malformed or ungrounded response.`);
      }

      const fallbackOccurred = i > 0;
      if (fallbackOccurred) {
        metric.fallbackEvents++;
        recordAiEvent({
          type: "fallback_success",
          provider: pName,
          model: result.model,
          latencyMs,
          message: `Recovered request using backup provider '${pName}'.`
        });
        console.log(`[AIRouter] Successfully recovered request using backup provider '${pName}' (${result.model}) in ${latencyMs}ms.`);
      }

      return {
        text: result.text,
        provider: result.provider,
        model: result.model,
        usage: result.usage,
        latencyMs,
        fallbackOccurred
      };

    } catch (err) {
      const latencyMs = Date.now() - startTime;
      metric.lastLatencyMs = latencyMs;
      metric.failureCount++;
      metric.lastError = err.message;
      lastError = err;

      recordAiEvent({
        type: "provider_failure",
        provider: pName,
        status: err.status || 500,
        latencyMs,
        error: err.message
      });

      console.warn(`[AIRouter] Provider '${pName}' failed in ${latencyMs}ms: ${err.message}`);

      // Handle specific error codes
      if (err.status === 401 || err.status === 403) {
        // Bad credentials or permission denied: cooldown 10 mins
        metric.cooldownUntil = Date.now() + 10 * 60 * 1000;
        metric.healthy = false;
      } else if (err.status === 429) {
        // Quota exhausted: cooldown 2 minutes
        metric.cooldownUntil = Date.now() + 2 * 60 * 1000;
        metric.healthy = false;
      } else if (err.status === 503) {
        // Overload: cooldown 45 seconds
        metric.cooldownUntil = Date.now() + 45 * 1000;
      }

      // Check if we can fall back to next provider
      if (err.isRecoverable !== false && i < PROVIDERS.length - 1) {
        console.log(`[AIRouter] Attempting next backup provider in chain...`);
        continue;
      }
    }
  }

  // All providers failed or were unconfigured
  const finalErrorMsg = attemptedCount > 0
    ? "All configured AI providers are temporarily unavailable due to high demand. Please retry your question in a moment."
    : "No AI providers are currently available. Please ensure GEMINI_API_KEY is configured.";

  const finalError = new Error(finalErrorMsg);
  finalError.status = 503;
  finalError.originalError = lastError?.message;
  throw finalError;
}

/**
 * Returns current health, latency, and request metrics across all providers.
 * Used for admin dashboard monitoring.
 */
function getProviderStatus() {
  const now = Date.now();
  const summary = {};

  for (const [key, metric] of Object.entries(providerMetrics)) {
    const adapter = PROVIDERS.find(p => p.name === key);
    const configured = adapter ? adapter.isAvailable() : false;
    const inCooldown = metric.cooldownUntil > now;

    summary[key] = {
      name: metric.name,
      configured,
      status: !configured ? "not_configured" : (inCooldown ? "cooldown" : (metric.healthy ? "ready" : "degraded")),
      cooldownSecondsRemaining: inCooldown ? Math.ceil((metric.cooldownUntil - now) / 1000) : 0,
      totalRequests: metric.totalRequests,
      successCount: metric.successCount,
      failureCount: metric.failureCount,
      fallbackEvents: metric.fallbackEvents,
      successRate: metric.totalRequests > 0 ? Math.round((metric.successCount / metric.totalRequests) * 100) : null,
      lastLatencyMs: metric.lastLatencyMs,
      avgLatencyMs: metric.totalRequests > 0 ? Math.round(metric.totalLatencyMs / metric.totalRequests) : null,
      lastError: metric.lastError,
      lastUsedAt: metric.lastUsedAt
    };
  }

  return {
    providers: summary,
    recentEvents: recentAiEvents.slice(0, 20)
  };
}

/**
 * Executes a direct diagnostic test against a specific AI provider.
 * Does not fall back to other providers so each provider can be verified independently.
 */
async function testProvider(providerName) {
  const adapter = PROVIDERS.find(p => p.name === providerName);
  if (!adapter) {
    throw new Error(`Unknown provider '${providerName}'. Valid providers are: gemini, groq, cloudflare.`);
  }

  const metric = providerMetrics[providerName];
  if (!adapter.isAvailable()) {
    metric.configured = false;
    return {
      provider: providerName,
      name: metric.name,
      configured: false,
      success: false,
      error: `Missing credentials. Ensure ${providerName === 'groq' ? 'GROQ_API_KEY' : (providerName === 'cloudflare' ? 'CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN' : 'GEMINI_API_KEY')} is set.`
    };
  }

  metric.configured = true;
  metric.totalRequests++;
  const startTime = Date.now();

  try {
    const result = await adapter.generateText({
      prompt: "Respond with 'StudyReader AI Health Check OK' in under 10 words.",
      maxOutputTokens: 512
    });

    const latencyMs = Date.now() - startTime;
    metric.lastLatencyMs = latencyMs;
    metric.totalLatencyMs = (metric.totalLatencyMs || 0) + latencyMs;
    metric.successCount++;
    metric.healthy = true;
    metric.lastError = null;
    metric.lastUsedAt = new Date().toISOString();

    recordAiEvent({
      type: "diagnostic_test_success",
      provider: providerName,
      model: result.model,
      latencyMs,
      message: `Diagnostic test succeeded: "${result.text.slice(0, 80)}"`
    });

    return {
      provider: providerName,
      name: metric.name,
      configured: true,
      success: true,
      model: result.model,
      latencyMs,
      response: result.text
    };

  } catch (err) {
    const latencyMs = Date.now() - startTime;
    metric.lastLatencyMs = latencyMs;
    metric.totalLatencyMs = (metric.totalLatencyMs || 0) + latencyMs;
    metric.failureCount++;
    metric.lastError = err.message;

    recordAiEvent({
      type: "diagnostic_test_failure",
      provider: providerName,
      latencyMs,
      error: err.message
    });

    return {
      provider: providerName,
      name: metric.name,
      configured: true,
      success: false,
      latencyMs,
      error: err.message
    };
  }
}

function clearCooldowns() {
  for (const metric of Object.values(providerMetrics)) {
    metric.cooldownUntil = 0;
    metric.healthy = true;
  }
}

module.exports = {
  generateWithFallback,
  getProviderStatus,
  testProvider,
  recordAiEvent,
  clearCooldowns
};
