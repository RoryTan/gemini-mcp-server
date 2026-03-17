**BEFORE ANY WORK:** Read `CLAUDE.md` first.

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
| `gemini-analyze-video` | Video analysis (summary, transcript, objects, detailed, charts, custom) — supports local files, pre-uploaded URIs, and YouTube URLs natively |

## Auth
- `GEMINI_API_KEY` from Keychain: `security find-generic-password -s "gemini-api" -a "api_key" -w`
- Optional: `OPENROUTER_API_KEY` for `nano-banana-pro` tool (higher quality image gen)

## Key use cases
- **Eddie cover images**: `nano-banana-pro` with reference photos for brand consistency
- **PII detection**: `gemini-analyze-image` on screenshots → identify PII strings
- **Audio transcription**: `gemini-transcribe` for YouTube audio
- **Image editing**: `gemini-edit-image` for touch-ups
- **YouTube chart/data extraction**: `gemini-analyze-video` with `youtube_url` + `analysis_type: "charts"` → returns structured JSON of every chart, table, and data visualization in the video. No download or yt-dlp required — Gemini processes YouTube URLs natively.

## Output
Generated images saved to `~/Pictures/gemini-output/` (configurable via `OUTPUT_DIR` env var).

## Security Notes (for forks)
- **Unrestricted file read (accepted risk for personal use):** All tools that accept `file_path` or `reference_images` will read any file on the filesystem and send it to Google's Gemini API. This is intentional for a single-user personal tool — you need to reference files anywhere on your machine. **If you fork this for multi-user or networked deployment, add path allowlisting in `src/utils/file-utils.js:readFileAsBuffer()` to prevent arbitrary file exfiltration.**
- **OpenRouter key in debug logs:** If `DEBUG_ADVANCED_IMAGE=true`, the `Authorization` header (containing the OpenRouter API key) is logged to stderr. Redact before logging if you enable debug mode in a shared environment.
