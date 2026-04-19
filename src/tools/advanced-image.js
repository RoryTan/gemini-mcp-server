/**
 * Advanced Image Tool for Gemini MCP Server.
 * Uses Gemini 3.1 Flash Image (Nano Banana 2) for multi-image fusion, character consistency, and targeted editing.
 *
 * @author Claude + Rob
 */

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const BaseTool = require('./base-tool');
const { log } = require('../utils/logger');
const { ensureDirectoryExists, readFileAsBuffer, validateFileSize, getMimeType } = require('../utils/file-utils');
const { validateNonEmptyString, validateString, validateArray } = require('../utils/validation');
const config = require('../config');
const openRouterService = require('../openrouter/openrouter-service');
const fileApi = require('../gemini/file-api');

class AdvancedImageTool extends BaseTool {
  constructor(intelligenceSystem, geminiService) {
    super(
      'gemini-advanced-image',
      'Generate advanced images with Gemini 3.1 Flash Image (Nano Banana 2): multi-image fusion, character consistency, targeted editing, and template adherence',
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
            description: 'Generation mode: fusion (blend multiple images), consistency (maintain character/style), targeted_edit (precise edits), template (follow layout), standard (basic generation)',
          },
          reference_images: {
            type: 'array',
            items: {
              type: 'string',
            },
            description: 'Optional array of file paths to reference images for fusion, consistency, or template modes',
          },
          context: {
            type: 'string',
            description: 'Optional context for intelligent enhancement (e.g., "fusion", "consistency", "artistic")',
          },
        },
        required: ['prompt'],
      },
      intelligenceSystem,
      geminiService,
    );
  }

  /**
   * Executes the advanced image generation tool.
   * @param {Object} args - The arguments for the tool.
   * @param {string} args.prompt - The text description or editing instruction.
   * @param {string} [args.mode='standard'] - The generation mode.
   * @param {string[]} [args.reference_images] - Array of file paths to reference images.
   * @param {string} [args.context] - Optional context for intelligent enhancement.
   * @returns {Promise<Object>} A promise that resolves to the tool's result.
   */
  async execute(args) {
    const prompt = validateNonEmptyString(args.prompt, 'prompt');
    const mode = args.mode || 'standard';
    const referenceImagePaths = args.reference_images || [];
    const context = args.context ? validateString(args.context, 'context') : null;

    log(`Generating advanced image with mode: "${mode}", prompt: "${prompt}", context: ${context || 'general'}`, this.name);

    try {
      // Validate reference images if provided
      const referenceImages = [];
      if (referenceImagePaths.length > 0) {
        log(`Processing ${referenceImagePaths.length} reference images for fusion mode`, this.name);
        
        for (let i = 0; i < referenceImagePaths.length; i++) {
          const imagePath = referenceImagePaths[i];
          log(`Processing reference image ${i + 1}/${referenceImagePaths.length}: ${imagePath}`, this.name);
          
          try {
            // Check if file path is absolute
            if (!path.isAbsolute(imagePath)) {
              throw new Error(`File path must be absolute, got relative path: ${imagePath}`);
            }
            
            // Check file existence before attempting operations
            if (!fs.existsSync(imagePath)) {
              throw new Error(`Reference image file not found: ${imagePath}`);
            }
            
            // Validate file size
            log(`Validating file size for: ${imagePath}`, this.name);
            validateFileSize(imagePath, config.MAX_IMAGE_SIZE_MB);
            
            // Read file as buffer
            log(`Reading file as buffer: ${imagePath}`, this.name);
            const imageBuffer = readFileAsBuffer(imagePath);
            
            // Get MIME type
            log(`Determining MIME type for: ${imagePath}`, this.name);
            const mimeType = getMimeType(imagePath, config.SUPPORTED_IMAGE_MIMES);
            
            referenceImages.push({
              data: imageBuffer.toString('base64'),
              mimeType,
            });
            
            log(`✓ Successfully loaded reference image ${i + 1}: ${imagePath} (${(imageBuffer.length / 1024).toFixed(2)}KB, ${mimeType})`, this.name);
          } catch (fileError) {
            const detailedError = `Failed to process reference image ${i + 1} (${imagePath}): ${fileError.message}`;
            log(detailedError, this.name);
            throw new Error(`Reference Image Error: ${detailedError}`);
          }
        }
        
        log(`✓ Successfully processed all ${referenceImages.length} reference images`, this.name);
      }

      // Validate mode requirements
      if (['fusion', 'consistency', 'template'].includes(mode) && referenceImages.length === 0) {
        throw new Error(`Mode "${mode}" requires at least one reference image`);
      }

      if (mode === 'fusion' && referenceImages.length < 2) {
        throw new Error('Fusion mode requires at least 2 reference images');
      }

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

      // Primary: direct Gemini API with File API URIs (no base64, no O/R margin)
      let imageData = null;
      let providerUsed = 'Gemini API (direct)';
      let directError = null;

      try {
        const fileUris = [];
        for (const imagePath of referenceImagePaths) {
          fileUris.push(await fileApi.uploadFile(imagePath));
        }

        log('Using direct Gemini API for image generation', this.name);
        imageData = await this.geminiService.generateAdvancedImageDirect(
          'ADVANCED_IMAGE_GENERATION',
          enhancedPrompt,
          fileUris,
          { mode }
        );
        log('Successfully generated image using direct Gemini API', this.name);
      } catch (err) {
        directError = err;
        log(`Direct Gemini API failed: ${err.message}`, this.name);
      }

      // Fallback: OpenRouter — used when env flag set or direct API failed
      if (!imageData && (config.USE_OPENROUTER_FOR_ADVANCED_IMAGE || directError) && openRouterService.isServiceAvailable()) {
        try {
          log('Falling back to OpenRouter for image generation', this.name);
          imageData = await openRouterService.generateAdvancedImage(
            'ADVANCED_IMAGE_GENERATION',
            enhancedPrompt,
            referenceImages,
            { mode }
          );
          providerUsed = 'OpenRouter';
          log('Successfully generated image using OpenRouter', this.name);
        } catch (orError) {
          let errorMessage = 'Advanced image generation failed on all providers.';
          if (directError) errorMessage += ` Gemini direct: ${directError.message}.`;
          errorMessage += ` OpenRouter: ${orError.message}`;
          throw new Error(errorMessage);
        }
      }

      if (!imageData) {
        let errorMessage = 'Advanced image generation failed.';
        if (directError) errorMessage += ` Gemini direct: ${directError.message}.`;
        if (!openRouterService.isServiceAvailable()) errorMessage += ' OpenRouter is also unavailable.';
        throw new Error(errorMessage);
      }

      if (imageData) {
        log('Successfully extracted advanced image data', this.name);

        ensureDirectoryExists(config.OUTPUT_DIR, this.name);

        const timestamp = Date.now();
        const hash = crypto.createHash('md5').update(prompt + mode).digest('hex');
        const providerPrefix = providerUsed.includes('OpenRouter') ? 'openrouter' : 'gemini';
        const imageName = `${providerPrefix}-advanced-${mode}-${hash}-${timestamp}.png`;
        const imagePath = path.join(config.OUTPUT_DIR, imageName);

        fs.writeFileSync(imagePath, Buffer.from(imageData, 'base64'));
        log(`Advanced image saved to: ${imagePath}`, this.name);

        if (this.intelligenceSystem.initialized) {
          try {
            const resultDescription = `Advanced image generated (${mode} mode): ${imagePath}. Reference images: ${referenceImagePaths.length}`;
            await this.intelligenceSystem.learnFromInteraction(
              prompt,
              enhancedPrompt,
              resultDescription,
              context || mode,
              this.name
            );
            log('Tool Intelligence learned from interaction', this.name);
          } catch (err) {
            log(`Tool Intelligence learning failed: ${err.message}`, this.name);
          }
        }

        let finalResponse = `✓ Advanced image successfully generated using ${providerUsed}\n\n**Mode:** ${mode}\n**Prompt:** "${prompt}"\n**Output:** ${imagePath}`;
        
        if (referenceImages.length > 0) {
          finalResponse += `\n**Reference Images:** ${referenceImagePaths.length} image(s)`;
        }

        if (context && this.intelligenceSystem.initialized) {
          finalResponse += `\n\n---\n_Enhancement applied based on context: ${context}_`;
        }

        // Add provider information
        if (providerUsed === 'OpenRouter') {
          finalResponse += `\n\n💰 **Cost**: ~$0.039 (via OpenRouter)`;
        } else {
          finalResponse += `\n\n💰 **Cost**: ~$0.039 (via Gemini API direct)`;
        }

        // Add mode-specific information
        switch (mode) {
          case 'fusion':
            finalResponse += `\n\n**Fusion Details:** Blended ${referenceImages.length} images into a cohesive result`;
            break;
          case 'consistency':
            finalResponse += `\n\n**Consistency Details:** Maintained character/style from reference images`;
            break;
          case 'targeted_edit':
            finalResponse += `\n\n**Edit Details:** Applied precise, targeted modifications`;
            break;
          case 'template':
            finalResponse += `\n\n**Template Details:** Followed layout and structure from reference`;
            break;
        }

        return {
          content: [
            {
              type: 'text',
              text: finalResponse,
            },
          ],
        };
      }
      
      log('No image data found in advanced image response', this.name);
      return {
        content: [
          {
            type: 'text',
            text: `Could not generate advanced image with mode "${mode}" for prompt: "${prompt}". No image data was returned by Gemini 2.5 Flash Image API.`,
          },
        ],
      };
    } catch (error) {
      log(`Error generating advanced image: ${error.message}`, this.name);
      
      // Categorize errors for better user feedback
      if (error.message.includes('Reference Image Error:')) {
        // File processing error - provide helpful guidance
        throw new Error(`${error.message}\n\nTroubleshooting:\n• Ensure all file paths are absolute (start with /)\n• Verify files exist and are readable\n• Check file formats are supported: ${Object.keys(config.SUPPORTED_IMAGE_MIMES).join(', ')}`);
      } else if (error.message.includes('Mode') && error.message.includes('requires')) {
        // Mode validation error
        throw new Error(`${error.message}\n\nNote: Fusion mode requires at least 2 reference images, consistency/template modes require at least 1.`);
      } else {
        // API or other errors - preserve original message but add context
        throw new Error(`Advanced image generation failed: ${error.message}\n\nIf this is a repeated error, try using standard mode without reference images.`);
      }
    }
  }
}

module.exports = AdvancedImageTool;