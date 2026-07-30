# File API Refactor — Drop OpenRouter for Image Gen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace OpenRouter as the primary image-generation path with a direct Gemini API call that passes reference images via the File API (upload once, reuse URI for 47hrs), cutting double-billing and O/R margin.

**Architecture:** Tools upload reference images to the Gemini File API once per file-mtime and cache the URI. Generation calls use `fileData` parts (URI) instead of `inlineData` (base64). OpenRouter becomes an opt-in fallback via `USE_OPENROUTER_FOR_ADVANCED_IMAGE=true`.

**Tech Stack:** Node.js `https` module (raw, matching existing O/R client pattern), `@google/generative-ai` SDK (already wired), `fs`/`crypto` (stdlib).

---

## File Map

| File | Change |
|------|--------|
| `src/config.js` | Add `GEMINI_FILE_API_UPLOAD_URL`, `GEMINI_MODELS.NANO_BANANA_PRO`; flip `USE_OPENROUTER_FOR_ADVANCED_IMAGE` default |
| `src/gemini/gemini-service.js` | Add imports; module-level `fileCache`; `uploadToFileApi`, `uploadOrReuse`, `generateNanaBananaProImageDirect`, `generateAdvancedImageDirect`, `listFiles`, `deleteFile` |
| `src/tools/nano-banana-pro.js` | Replace O/R-only flow with direct-first → O/R fallback |
| `src/tools/advanced-image.js` | Flip provider order: direct-first → O/R fallback |

---

## Task 1: Config constants and defaults

**Files:**
- Modify: `src/config.js`

- [ ] **Step 1: Add `GEMINI_FILE_API_UPLOAD_URL` constant**

After line 30 (`OPENROUTER_BASE_URL: ...`), insert:

```js
  /**
   * Gemini File API upload endpoint.
   * @type {string}
   */
  GEMINI_FILE_API_UPLOAD_URL: 'https://generativelanguage.googleapis.com/upload/v1beta/files',
```

- [ ] **Step 2: Flip `USE_OPENROUTER_FOR_ADVANCED_IMAGE` default to false**

Replace line 37:
```js
  USE_OPENROUTER_FOR_ADVANCED_IMAGE: process.env.USE_OPENROUTER_FOR_ADVANCED_IMAGE !== 'false',
```
With:
```js
  USE_OPENROUTER_FOR_ADVANCED_IMAGE: process.env.USE_OPENROUTER_FOR_ADVANCED_IMAGE === 'true',
```

Update the JSDoc comment on line 34 to read:
```js
  /**
   * Use OpenRouter for advanced image generation (fallback only).
   * Set USE_OPENROUTER_FOR_ADVANCED_IMAGE=true to force O/R path.
   * Defaults to false — direct Gemini API is used instead.
   * @type {boolean}
   */
```

- [ ] **Step 3: Add `NANO_BANANA_PRO` to `GEMINI_MODELS`**

After the `ADVANCED_IMAGE_GENERATION` block inside `GEMINI_MODELS` (after line 219 `},`), insert:

```js
    NANO_BANANA_PRO: {
      model: 'gemini-3-pro-image-preview',
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        temperature: 0.4,
        maxOutputTokens: 4096,
      },
    },
```

- [ ] **Step 4: Verify config loads cleanly**

```bash
cd ~/repos/gemini-mcp-server
node -e "const c = require('./src/config'); console.log(c.GEMINI_FILE_API_UPLOAD_URL, c.USE_OPENROUTER_FOR_ADVANCED_IMAGE, c.GEMINI_MODELS.NANO_BANANA_PRO.model)"
```

Expected output:
```
https://generativelanguage.googleapis.com/upload/v1beta/files false gemini-3-pro-image-preview
```

- [ ] **Step 5: Commit**

```bash
cd ~/repos/gemini-mcp-server
git add src/config.js
git commit -m "config: add File API URL, NBP model, flip advanced image default to direct"
```

---

## Task 2: File API helpers — upload, cache, list, delete

**Files:**
- Modify: `src/gemini/gemini-service.js` (top of file + inside class)

- [ ] **Step 1: Add missing imports at top of gemini-service.js**

Replace the current require block (lines 1-5):
```js
const { getGeminiClient } = require('./client');
const { getGeminiModelConfig } = require('./models');
const { formatTextPrompt, formatImagePrompt } = require('./request-handler');
const { extractTextContent, extractImageData } = require('./response-parser');
const { log } = require('../utils/logger');
```
With:
```js
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { getGeminiClient } = require('./client');
const { getGeminiModelConfig } = require('./models');
const { formatTextPrompt, formatImagePrompt } = require('./request-handler');
const { extractTextContent, extractImageData } = require('./response-parser');
const { log } = require('../utils/logger');
const config = require('../config');
```

- [ ] **Step 2: Add module-level fileCache after the require block**

After all require lines and before `class GeminiService`, insert:
```js
const fileCache = new Map();
```

- [ ] **Step 3: Add `uploadToFileApi` method inside the GeminiService class**

Insert before the closing `}` of the class (before line 388 `}`):

```js
  /**
   * Uploads a local file to the Gemini File API.
   * Returns the URI that can be passed as fileData.fileUri in generateContent calls.
   * @param {string} filePath - Absolute path to the file.
   * @param {string} mimeType - MIME type (e.g. 'image/jpeg').
   * @returns {Promise<{uri: string, mimeType: string}>}
   */
  async uploadToFileApi(filePath, mimeType) {
    const fileData = fs.readFileSync(filePath);
    const uploadUrl = new URL(`${config.GEMINI_FILE_API_UPLOAD_URL}?key=${config.API_KEY}`);

    return new Promise((resolve, reject) => {
      const options = {
        hostname: uploadUrl.hostname,
        path: uploadUrl.pathname + uploadUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': mimeType,
          'Content-Length': fileData.length,
          'X-Goog-Upload-Protocol': 'raw',
        },
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`File API upload failed (${res.statusCode}): ${body}`));
            return;
          }
          try {
            const parsed = JSON.parse(body);
            resolve({ uri: parsed.file.uri, mimeType });
          } catch (e) {
            reject(new Error(`File API upload response parse error: ${e.message}`));
          }
        });
      });
      req.on('error', reject);
      req.write(fileData);
      req.end();
    });
  }
```

- [ ] **Step 4: Add `uploadOrReuse` method**

Insert directly after `uploadToFileApi`:

```js
  /**
   * Uploads a file to the Gemini File API, or returns the cached URI if still valid.
   * Cache key is md5(filePath + mtime) — any file change busts the cache.
   * URIs are valid for 48hrs; cache entries expire after 47hrs.
   * @param {string} filePath - Absolute path to the file.
   * @param {string} mimeType - MIME type of the file.
   * @returns {Promise<{uri: string, mimeType: string}>}
   */
  async uploadOrReuse(filePath, mimeType) {
    const stats = fs.statSync(filePath);
    const hashKey = crypto.createHash('md5').update(`${filePath}:${stats.mtimeMs}`).digest('hex');

    const cached = fileCache.get(hashKey);
    if (cached && cached.expiresAt > Date.now()) {
      log(`File API cache hit: ${path.basename(filePath)}`, 'gemini-service');
      return { uri: cached.uri, mimeType: cached.mimeType };
    }

    log(`Uploading to File API: ${path.basename(filePath)}`, 'gemini-service');
    const result = await this.uploadToFileApi(filePath, mimeType);
    fileCache.set(hashKey, {
      uri: result.uri,
      mimeType: result.mimeType,
      expiresAt: Date.now() + 47 * 60 * 60 * 1000,
    });
    return result;
  }
```

- [ ] **Step 5: Add `listFiles` and `deleteFile` cleanup helpers**

Insert after `uploadOrReuse`:

```js
  /**
   * Lists all files currently in the Gemini File API for this API key.
   * @returns {Promise<Array>} Array of file objects.
   */
  async listFiles() {
    const listUrl = new URL(`https://generativelanguage.googleapis.com/v1beta/files?key=${config.API_KEY}`);
    return new Promise((resolve, reject) => {
      https.get({ hostname: listUrl.hostname, path: listUrl.pathname + listUrl.search }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(body).files || []); }
          catch (e) { reject(new Error(`File API list parse error: ${e.message}`)); }
        });
      }).on('error', reject);
    });
  }

  /**
   * Deletes a file from the Gemini File API.
   * @param {string} fileName - The file name in `files/<id>` format.
   * @returns {Promise<void>}
   */
  async deleteFile(fileName) {
    const deleteUrl = new URL(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${config.API_KEY}`);
    return new Promise((resolve, reject) => {
      const req = https.request(
        { hostname: deleteUrl.hostname, path: deleteUrl.pathname + deleteUrl.search, method: 'DELETE' },
        (res) => {
          let body = '';
          res.on('data', (chunk) => { body += chunk; });
          res.on('end', () => {
            if (res.statusCode !== 200 && res.statusCode !== 204) {
              reject(new Error(`File API delete failed (${res.statusCode}): ${body}`));
              return;
            }
            resolve();
          });
        }
      );
      req.on('error', reject);
      req.end();
    });
  }
```

- [ ] **Step 6: Smoke-test File API upload**

```bash
cd ~/repos/gemini-mcp-server
GEMINI_API_KEY=$(security find-generic-password -s "gemini-api" -a "api_key" -w) \
node -e "
const GeminiService = require('./src/gemini/gemini-service');
const svc = new GeminiService();
svc.uploadToFileApi('/Users/rorytan/Pictures/eddie-test.jpg', 'image/jpeg')
  .then(r => console.log('URI:', r.uri))
  .catch(e => console.error('FAIL:', e.message));
"
```

Expected: prints a URI like `https://generativelanguage.googleapis.com/v1beta/files/...`

If you don't have an eddie photo handy, use any jpeg from `~/Pictures/`.

- [ ] **Step 7: Commit**

```bash
cd ~/repos/gemini-mcp-server
git add src/gemini/gemini-service.js
git commit -m "gemini-service: add File API upload, URI cache, list/delete helpers"
```

---

## Task 3: Direct generation methods — NBP and advanced image

**Files:**
- Modify: `src/gemini/gemini-service.js` (inside class, after Task 2 additions)

- [ ] **Step 1: Add `generateNanaBananaProImageDirect` method**

Insert after `deleteFile` (still inside the class, before closing `}`):

```js
  /**
   * Generates an image using Nano Banana Pro (Gemini 3 Pro Image) directly via the Gemini API.
   * Reference images are provided as File API URIs (not base64).
   * @param {string} prompt - Text prompt (mode-specific content should already be in the prompt).
   * @param {Array<{uri: string, mimeType: string}>} fileUris - File API URIs for reference images.
   * @param {Object} [options] - Options (e.g., { mode, resolution }).
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
```

- [ ] **Step 2: Add `generateAdvancedImageDirect` method**

Insert directly after `generateNanaBananaProImageDirect`:

```js
  /**
   * Generates an advanced image using File API URIs instead of base64 inlineData.
   * Mirrors generateAdvancedImage() but uses fileData parts for reference images.
   * @param {string} modelType - Model config key (e.g., 'ADVANCED_IMAGE_GENERATION').
   * @param {string} prompt - Text prompt.
   * @param {Array<{uri: string, mimeType: string}>} fileUris - File API URIs.
   * @param {Object} [options] - Options (e.g., { mode }).
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
```

- [ ] **Step 3: Smoke-test NBP direct generation with pre-cached Eddie URIs**

```bash
cd ~/repos/gemini-mcp-server
GEMINI_API_KEY=$(security find-generic-password -s "gemini-api" -a "api_key" -w) \
node -e "
const GeminiService = require('./src/gemini/gemini-service');
const fs = require('fs');
const path = require('path');
const svc = new GeminiService();
const fileUris = [
  { uri: 'https://generativelanguage.googleapis.com/v1beta/files/alvjnrnl6y7r', mimeType: 'image/jpeg' },
  { uri: 'https://generativelanguage.googleapis.com/v1beta/files/72tvzhj3lq65', mimeType: 'image/jpeg' },
];
svc.generateNanaBananaProImageDirect('illustrated portrait of this dog, warm painterly style', fileUris, { mode: 'consistency' })
  .then(data => {
    const out = path.join(process.env.HOME, 'Pictures/gemini-output/test-direct.png');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(data, 'base64'));
    console.log('Saved to:', out);
  })
  .catch(e => console.error('FAIL:', e.message));
"
```

Expected: saves an image to `~/Pictures/gemini-output/test-direct.png`. If the pre-cached URIs have expired (>48hrs old), run Task 2 Step 6 first to upload fresh files.

- [ ] **Step 4: Commit**

```bash
cd ~/repos/gemini-mcp-server
git add src/gemini/gemini-service.js
git commit -m "gemini-service: add generateNanaBananaProImageDirect and generateAdvancedImageDirect"
```

---

## Task 4: Modify nano-banana-pro.js — direct-first with O/R fallback

**Files:**
- Modify: `src/tools/nano-banana-pro.js`

The current flow throws immediately if O/R is unavailable (lines 147-150). The new flow: always attempt direct Gemini API first; only fall back to O/R if direct fails.

- [ ] **Step 1: Remove the hard O/R availability gate**

Find and delete these lines (currently after the `enhancedPrompt` block, ~lines 147-150):
```js
      // Check if OpenRouter is available
      if (!openRouterService.isServiceAvailable()) {
        throw new Error('OpenRouter service is not available. Nano Banana Pro requires OpenRouter.');
      }
```

- [ ] **Step 2: Replace the O/R generation call with direct-first logic**

Find this block (currently ~lines 152-162):
```js
      // Generate image using Nano Banana Pro
      log('Generating image with Nano Banana Pro via OpenRouter', this.name);
      const imageData = await openRouterService.generateNanaBananaProImage(
        enhancedPrompt,
        referenceImages,
        {
          mode,
          resolution,
          aspect_ratio: aspectRatio,
        }
      );
```

Replace with:
```js
      // Upload reference images to File API (or reuse cached URIs)
      const fileUris = [];
      for (const imagePath of referenceImagePaths) {
        const mimeType = getMimeType(imagePath, config.SUPPORTED_IMAGE_MIMES);
        fileUris.push(await this.geminiService.uploadOrReuse(imagePath, mimeType));
      }

      // Try direct Gemini API first
      let imageData = null;
      let providerUsed = 'Gemini API (direct)';

      try {
        log('Generating image with Nano Banana Pro via direct Gemini API', this.name);
        imageData = await this.geminiService.generateNanaBananaProImageDirect(
          enhancedPrompt,
          fileUris,
          { mode, resolution }
        );
      } catch (directError) {
        log(`Direct Gemini API failed: ${directError.message}. Falling back to OpenRouter.`, this.name);

        if (!openRouterService.isServiceAvailable()) {
          throw new Error(`Nano Banana Pro failed: direct API error (${directError.message}) and OpenRouter is unavailable`);
        }

        log('Generating image with Nano Banana Pro via OpenRouter fallback', this.name);
        imageData = await openRouterService.generateNanaBananaProImage(
          enhancedPrompt,
          referenceImages,
          { mode, resolution, aspect_ratio: aspectRatio }
        );
        providerUsed = 'OpenRouter (fallback)';
      }
```

Note: `referenceImages` (base64 array built earlier in the method) is still available for the O/R fallback path.

- [ ] **Step 3: Update the response footer to show actual provider**

Find:
```js
        finalResponse += `\n\n---\n_Powered by Nano Banana Pro (Gemini 3 Pro Image) via OpenRouter_`;
```
Replace with:
```js
        finalResponse += `\n\n---\n_Powered by Nano Banana Pro (Gemini 3 Pro Image) via ${providerUsed}_`;
```

- [ ] **Step 4: Update the log message for successful generation**

Find:
```js
        log('Successfully generated Nano Banana Pro image', this.name);
```
Replace with:
```js
        log(`Successfully generated Nano Banana Pro image via ${providerUsed}`, this.name);
```

- [ ] **Step 5: Manual smoke test — direct path**

```bash
cd ~/repos/gemini-mcp-server
GEMINI_API_KEY=$(security find-generic-password -s "gemini-api" -a "api_key" -w) \
OPENROUTER_API_KEY=$(security find-generic-password -s "openrouter-api" -a "api_key" -w) \
node -e "
const NanaBananaProTool = require('./src/tools/nano-banana-pro');
const GeminiService = require('./src/gemini/gemini-service');
const IntelligenceSystem = { initialized: false };
const svc = new GeminiService();
const tool = new NanaBananaProTool(IntelligenceSystem, svc);
tool.execute({
  prompt: 'illustrated portrait of this dog, warm painterly style',
  mode: 'consistency',
  resolution: '1k',
  reference_images: [
    '/Users/rorytan/Pictures/PXL_20241224.jpg',
    '/Users/rorytan/Pictures/PXL_20241215.jpg',
  ],
}).then(r => console.log(r.content[0].text))
  .catch(e => console.error('FAIL:', e.message));
"
```

Expected: success message saying "via Gemini API (direct)".

Use any real photos from `~/Pictures/` — the exact Eddie photos from the brief's pre-cached URI section should work if you know their local paths.

- [ ] **Step 6: Smoke test — cache validation (second call should not re-upload)**

Run the same command again. Check logs: should print "File API cache hit" for each image instead of "Uploading to File API".

- [ ] **Step 7: Commit**

```bash
cd ~/repos/gemini-mcp-server
git add src/tools/nano-banana-pro.js
git commit -m "nano-banana-pro: flip to direct Gemini API, O/R becomes fallback"
```

---

## Task 5: Modify advanced-image.js — direct-first with O/R fallback

**Files:**
- Modify: `src/tools/advanced-image.js`

The current flow: O/R first → Gemini API fallback. New flow: direct Gemini (File API) first → O/R fallback if `USE_OPENROUTER_FOR_ADVANCED_IMAGE=true` or direct fails.

- [ ] **Step 1: Replace the generation block (lines ~140–184)**

Find this entire block:
```js
      // Try OpenRouter first if available, then fall back to Gemini API
      let imageData = null;
      let providerUsed = 'Gemini API';
      let openRouterError = null;

      if (openRouterService.isServiceAvailable()) {
        try {
          log('Attempting image generation with OpenRouter (free tier)', this.name);
          imageData = await openRouterService.generateAdvancedImage(
            'ADVANCED_IMAGE_GENERATION',
            enhancedPrompt,
            referenceImages,
            { mode }
          );
          providerUsed = 'OpenRouter (free)';
          log('Successfully generated image using OpenRouter', this.name);
        } catch (error) {
          openRouterError = error;
          log(`OpenRouter failed: ${error.message}. Falling back to Gemini API`, this.name);
        }
      }

      // Fall back to Gemini API if OpenRouter failed or is unavailable
      if (!imageData) {
        try {
          log('Using Gemini API for image generation', this.name);
          imageData = await this.geminiService.generateAdvancedImage(
            'ADVANCED_IMAGE_GENERATION',
            enhancedPrompt,
            referenceImages,
            { mode }
          );
          providerUsed = 'Gemini API';
        } catch (geminiError) {
          log(`Gemini API also failed: ${geminiError.message}`, this.name);
          
          // Create comprehensive error message
          let errorMessage = 'Advanced image generation failed on all available providers.';
          if (openRouterError) {
            errorMessage += ` OpenRouter: ${openRouterError.message}.`;
          }
          errorMessage += ` Gemini API: ${geminiError.message}`;
          
          throw new Error(errorMessage);
        }
      }
```

Replace with:
```js
      // Primary: Direct Gemini API with File API URIs
      let imageData = null;
      let providerUsed = null;
      let directError = null;

      try {
        const fileUris = [];
        for (const imagePath of referenceImagePaths) {
          const mimeType = getMimeType(imagePath, config.SUPPORTED_IMAGE_MIMES);
          fileUris.push(await this.geminiService.uploadOrReuse(imagePath, mimeType));
        }

        log('Using direct Gemini API for image generation', this.name);
        imageData = await this.geminiService.generateAdvancedImageDirect(
          'ADVANCED_IMAGE_GENERATION',
          enhancedPrompt,
          fileUris,
          { mode }
        );
        providerUsed = 'Gemini API (direct)';
        log('Successfully generated image using direct Gemini API', this.name);
      } catch (err) {
        directError = err;
        log(`Direct Gemini API failed: ${err.message}`, this.name);
      }

      // Fallback: OpenRouter (if env flag set or direct failed)
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
```

- [ ] **Step 2: Add `getMimeType` to the file-utils import**

Line 13 currently reads:
```js
const { ensureDirectoryExists, readFileAsBuffer, validateFileSize, getMimeType } = require('../utils/file-utils');
```

`getMimeType` is already imported. No change needed — verify it's there.

- [ ] **Step 3: Update the cost display in the response**

Find:
```js
        if (providerUsed.includes('OpenRouter')) {
          finalResponse += `\n\n💰 **Cost**: Free (via OpenRouter free tier)`;
        } else {
          finalResponse += `\n\n💰 **Cost**: ~$0.039 (via Gemini API)`;
        }
```
Replace with:
```js
        if (providerUsed === 'OpenRouter') {
          finalResponse += `\n\n💰 **Cost**: ~$0.039 (via OpenRouter)`;
        } else {
          finalResponse += `\n\n💰 **Cost**: ~$0.039 (via Gemini API direct)`;
        }
```

- [ ] **Step 4: Manual smoke test — direct path**

```bash
cd ~/repos/gemini-mcp-server
GEMINI_API_KEY=$(security find-generic-password -s "gemini-api" -a "api_key" -w) \
OPENROUTER_API_KEY=$(security find-generic-password -s "openrouter-api" -a "api_key" -w) \
node -e "
const AdvancedImageTool = require('./src/tools/advanced-image');
const GeminiService = require('./src/gemini/gemini-service');
const IntelligenceSystem = { initialized: false };
const svc = new GeminiService();
const tool = new AdvancedImageTool(IntelligenceSystem, svc);
tool.execute({
  prompt: 'a studio portrait of this dog with soft lighting',
  mode: 'consistency',
  reference_images: ['/Users/rorytan/Pictures/PXL_20241224.jpg'],
}).then(r => console.log(r.content[0].text))
  .catch(e => console.error('FAIL:', e.message));
"
```

Expected: success message saying "Gemini API (direct)".

- [ ] **Step 5: Smoke test — O/R fallback path**

```bash
cd ~/repos/gemini-mcp-server
GEMINI_API_KEY=$(security find-generic-password -s "gemini-api" -a "api_key" -w) \
OPENROUTER_API_KEY=$(security find-generic-password -s "openrouter-api" -a "api_key" -w) \
USE_OPENROUTER_FOR_ADVANCED_IMAGE=true \
node -e "
const AdvancedImageTool = require('./src/tools/advanced-image');
const GeminiService = require('./src/gemini/gemini-service');
const IntelligenceSystem = { initialized: false };
const svc = new GeminiService();
const tool = new AdvancedImageTool(IntelligenceSystem, svc);
tool.execute({
  prompt: 'a studio portrait of this dog with soft lighting',
  mode: 'standard',
}).then(r => console.log(r.content[0].text))
  .catch(e => console.error('FAIL:', e.message));
"
```

Expected: success message saying "OpenRouter" (because flag is set, O/R is tried; or direct succeeds first since there are no reference images to upload — either way, image is generated).

- [ ] **Step 6: Commit**

```bash
cd ~/repos/gemini-mcp-server
git add src/tools/advanced-image.js
git commit -m "advanced-image: flip to direct Gemini API primary, O/R becomes env-flag fallback"
```

---

## Task 6: Security review (CR checklist from brief)

**Files:** Read-only review, no changes unless issues found.

- [ ] **Step 1: Verify path sanitization**

In `gemini-service.js`, `uploadToFileApi` calls `fs.readFileSync(filePath)` with the path passed in. Both calling tools (`nano-banana-pro.js` line 102, `advanced-image.js` line 83) already validate:
- `path.isAbsolute(imagePath)` — rejects relative paths
- `fs.existsSync(imagePath)` — rejects non-existent paths
- `validateFileSize(imagePath, config.MAX_IMAGE_SIZE_MB)` — rejects oversized files

Additionally, `uploadOrReuse` receives paths that have already cleared these gates. Confirm the `getMimeType` call (in the tool loops) does not accept extensions outside `config.SUPPORTED_IMAGE_MIMES` — if mimeType resolution throws for unknown extensions, that's a safe failure.

Grep check:
```bash
cd ~/repos/gemini-mcp-server
grep -n "getMimeType" src/utils/file-utils.js
```
Read the `getMimeType` implementation and confirm it throws (not returns `undefined`) on unknown extensions.

- [ ] **Step 2: Verify API key is not logged**

Grep for any accidental key logging:
```bash
cd ~/repos/gemini-mcp-server
grep -n "API_KEY\|api_key\|config\.API" src/gemini/gemini-service.js
```

Expected: the only occurrences should be inside URL construction (`config.GEMINI_FILE_API_UPLOAD_URL?key=${config.API_KEY}`) and the `deleteFile` URL. Confirm none of these strings are passed to `log()`.

- [ ] **Step 3: Verify error messages don't leak the key**

In `uploadToFileApi`, the rejection message is:
```
`File API upload failed (${res.statusCode}): ${body}`
```
The API response body from Google does not echo back the key. Confirm `options.path` (which contains the key as a query param) is not included in any error message.

- [ ] **Step 4: Verify single-user assumption is documented**

The `fileCache` Map is process-global — URI expiry is tied to process lifetime, not individual user session. This is safe for single-user personal use (the existing server model). Add a comment to the `fileCache` declaration:

```js
// Process-global URI cache. Safe for single-user personal deployment only.
// Multi-user deployments should scope this cache per user session.
const fileCache = new Map();
```

- [ ] **Step 5: Commit security notes**

```bash
cd ~/repos/gemini-mcp-server
git add src/gemini/gemini-service.js
git commit -m "docs: add single-user cache scope comment per security review"
```

---

## Final validation

- [ ] **Restart MCP server and run end-to-end via MCP**

Restart the gemini MCP server (restart Claude Code or `/mcp`), then fire the tool via MCP:

```
mcp__gemini__gemini-nano-banana-pro({
  prompt: "illustrated portrait of this dog",
  reference_images: ["/path/to/eddie1.jpg", "/path/to/eddie2.jpg"],
  resolution: "1k",
  mode: "consistency"
})
```

Check the response: should say "via Gemini API (direct)".

- [ ] **Confirm cache works across two calls**

Run the same MCP call again. Server logs should show "File API cache hit" for both images.

- [ ] **Confirm O/R fallback still works**

Set `USE_OPENROUTER_FOR_ADVANCED_IMAGE=true` in the MCP server env, restart, run `gemini-advanced-image`. Response should say "OpenRouter".
