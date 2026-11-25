/**
 * StudyReader Listen — Google Cloud Text-to-Speech Adapter
 * 
 * Supports Neural2 and Journey neural voices:
 * - High-fidelity Indian English (en-IN) and Hindi (hi-IN)
 * - SSML support with prosody and pauses
 */

const TTSProviderInterface = require("../tts-provider-interface");

class GoogleCloudTTSAdapter extends TTSProviderInterface {
  constructor() {
    super("google", "Google Cloud Text-to-Speech (Neural2 / Journey)");
  }

  isConfigured() {
    return Boolean(
      process.env.GOOGLE_TTS_API_KEY ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS
    );
  }

  getVoices() {
    return [
      {
        id: "google:en-IN-Neural2-A",
        name: "Google Neerja (Neural2 — Indian English Female)",
        gender: "female",
        language: "en-IN",
        isDefault: true
      },
      {
        id: "google:en-IN-Neural2-B",
        name: "Google Prabhat (Neural2 — Indian English Male)",
        gender: "male",
        language: "en-IN"
      },
      {
        id: "google:hi-IN-Neural2-A",
        name: "Google Swara (Neural2 — Hindi Female)",
        gender: "female",
        language: "hi-IN"
      },
      {
        id: "google:hi-IN-Neural2-B",
        name: "Google Madhur (Neural2 — Hindi Male)",
        gender: "male",
        language: "hi-IN"
      },
      {
        id: "google:en-US-Journey-F",
        name: "Google Journey (Natural Conversational — Female)",
        gender: "female",
        language: "en-US"
      }
    ];
  }

  async synthesize({ text, voice = "en-IN-Neural2-A", rate = 1.0, ssml = null }) {
    if (!this.isConfigured()) {
      throw new Error("Google Cloud TTS is not configured. Provide GOOGLE_TTS_API_KEY or service account credentials.");
    }

    const apiKey = process.env.GOOGLE_TTS_API_KEY;
    const voiceName = voice.replace(/^google:/, "");
    const langCode = voiceName.split("-").slice(0, 2).join("-") || "en-US";

    const endpoint = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`;

    const input = ssml ? { ssml } : { text };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        voice: {
          languageCode: langCode,
          name: voiceName
        },
        audioConfig: {
          audioEncoding: "MP3",
          speakingRate: rate
        }
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Google TTS failed (${response.status}): ${err.slice(0, 250)}`);
    }

    const data = await response.json();
    const audioBuffer = Buffer.from(data.audioContent, "base64");

    return {
      audioBuffer,
      contentType: "audio/mpeg",
      provider: this.id,
      voice: voiceName
    };
  }
}

module.exports = GoogleCloudTTSAdapter;
