/**
 * Utility functions for file operations.
 *
 * @author Cline
 */

const fs = require('fs');
const path = require('path');
const { log } = require('./logger');
const config = require('../config');

/**
 * Ensures that a directory exists. If it doesn't, it creates it recursively.
 * @param {string} dirPath - The path to the directory.
 * @param {string} [moduleName='file-utils'] - The name of the module calling this function for logging.
 */
function ensureDirectoryExists(dirPath, moduleName = 'file-utils') {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    log(`Created directory: ${dirPath}`, moduleName);
  }
}

/**
 * Reads a file and returns its content as a Buffer.
 *
 * SECURITY NOTE (for forks): This function accepts any file path with no directory
 * allowlisting. For a single-user personal tool this is intentional — the user
 * controls all inputs and needs to reference files anywhere on their filesystem.
 * If you are forking this for a multi-user or networked deployment, you SHOULD
 * add path containment here (e.g. restrict to specific directories) to prevent
 * arbitrary file exfiltration to the Gemini API.
 *
 * @param {string} filePath - The path to the file.
 * @returns {Buffer} The content of the file.
 * @throws {Error} If the file does not exist or cannot be read.
 */
function readFileAsBuffer(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  if (!config.ALLOW_UNRESTRICTED_FILE_ACCESS) {
    const resolved = path.resolve(filePath);
    const allowed = config.ALLOWED_DIRS.some(dir => resolved.startsWith(path.resolve(dir)));
    if (!allowed) {
      throw new Error(`File access denied: "${resolved}" is outside the allowed directories. Set ALLOW_UNRESTRICTED_FILE_ACCESS=true or add the directory to ALLOWED_DIRS.`);
    }
  }
  return fs.readFileSync(filePath);
}

/**
 * Validates the size of a file against a maximum allowed size.
 * @param {string} filePath - The path to the file.
 * @param {number} maxSizeMB - The maximum allowed size in megabytes.
 * @throws {Error} If the file exceeds the maximum size.
 */
function validateFileSize(filePath, maxSizeMB) {
  const stats = fs.statSync(filePath);
  const maxSize = maxSizeMB * 1024 * 1024; // Convert MB to bytes
  if (stats.size > maxSize) {
    throw new Error(`File too large. Maximum size is ${maxSizeMB}MB, file is ${(stats.size / 1024 / 1024).toFixed(2)}MB`);
  }
}

/**
 * Determines the MIME type of a file based on its extension.
 * @param {string} filePath - The path to the file.
 * @param {Object.<string, string>} supportedMimes - An object mapping extensions to MIME types.
 * @returns {string} The determined MIME type.
 * @throws {Error} If the file extension is not supported.
 */
function getMimeType(filePath, supportedMimes) {
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = supportedMimes[extension];
  if (!mimeType) {
    throw new Error(`Unsupported file format: ${extension}. Supported formats: ${Object.keys(supportedMimes).map((ext) => ext.substring(1).toUpperCase()).join(', ')}`); // eslint-disable-line max-len
  }
  return mimeType;
}

module.exports = {
  ensureDirectoryExists,
  readFileAsBuffer,
  validateFileSize,
  getMimeType,
};
