/**
 * StudyReader Listen — Text-to-Speech Provider Interface
 * 
 * Defines the contract that every TTS adapter must fulfill.
 */

class TTSProviderInterface {
  constructor(id, name) {
    if (new.target === TTSProviderInterface) {
      throw new TypeError("Cannot construct TTSProviderInterface directly.");
    }
    this.id = id;
    this.name = name;
  }

  /**
   * Returns whether this provider has valid credentials/configuration.
   * @returns {boolean}
   */
  isConfigured() {
    throw new Error("Method 'isConfigured()' must be implemented.");
  }

  /**
   * Returns list of supported voices for this provider.
   * @returns {Array<{ id: string, name: string, gender: string, language: string, previewUrl?: string }>}
   */
  getVoices() {
    throw new Error("Method 'getVoices()' must be implemented.");
  }

  /**
   * Synthesizes text into audio binary buffer.
   * @param {Object} options
   * @param {string} options.text - Spoken/normalized text
   * @param {string} [options.voice] - Selected voice ID / speaker
   * @param {number} [options.rate=1.0] - Speech rate multiplier (0.75 - 2.0)
   * @param {string} [options.ssml] - Optional SSML string if supported
   * @returns {Promise<{ audioBuffer: Buffer, contentType: string, durationSeconds?: number }>}
   */
  async synthesize(options) {
    throw new Error("Method 'synthesize()' must be implemented.");
  }
}

module.exports = TTSProviderInterface;
