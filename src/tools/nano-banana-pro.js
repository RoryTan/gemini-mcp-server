/**
 * Nano Banana Pro Tool for Gemini MCP Server.
 * Uses Gemini 3 Pro Image (Nano Banana Pro) via OpenRouter for professional-grade image generation.
 * Supports up to 14 reference images, 4K resolution, advanced text rendering, and multi-character consistency.
 *
 * @author Claude + Rob
 */

const crypto = require('crypto');
const https = require('https');
const path = require('path');
const fs = require('fs');
const BaseTool = require('./base-tool');
const { log } = require('../utils/logger');
const { ensureDirectoryExists, readFileAsBuffer, validateFileSize, getMimeType } = require('../utils/file-utils');
const { validateNonEmptyString, validateString } = require('../utils/validation');
const config = require('../config');
const openRouterService = require('../openrouter/openrouter-service');
const fileApi = require('../gemini/file-api');

class NanoBananaProTool extends BaseTool {
  constructor(intelligenceSystem, geminiService) {
    super(
      'gemini-nano-banana-pro',
      'Generate professional images with Nano Banana Pro (Gemini 3 Pro Image): 4K resolution, up to 14 reference images, advanced text rendering, character consistency, and studio-grade controls',
      {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Text description of the desired image or editing instruction',
          },
          mode: {
            type: 'string',
            enum: ['fusion', 'consistency', 'targeted_edit', 'template', 'standard'],
            description: 'Generation mode: fusion (blend up to 14 images), consistency (maintain character/style for up to 5 characters), targeted_edit (precise localized edits), template (follow layout), standard (basic generation)',
          },
          resolution: {
            type: 'string',
            enum: ['1k', '2k', '4k'],
            description: 'Output resolution: 1k (1024px), 2k (2048px), or 4k (4096px). Higher resolutions cost more.',
          },
          aspect_ratio: {
            type: 'string',
            enum: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
            description: 'Aspect ratio for the generated image',
          },
          reference_images: {
            type: 'array',
            items: {
              type: 'string',
            },
            description: 'Optional array of file paths to reference images (up to 14 for Nano Banana Pro)',
          },
          context: {
            type: 'string',
            description: 'Optional context for intelligent enhancement (e.g., "professional", "artistic", "infographic")',
          },
        },
        required: ['prompt'],
      },
      intelligenceSystem,
      geminiService,
    );
  }

  /**
   * Executes the Nano Banana Pro image generation tool.
   * @param {Object} args - The arguments for the tool.
   * @param {string} args.prompt - The text description or editing instruction.
   * @param {string} [args.mode='standard'] - The generation mode.
   * @param {string} [args.resolution='1k'] - Output resolution.
   * @param {string} [args.aspect_ratio='1:1'] - Aspect ratio.
   * @param {string[]} [args.reference_images] - Array of file paths to reference images.
   * @param {string} [args.context] - Optional context for intelligent enhancement.
   * @returns {Promise<Object>} A promise that resolves to the tool's result.
   */
  async execute(args) {
    const prompt = validateNonEmptyString(args.prompt, 'prompt');
    const mode = args.mode || 'standard';
    const resolution = args.resolution || '1k';
    const aspectRatio = args.aspect_ratio || '1:1';
    const referenceImagePaths = args.reference_images || [];
    const context = args.context ? validateString(args.context, 'context') : null;

    log(`Nano Banana Pro: mode="${mode}", resolution="${resolution}", aspect_ratio="${aspectRatio}", prompt="${prompt}"`, this.name);

    try {
      // Validate reference images count
      if (referenceImagePaths.length > 14) {
        throw new Error(`Nano Banana Pro supports up to 14 reference images, got ${referenceImagePaths.length}`);
      }

      // Upload reference images to File API (cached per session) — fall back to base64 if upload fails
      const referenceImages = []; // for O/R fallback: { data, mimeType }
      const fileApiRefs = [];     // for direct path: { uri, mimeType }
      let useDirectApi = true;

      if (referenceImagePaths.length > 0) {
        log(`Processing ${referenceImagePaths.length} reference images`, this.name);

        for (let i = 0; i < referenceImagePaths.length; i++) {
          const imagePath = referenceImagePaths[i];

          if (!path.isAbsolute(imagePath)) {
            throw new Error(`Reference Image Error: File path must be absolute, got: ${imagePath}`);
          }
          if (!fs.existsSync(imagePath)) {
            throw new Error(`Reference Image Error: File not found: ${imagePath}`);
          }
          validateFileSize(imagePath, config.MAX_IMAGE_SIZE_MB);

          try {
            const { uri, mimeType } = await fileApi.uploadFile(imagePath);
            fileApiRefs.push({ uri, mimeType });
            log(`✓ File API ref ${i + 1}: ${path.basename(imagePath)}`, this.name);
          } catch (uploadErr) {
            log(`File API upload failed for image ${i + 1}, will fall back to O/R: ${uploadErr.message}`, this.name);
            useDirectApi = false;
          }
        }

        // If any upload failed, build base64 set for O/R fallback
        if (!useDirectApi) {
          // readFileAsBuffer and getMimeType imported at top
          for (const imagePath of referenceImagePaths) {
            const imageBuffer = readFileAsBuffer(imagePath);
            const mimeType = getMimeType(imagePath, config.SUPPORTED_IMAGE_MIMES);
            referenceImages.push({ data: imageBuffer.toString('base64'), mimeType });
          }
        }
      }

      // Validate mode requirements (check whichever ref array is populated)
      const totalRefs = useDirectApi ? fileApiRefs.length : referenceImages.length;
      if (['fusion', 'consistency', 'template'].includes(mode) && totalRefs === 0) {
        throw new Error(`Mode "${mode}" requires at least one reference image`);
      }
      if (mode === 'fusion' && totalRefs < 2) {
        throw new Error('Fusion mode requires at least 2 reference images');
      }

      // Apply intelligent enhancement
      let enhancedPrompt = prompt;
      if (this.intelligenceSystem.initialized) {
        try {
          const contextForEnhancement = context || mode;
          enhancedPrompt = await this.intelligenceSystem.enhancePrompt(prompt, contextForEnhancement, this.name);
          log('Applied Tool Intelligence enhancement', this.name);
        } catch (err) {
          log(`Tool Intelligence enhancement failed: ${err.message}`, this.name);
        }
      }

      // Generate image — direct Gemini API first, O/R as fallback
      let imageData;
      let providerUsed = 'direct';

      if (useDirectApi) {
        log('Generating with direct Gemini API + File API URIs', this.name);
        try {
          imageData = await this._generateDirect(enhancedPrompt, fileApiRefs);
        } catch (directErr) {
          log(`Direct API failed (${directErr.message}), falling back to OpenRouter`, this.name);
          useDirectApi = false;
          providerUsed = 'openrouter';
          // Build base64 set for fallback
          // readFileAsBuffer and getMimeType imported at top
          for (const imagePath of referenceImagePaths) {
            const imageBuffer = readFileAsBuffer(imagePath);
            const mimeType = getMimeType(imagePath, config.SUPPORTED_IMAGE_MIMES);
            referenceImages.push({ data: imageBuffer.toString('base64'), mimeType });
          }
        }
      }

      if (!useDirectApi) {
        if (!openRouterService.isServiceAvailable()) {
          throw new Error('Both direct Gemini API and OpenRouter are unavailable.');
        }
        log('Generating with Nano Banana Pro via OpenRouter (fallback)', this.name);
        providerUsed = 'openrouter';
        imageData = await openRouterService.generateNanaBananaProImage(
          enhancedPrompt,
          referenceImages,
          { mode, resolution, aspect_ratio: aspectRatio },
        );
      }

      if (imageData) {
        log('Successfully generated Nano Banana Pro image', this.name);

        ensureDirectoryExists(config.OUTPUT_DIR, this.name);

        const timestamp = Date.now();
        const hash = crypto.createHash('md5').update(prompt + mode + resolution).digest('hex').substring(0, 8);
        const imageName = `nanobananapro-${mode}-${resolution}-${hash}-${timestamp}.png`;
        const imagePath = path.join(config.OUTPUT_DIR, imageName);

        fs.writeFileSync(imagePath, Buffer.from(imageData, 'base64'));
        log(`Image saved to: ${imagePath}`, this.name);

        // Learn from interaction
        if (this.intelligenceSystem.initialized) {
          try {
            const resultDescription = `Nano Banana Pro image generated (${mode}, ${resolution}): ${imagePath}`;
            await this.intelligenceSystem.learnFromInteraction(
              prompt,
              enhancedPrompt,
              resultDescription,
              context || mode,
              this.name
            );
          } catch (err) {
            log(`Tool Intelligence learning failed: ${err.message}`, this.name);
          }
        }

        // Build response
        let finalResponse = `✓ **Nano Banana Pro** image successfully generated\n\n`;
        finalResponse += `**Mode:** ${mode}\n`;
        finalResponse += `**Resolution:** ${resolution}\n`;
        finalResponse += `**Aspect Ratio:** ${aspectRatio}\n`;
        finalResponse += `**Prompt:** "${prompt}"\n`;
        finalResponse += `**Output:** ${imagePath}`;

        if (referenceImages.length > 0) {
          finalResponse += `\n**Reference Images:** ${referenceImages.length} image(s)`;
        }

        // Cost estimation
        const costEstimate = this.estimateCost(resolution);
        finalResponse += `\n\n💰 **Estimated Cost:** ~$${costEstimate.toFixed(3)}`;

        // Mode-specific details
        switch (mode) {
          case 'fusion':
            finalResponse += `\n\n**Fusion Details:** Blended ${referenceImages.length} images with advanced reasoning`;
            break;
          case 'consistency':
            finalResponse += `\n\n**Consistency Details:** Maintained character/style (supports up to 5 characters)`;
            break;
          case 'targeted_edit':
            finalResponse += `\n\n**Edit Details:** Applied precise localized modifications`;
            break;
          case 'template':
            finalResponse += `\n\n**Template Details:** Followed layout and structure from reference`;
            break;
        }

        finalResponse += `\n\n---\n_Powered by Nano Banana Pro (Gemini 3 Pro Image) via ${providerUsed === 'direct' ? 'Direct Gemini API' : 'OpenRouter'}_`;

        return {
          content: [
            {
              type: 'text',
              text: finalResponse,
            },
          ],
        };
      }

      throw new Error('No image data returned from Nano Banana Pro');

    } catch (error) {
      log(`Nano Banana Pro error: ${error.message}`, this.name);

      if (error.message.includes('Reference Image Error:')) {
        throw new Error(`${error.message}\n\nSupported formats: ${Object.keys(config.SUPPORTED_IMAGE_MIMES).join(', ')}`);
      } else if (error.message.includes('Mode') && error.message.includes('requires')) {
        throw new Error(`${error.message}\n\nNote: Fusion needs 2+ images, consistency/template need 1+`);
      } else {
        throw new Error(`Nano Banana Pro failed: ${error.message}`);
      }
    }
  }

  /**
   * Generates an image via direct Gemini REST API using File API URIs.
   * @param {string} prompt
   * @param {{uri: string, mimeType: string}[]} fileRefs
   * @returns {Promise<string>} base64 image data
   */
  async _generateDirect(prompt, fileRefs) {
    const parts = fileRefs.map(({ uri, mimeType }) => ({ fileData: { mimeType, fileUri: uri } }));
    parts.push({ text: prompt });

    const body = JSON.stringify({
      contents: [{ parts }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    });

    const result = await new Promise((resolve, reject) => {
      const req = https.request({
        host: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${config.API_KEY}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error(`Parse error: ${data.substring(0, 300)}`)); }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    if (result.error) {
      throw new Error(result.error.message || JSON.stringify(result.error));
    }

    const imagePart = result.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!imagePart) {
      throw new Error('No image in direct API response');
    }
    return imagePart.inlineData.data;
  }

  /**
   * Estimates the cost based on resolution.
   * Pricing: $0.139 for 1k/2k, $0.24 for 4k
   * @param {string} resolution - The output resolution
   * @returns {number} Estimated cost in USD
   */
  estimateCost(resolution) {
    switch (resolution) {
      case '4k':
        return 0.24;
      case '2k':
      case '1k':
      default:
        return 0.139;
    }
  }
}

module.exports = NanoBananaProTool;
