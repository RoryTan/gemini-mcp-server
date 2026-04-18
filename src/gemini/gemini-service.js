/**
 * GeminiService
 * Encapsulates all interactions with the Google Gemini API.
 * Provides methods for generating content using various Gemini models.
 *
 * @author Cline
 */

const { getGeminiClient } = require('./client');
const { getGeminiModelConfig } = require('./models');
const { formatTextPrompt, formatImagePrompt } = require('./request-handler');
const { extractTextContent, extractImageData } = require('./response-parser');
const { log } = require('../utils/logger');
const config = require('../config');

class GeminiService {
  constructor() {
    this.genAI = getGeminiClient();
  }

  /**
   * Generates text content using a specified Gemini model.
   * @param {string} modelType - The type of Gemini model to use (e.g., 'CHAT', 'IMAGE_GENERATION').
   * @param {string} prompt - The text prompt for the generation.
   * @returns {Promise<string>} The generated text content.
   */
  async generateText(modelType, prompt) {
    try {
      const modelConfig = getGeminiModelConfig(modelType);
      // Pass model config including tools if present
      const modelOptions = { model: modelConfig.model };
      if (modelConfig.tools) {
        modelOptions.tools = modelConfig.tools;
      }
      const model = this.genAI.getGenerativeModel(modelOptions);
      const content = formatTextPrompt(prompt);

      // Build request with optional generationConfig
      const request = { contents: [{ parts: content }] };
      if (modelConfig.generationConfig) {
        request.generationConfig = modelConfig.generationConfig;
      }

      const result = await model.generateContent(request);
      log(`Text generation response received from Gemini API for model type: ${modelType}`, 'gemini-service');
      return extractTextContent(result.response?.candidates?.[0]);
    } catch (error) {
      log(`Error generating text with Gemini API for model type ${modelType}: ${error.message}`, 'gemini-service');
      throw new Error(`Gemini text generation failed: ${error.message}`);
    }
  }

  /**
   * Generates image data using a specified Gemini model.
   * @param {string} modelType - The type of Gemini model to use (e.g., 'IMAGE_GENERATION').
   * @param {string} prompt - The text prompt for the image generation.
   * @returns {Promise<string>} The generated image data (base64 encoded).
   */
  async generateImage(modelType, prompt) {
    try {
      const modelConfig = getGeminiModelConfig(modelType);
      // Pass only the model name to getGenerativeModel
      const model = this.genAI.getGenerativeModel({ model: modelConfig.model });
      const content = formatTextPrompt(prompt); // Image generation also uses text prompt

      // Pass the generationConfig to the generateContent method
      const result = await model.generateContent({
        contents: [{ parts: content }],
        generationConfig: modelConfig.generationConfig,
      });
      log(`Image generation response received from Gemini API for model type: ${modelType}`, 'gemini-service');
      return extractImageData(result.response?.candidates?.[0]);
    } catch (error) {
      log(`Error generating image with Gemini API for model type ${modelType}: ${error.message}`, 'gemini-service');
      throw new Error(`Gemini image generation failed: ${error.message}`);
    }
  }

  /**
   * Generates an advanced image using reference images and a prompt.
   * Supports multi-image fusion, character consistency, targeted editing, etc.
   * @param {string} modelType - The model config key (e.g., 'ADVANCED_IMAGE_GENERATION').
   * @param {string} prompt - The text prompt for generation.
   * @param {Array<{data: string, mimeType: string}>} referenceImages - Base64 encoded reference images.
   * @param {Object} [options] - Additional options (e.g., { mode }).
   * @returns {Promise<string>} The generated image data (base64 encoded).
   */
  async generateAdvancedImage(modelType, prompt, referenceImages = [], options = {}) {
    try {
      const modelConfig = getGeminiModelConfig(modelType);
      const model = this.genAI.getGenerativeModel({ model: modelConfig.model });

      // Build parts: text prompt first, then all reference images
      const parts = [{ text: prompt }];
      for (const img of referenceImages) {
        parts.push({
          inlineData: {
            data: img.data,
            mimeType: img.mimeType,
          },
        });
      }

      const request = {
        contents: [{ parts }],
        generationConfig: modelConfig.generationConfig,
      };

      const result = await model.generateContent(request);
      log(`Advanced image generation response received for model type: ${modelType} (mode: ${options.mode || 'standard'}, refs: ${referenceImages.length})`, 'gemini-service');
      return extractImageData(result.response?.candidates?.[0]);
    } catch (error) {
      log(`Error generating advanced image with Gemini API for model type ${modelType}: ${error.message}`, 'gemini-service');
      throw new Error(`Gemini advanced image generation failed: ${error.message}`);
    }
  }

  /**
   * Generates an image using Nano Banana Pro (Gemini 3 Pro Image) via direct Gemini API.
   * Reference images are supplied as Gemini File API URIs — not base64.
   * @param {string} prompt - Text prompt (mode-specific content should already be embedded).
   * @param {Array<{uri: string, mimeType: string}>} fileUris - File API URIs for reference images.
   * @param {Object} [options] - e.g. { mode, resolution }
   * @returns {Promise<string>} Base64-encoded image data.
   */
  async generateNanaBananaProImageDirect(prompt, fileUris, options = {}) {
    try {
      const modelConfig = config.GEMINI_MODELS.NANO_BANANA_PRO;
      const model = this.genAI.getGenerativeModel({ model: modelConfig.model });

      const parts = [
        { text: prompt },
        ...fileUris.map(({ uri, mimeType }) => ({
          fileData: { fileUri: uri, mimeType },
        })),
      ];

      const result = await model.generateContent({
        contents: [{ parts }],
        generationConfig: modelConfig.generationConfig,
      });

      log(`NBP direct generation complete (refs: ${fileUris.length}, mode: ${options.mode || 'standard'})`, 'gemini-service');
      return extractImageData(result.response?.candidates?.[0]);
    } catch (error) {
      log(`NBP direct generation error: ${error.message}`, 'gemini-service');
      throw new Error(`Gemini NBP direct generation failed: ${error.message}`);
    }
  }

  /**
   * Generates an advanced image via direct Gemini API using File API URIs.
   * Drop-in complement to generateAdvancedImage() — same signature except fileUris instead of base64 array.
   * @param {string} modelType - Model config key (e.g., 'ADVANCED_IMAGE_GENERATION').
   * @param {string} prompt - Text prompt.
   * @param {Array<{uri: string, mimeType: string}>} fileUris - File API URIs for reference images.
   * @param {Object} [options] - e.g. { mode }
   * @returns {Promise<string>} Base64-encoded image data.
   */
  async generateAdvancedImageDirect(modelType, prompt, fileUris, options = {}) {
    try {
      const modelConfig = getGeminiModelConfig(modelType);
      const model = this.genAI.getGenerativeModel({ model: modelConfig.model });

      const parts = [
        { text: prompt },
        ...fileUris.map(({ uri, mimeType }) => ({
          fileData: { fileUri: uri, mimeType },
        })),
      ];

      const result = await model.generateContent({
        contents: [{ parts }],
        generationConfig: modelConfig.generationConfig,
      });

      log(`Advanced image direct generation complete (refs: ${fileUris.length}, mode: ${options.mode || 'standard'})`, 'gemini-service');
      return extractImageData(result.response?.candidates?.[0]);
    } catch (error) {
      log(`Advanced image direct generation error: ${error.message}`, 'gemini-service');
      throw new Error(`Gemini advanced image direct generation failed: ${error.message}`);
    }
  }

  /**
   * Analyzes an image using a specified Gemini model.
   * @param {string} modelType - The type of Gemini model to use (e.g., 'IMAGE_ANALYSIS').
   * @param {string} prompt - The text prompt for the analysis.
   * @param {string} imageBase64 - Base64 encoded image data.
   * @param {string} mimeType - The MIME type of the image (e.g., 'image/png', 'image/jpeg').
   * @returns {Promise<string>} The analysis result text.
   */
  async analyzeImage(modelType, prompt, imageBase64, mimeType) {
    try {
      const modelConfig = getGeminiModelConfig(modelType);
      // Pass only the model name to getGenerativeModel
      const model = this.genAI.getGenerativeModel({ model: modelConfig.model });
      const content = formatImagePrompt(prompt, mimeType, imageBase64);

      // Build request with optional generationConfig
      const request = { contents: content };
      if (modelConfig.generationConfig) {
        request.generationConfig = modelConfig.generationConfig;
      }

      const result = await model.generateContent(request);
      log(`Image analysis response received from Gemini API for model type: ${modelType}`, 'gemini-service');
      
      // For IMAGE_EDITING, extract image data; otherwise extract text
      if (modelType === 'IMAGE_EDITING') {
        return extractImageData(result.response?.candidates?.[0]);
      }
      return extractTextContent(result.response?.candidates?.[0]);
    } catch (error) {
      log(`Error analyzing image with Gemini API for model type ${modelType}: ${error.message}`, 'gemini-service');
      throw new Error(`Gemini image analysis failed: ${error.message}`);
    }
  }

  /**
   * Transcribes audio using a specified Gemini model.
   * @param {string} modelType - The type of Gemini model to use (e.g., 'AUDIO_TRANSCRIPTION').
   * @param {string} audioBase64 - Base64 encoded audio data.
   * @param {string} mimeType - The MIME type of the audio (e.g., 'audio/mpeg', 'audio/wav').
   * @param {string} [prompt] - Optional prompt to guide transcription behavior.
   * @returns {Promise<string>} The transcribed text.
   */
  async transcribeAudio(modelType, audioBase64, mimeType, prompt = null) {
    try {
      const modelConfig = getGeminiModelConfig(modelType);
      const model = this.genAI.getGenerativeModel({ model: modelConfig.model });
      
      // Build content with optional prompt
      const parts = [];
      if (prompt) {
        parts.push({ text: prompt });
      }
      parts.push({
        inlineData: {
          data: audioBase64,
          mimeType,
        },
      });
      
      const content = [{ parts }];

      // Build request with optional generationConfig
      const request = { contents: content };
      if (modelConfig.generationConfig) {
        request.generationConfig = modelConfig.generationConfig;
      }

      const result = await model.generateContent(request);
      log(`Audio transcription response received from Gemini API for model type: ${modelType}`, 'gemini-service');
      return extractTextContent(result.response?.candidates?.[0]);
    } catch (error) {
      log(`Error transcribing audio with Gemini API for model type ${modelType}: ${error.message}`, 'gemini-service');
      throw new Error(`Gemini audio transcription failed: ${error.message}`);
    }
  }

  /**
   * Analyzes video using a specified Gemini model.
   * @param {string} modelType - The type of Gemini model to use (e.g., 'VIDEO_ANALYSIS').
   * @param {string} prompt - The text prompt for the analysis.
   * @param {string} videoBase64 - Base64 encoded video data.
   * @param {string} mimeType - The MIME type of the video (e.g., 'video/mp4', 'video/webm').
   * @returns {Promise<string>} The analysis result text.
   */
  async analyzeVideo(modelType, prompt, videoBase64, mimeType) {
    try {
      const modelConfig = getGeminiModelConfig(modelType);
      const model = this.genAI.getGenerativeModel({ model: modelConfig.model });
      const content = [{
        parts: [
          { text: prompt },
          {
            inlineData: {
              data: videoBase64,
              mimeType,
            },
          },
        ],
      }];

      const request = { contents: content };
      if (modelConfig.generationConfig) {
        request.generationConfig = modelConfig.generationConfig;
      }

      const result = await model.generateContent(request);
      log(`Video analysis response received from Gemini API for model type: ${modelType}`, 'gemini-service');
      return extractTextContent(result.response?.candidates?.[0]);
    } catch (error) {
      log(`Error analyzing video with Gemini API for model type ${modelType}: ${error.message}`, 'gemini-service');
      throw new Error(`Gemini video analysis failed: ${error.message}`);
    }
  }

  /**
   * Analyzes video using file URI (for files uploaded to Gemini File API)
   * @param {string} modelType - The type of Gemini model to use.
   * @param {string} prompt - The text prompt for the analysis.
   * @param {string} fileUri - URI of the uploaded file.
   * @param {string} mimeType - The MIME type of the video.
   * @returns {Promise<string>} The analysis result text.
   */
  async analyzeVideoFromUri(modelType, prompt, fileUri, mimeType) {
    try {
      const modelConfig = getGeminiModelConfig(modelType);
      const model = this.genAI.getGenerativeModel({ model: modelConfig.model });
      const content = [{
        parts: [
          { text: prompt },
          {
            fileData: {
              mimeType,
              fileUri,
            }
          },
        ],
      }];

      const request = { contents: content };
      if (modelConfig.generationConfig) {
        request.generationConfig = modelConfig.generationConfig;
      }

      const result = await model.generateContent(request);
      log(`Video analysis (from URI) response received from Gemini API for model type: ${modelType}`, 'gemini-service');
      return extractTextContent(result.response?.candidates?.[0]);
    } catch (error) {
      log(`Error analyzing video from URI with Gemini API for model type ${modelType}: ${error.message}`, 'gemini-service');
      throw new Error(`Gemini video analysis from URI failed: ${error.message}`);
    }
  }

  /**
   * Analyzes a YouTube video using its URL (Gemini native YouTube support)
   * @param {string} modelType - The type of Gemini model to use.
   * @param {string} prompt - The text prompt for the analysis.
   * @param {string} youtubeUrl - Full YouTube URL (e.g., https://www.youtube.com/watch?v=...)
   * @returns {Promise<string>} The analysis result text.
   */
  async analyzeVideoFromYouTube(modelType, prompt, youtubeUrl) {
    try {
      const modelConfig = getGeminiModelConfig(modelType);
      const model = this.genAI.getGenerativeModel({ model: modelConfig.model });
      const content = [{
        parts: [
          { text: prompt },
          {
            fileData: {
              fileUri: youtubeUrl,
            },
          },
        ],
      }];

      const request = { contents: content };
      if (modelConfig.generationConfig) {
        request.generationConfig = modelConfig.generationConfig;
      }

      const result = await model.generateContent(request);
      log(`Video analysis (YouTube URL) response received from Gemini API for model type: ${modelType}`, 'gemini-service');
      return extractTextContent(result.response?.candidates?.[0]);
    } catch (error) {
      log(`Error analyzing YouTube video with Gemini API for model type ${modelType}: ${error.message}`, 'gemini-service');
      throw new Error(`Gemini YouTube video analysis failed: ${error.message}`);
    }
  }

  /**
   * Analyzes image using file URI (for files uploaded to Gemini File API)
   * @param {string} modelType - The type of Gemini model to use.
   * @param {string} prompt - The text prompt for the analysis.
   * @param {string} fileUri - URI of the uploaded file.
   * @param {string} mimeType - The MIME type of the image.
   * @returns {Promise<string>} The analysis result.
   */
  async analyzeImageFromUri(modelType, prompt, fileUri, mimeType) {
    try {
      const modelConfig = getGeminiModelConfig(modelType);
      const model = this.genAI.getGenerativeModel({ model: modelConfig.model });
      const content = [{
        parts: [
          { text: prompt },
          {
            fileData: {
              mimeType,
              fileUri,
            }
          },
        ],
      }];

      const request = { contents: content };
      if (modelConfig.generationConfig) {
        request.generationConfig = modelConfig.generationConfig;
      }

      const result = await model.generateContent(request);
      log(`Image analysis (from URI) response received from Gemini API for model type: ${modelType}`, 'gemini-service');
      
      if (modelType === 'IMAGE_EDITING') {
        return extractImageData(result.response?.candidates?.[0]);
      }
      return extractTextContent(result.response?.candidates?.[0]);
    } catch (error) {
      log(`Error analyzing image from URI with Gemini API for model type ${modelType}: ${error.message}`, 'gemini-service');
      throw new Error(`Gemini image analysis from URI failed: ${error.message}`);
    }
  }

  /**
   * Transcribes audio using file URI (for files uploaded to Gemini File API)
   * @param {string} modelType - The type of Gemini model to use.
   * @param {string} fileUri - URI of the uploaded file.
   * @param {string} mimeType - The MIME type of the audio.
   * @param {string} [prompt] - Optional prompt to guide transcription.
   * @returns {Promise<string>} The transcribed text.
   */
  async transcribeAudioFromUri(modelType, fileUri, mimeType, prompt = null) {
    try {
      const modelConfig = getGeminiModelConfig(modelType);
      const model = this.genAI.getGenerativeModel({ model: modelConfig.model });
      
      const parts = [];
      if (prompt) {
        parts.push({ text: prompt });
      }
      parts.push({
        fileData: {
          mimeType,
          fileUri,
        }
      });
      
      const content = [{ parts }];

      const request = { contents: content };
      if (modelConfig.generationConfig) {
        request.generationConfig = modelConfig.generationConfig;
      }

      const result = await model.generateContent(request);
      log(`Audio transcription (from URI) response received from Gemini API for model type: ${modelType}`, 'gemini-service');
      return extractTextContent(result.response?.candidates?.[0]);
    } catch (error) {
      log(`Error transcribing audio from URI with Gemini API for model type ${modelType}: ${error.message}`, 'gemini-service');
      throw new Error(`Gemini audio transcription from URI failed: ${error.message}`);
    }
  }
}

module.exports = GeminiService;
