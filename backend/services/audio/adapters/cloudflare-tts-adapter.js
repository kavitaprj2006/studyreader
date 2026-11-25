/**
 * StudyReader Listen — Cloudflare Workers AI Neural TTS Adapter
 * 
 * Powered by Deepgram Aura-2 neural voice synthesis:
 * - High-speed, high-naturalness MP3 streaming
 * - 40 distinct studio-quality neural voices
 * - Directly integrated with existing CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN
 */

const TTSProviderInterface = require("../tts-provider-interface");

class CloudflareTTSAdapter extends TTSProviderInterface {
  constructor() {
    super("cloudflare", "Cloudflare Workers AI (Deepgram Aura)");
    this.model = "@cf/deepgram/aura-2-en";
  }

  getCredentials() {
    return {
      accountId: (process.env.CLOUDFLARE_ACCOUNT_ID || "").trim(),
      apiToken: (process.env.CLOUDFLARE_API_TOKEN || "").trim()
    };
  }

  isConfigured() {
    const { accountId, apiToken } = this.getCredentials();
    return Boolean(accountId && apiToken);
  }

  getVoices() {
    return [
      {
        id: "cf:luna",
        name: "Luna (Neural Studio — Female)",
        gender: "female",
        language: "en-US",
        speaker: "luna",
        isDefault: true,
        description: "Clear, warm, highly articulated academic reading voice"
      },
      {
        id: "cf:orion",
        name: "Orion (Neural Studio — Male)",
        gender: "male",
        language: "en-US",
        speaker: "orion",
        description: "Deep, resonant, focused academic voice"
      },
      {
        id: "cf:athena",
        name: "Athena (Neural Studio — Female)",
        gender: "female",
        language: "en-US",
        speaker: "athena",
        description: "Authoritative and expressive educational lecture voice"
      },
      {
        id: "cf:apollo",
        name: "Apollo (Neural Studio — Male)",
        gender: "male",
        language: "en-US",
        speaker: "apollo",
        description: "Energetic and crisp technical delivery"
      },
      {
        id: "cf:aurora",
        name: "Aurora (Neural Studio — Female)",
        gender: "female",
        language: "en-US",
        speaker: "aurora",
        description: "Soothing, narrative pace ideal for literature and theory"
      },
      {
        id: "cf:atlas",
        name: "Atlas (Neural Studio — Male)",
        gender: "male",
        language: "en-US",
        speaker: "atlas",
        description: "Calm, deep, steady pace for complex mathematics and science"
      }
    ];
  }

  async synthesize({ text, voice = "luna", rate = 1.0 }) {
    const { accountId, apiToken } = this.getCredentials();
    if (!accountId || !apiToken) {
      throw new Error("Cloudflare Workers AI credentials are not configured.");
    }

    const cleanText = String(text || "").trim();
    if (!cleanText) {
      throw new Error("Text is required for TTS synthesis.");
    }

    // Extract speaker name from voice ID (e.g. "cf:luna" -> "luna")
    const speaker = voice.replace(/^cf:/, "").toLowerCase() || "luna";

    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${this.model}`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text: cleanText,
        speaker,
        encoding: "mp3"
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Cloudflare TTS failed (${response.status}): ${errText.slice(0, 250)}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);

    // Approximate audio duration based on MP3 size and typical 48kbps bitrate
    const durationSeconds = Math.max(1, Math.round((audioBuffer.length * 8) / 48000));

    return {
      audioBuffer,
      contentType: "audio/mpeg",
      durationSeconds,
      provider: this.id,
      voice: speaker
    };
  }
}

module.exports = CloudflareTTSAdapter;
