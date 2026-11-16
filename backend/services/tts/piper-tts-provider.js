const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const speechNormalizer = require("./speech-normalizer");

function isPiperConfigured() {
  return Boolean(process.env.PIPER_MODEL && fs.existsSync(process.env.PIPER_MODEL));
}

function getPiperConfig() {
  const executable = process.env.PIPER_EXECUTABLE || "piper";
  const model = process.env.PIPER_MODEL;
  const voiceName = process.env.PIPER_VOICE_NAME || "Local Piper Neural Voice";
  return { executable, model, voiceName };
}

function getVoices() {
  const voices = [
    {
      id: "browser-neural",
      label: "Browser Neural Speech (Recommended)",
      language: "en-US",
      isDefault: true
    }
  ];

  if (isPiperConfigured()) {
    const config = getPiperConfig();
    voices.push({
      id: "piper-local",
      label: config.voiceName,
      language: process.env.PIPER_LANGUAGE || "en-US"
    });
  }

  return voices;
}

function synthesize({ text, rate = 1 }) {
  return new Promise((resolve, reject) => {
    const rawText = String(text || "").trim();

    if (!rawText) {
      reject(new Error("Text is required for speech synthesis."));
      return;
    }

    // Apply natural speech and formula normalization
    const cleanText = speechNormalizer.normalizeTextForSpeech(rawText);

    if (!isPiperConfigured()) {
      // Fallback: Notify client to use high-quality in-browser speech synthesis
      resolve({
        audio: null,
        contentType: "application/json",
        useClientSynthesis: true,
        voiceName: "Browser Neural Speech",
        rate
      });
      return;
    }

    const config = getPiperConfig();
    const outputPath = path.join(
      os.tmpdir(),
      `studyreader-piper-${crypto.randomUUID()}.wav`
    );

    const processObject = spawn(
      config.executable,
      [
        "--model", config.model,
        "--output_file", outputPath
      ],
      { windowsHide: true }
    );

    let errorOutput = "";

    processObject.stderr.on("data", (chunk) => {
      errorOutput += chunk.toString();
    });

    processObject.on("error", (error) => {
      // If Piper binary fails to launch, fallback to client synthesis smoothly
      console.warn("Piper binary launch failed, falling back to client synthesis:", error.message);
      resolve({
        audio: null,
        contentType: "application/json",
        useClientSynthesis: true,
        voiceName: "Browser Neural Speech",
        rate
      });
    });

    processObject.on("close", (exitCode) => {
      if (exitCode !== 0 || !fs.existsSync(outputPath)) {
        console.warn("Piper synthesis failed, falling back to client synthesis.");
        resolve({
          audio: null,
          contentType: "application/json",
          useClientSynthesis: true,
          voiceName: "Browser Neural Speech",
          rate
        });
        return;
      }

      const audio = fs.readFileSync(outputPath);
      try { fs.unlinkSync(outputPath); } catch (e) {}

      resolve({
        audio,
        contentType: "audio/wav",
        voiceName: config.voiceName,
        rate
      });
    });

    processObject.stdin.on("error", () => {});
    processObject.stdin.end(cleanText);
  });
}

module.exports = {
  getVoices,
  synthesize,
  isPiperConfigured
};
