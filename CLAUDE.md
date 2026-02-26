# Gemini MCP Server (Forked)

Forked from [Garblesnarff/gemini-mcp-server](https://github.com/Garblesnarff/gemini-mcp-server). Cleaned up for personal use.

## Changes from upstream
- Hardcoded API keys stripped (config.js, wrapper script, test files)
- `gemini-file-upload` tool removed (security risk — reads any file, uploads to Google)
- Output directory changed to `~/Pictures/gemini-output/`
- Wrapper script reads API key from macOS Keychain

## Available Tools (9)

| Tool | What it does |
|------|-------------|
| `generate_image` | Text → image via Gemini 2.0 Flash |
| `gemini-edit-image` | Edit an existing image with text instructions |
| `advanced-image` | Advanced image gen (fusion, consistency, targeted edit, template modes) |
| `nano-banana-pro` | Pro image gen via OpenRouter (Gemini 3 Pro, up to 14 reference images, 4K) |
| `gemini-analyze-image` | Image analysis (summary, objects, text, detailed, custom) |
| `gemini-chat` | Chat with Gemini |
| `gemini-transcribe` | Audio transcription (MP3/WAV/FLAC/AAC/OGG/WEBM) |
| `gemini-code-execute` | Run Python in Gemini's sandbox (not local) |
| `gemini-analyze-video` | Video analysis (summary, transcript, objects, detailed, custom) |

## Auth
- `GEMINI_API_KEY` from Keychain: `security find-generic-password -s "gemini-api" -a "api_key" -w`
- Optional: `OPENROUTER_API_KEY` for `nano-banana-pro` tool (higher quality image gen)

## Key use cases
- **Eddie cover images**: `nano-banana-pro` with reference photos for brand consistency
- **PII detection**: `gemini-analyze-image` on screenshots → identify PII strings
- **Audio transcription**: `gemini-transcribe` for YouTube audio
- **Image editing**: `gemini-edit-image` for touch-ups

## Output
Generated images saved to `~/Pictures/gemini-output/` (configurable via `OUTPUT_DIR` env var).
