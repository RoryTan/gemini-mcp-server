/**
 * Gemini File API — upload images once, reuse URIs within session.
 * In-memory cache keyed by file path. TTL matches Google's 48hr expiry minus 1hr buffer.
 *
 * SECURITY NOTE (for forks): uploadFile() delegates to readFileAsBuffer() which enforces
 * ALLOW_UNRESTRICTED_FILE_ACCESS / ALLOWED_DIRS. No additional path checks needed here.
 */

const https = require('https');
const path = require('path');
const { log } = require('../utils/logger');
const config = require('../config');
const { readFileAsBuffer, getMimeType } = require('../utils/file-utils');

// Process-global URI cache. Safe for single-user personal deployment only.
// Multi-user deployments should scope this cache per user session.
const _cache = new Map(); // filePath → { uri, mimeType, expiresAt }
const TTL_MS = 47 * 60 * 60 * 1000; // 47hr (48hr Google TTL - 1hr buffer)

function _httpsPost(host, urlPath, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host, path: urlPath, method: 'POST', headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`File API parse error: ${data.substring(0, 300)}`)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Uploads a file to Gemini File API and caches the URI for 47hrs.
 * Returns cached URI if still valid — no re-upload within session.
 *
 * @param {string} filePath - Absolute path to the image file.
 * @returns {Promise<{uri: string, mimeType: string}>}
 */
async function uploadFile(filePath) {
  const cached = _cache.get(filePath);
  if (cached && cached.expiresAt > Date.now()) {
    log(`File API cache hit: ${path.basename(filePath)}`, 'file-api');
    return { uri: cached.uri, mimeType: cached.mimeType };
  }

  const buffer = readFileAsBuffer(filePath);
  const mimeType = getMimeType(filePath, config.SUPPORTED_IMAGE_MIMES);

  log(`Uploading to File API: ${path.basename(filePath)} (${(buffer.length / 1024).toFixed(1)}KB)`, 'file-api');

  const result = await _httpsPost(
    'generativelanguage.googleapis.com',
    `/upload/v1beta/files?key=${config.API_KEY}`,
    { 'Content-Type': mimeType, 'Content-Length': buffer.length },
    buffer,
  );

  if (!result.file || !result.file.uri) {
    throw new Error(`File API upload failed: ${JSON.stringify(result).substring(0, 300)}`);
  }

  const uri = result.file.uri;
  _cache.set(filePath, { uri, mimeType, expiresAt: Date.now() + TTL_MS });
  log(`Uploaded: ${path.basename(filePath)} → ${uri}`, 'file-api');
  return { uri, mimeType };
}

/** Clears the URI cache — call if you need to force re-upload. */
function clearCache() {
  _cache.clear();
  log('File API cache cleared', 'file-api');
}

module.exports = { uploadFile, clearCache };
