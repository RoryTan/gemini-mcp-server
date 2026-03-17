# Changelog

Changes from the fork point (`0a3cc46`) onwards. Upstream history preserved in git.

---

## [Unreleased] — 2026-03-17

### Fixed
- Stale tool descriptions: `generate_image` and `gemini-advanced-image` now correctly state Gemini 3.1 Flash Image (Nano Banana 2) rather than 2.0/2.5
- Video analysis log line printed `"undefined"` when `youtube_url` was used — now logs correctly
- `analyzeVideo` and `analyzeVideoFromUri` in `gemini-service.js` were not passing `generationConfig` to the API
- All URI-based methods (`analyzeVideoFromUri`, `analyzeImageFromUri`, `transcribeAudioFromUri`) used snake_case `file_data`/`mime_type`/`file_uri` — standardized to camelCase (`fileData`/`mimeType`/`fileUri`) to match JS SDK convention

### Added
- `docs/architecture.md` — Mermaid diagrams for tool dispatch, auth flow, YouTube chart extraction, file I/O, and image generation paths

### Removed
- `bin/` — upstream npm CLI wizard (not used; we run via wrapper script)
- `scripts/` — upstream intelligence system tooling (inspect-preferences, migrate-preferences, clean-data)
- `examples/` — Claude Desktop config examples (not relevant; we use Claude Code + Keychain)
- `templates/` — upstream wrapper template with plaintext API key

### Updated
- `.env.example` — corrected output dir default, added `OPENROUTER_API_KEY`, `ALLOW_UNRESTRICTED_FILE_ACCESS`, `ALLOWED_DIRS`, `DEBUG_ADVANCED_IMAGE`
- `README.md` — expanded to cover all use cases (video watching, transcription, image analysis, image gen)

---

## [1.1.0] — 2026-03-17 (commit `41d87b5`)

### Added
- `gemini-analyze-video`: `youtube_url` parameter — analyze YouTube videos natively, no download required
- `gemini-analyze-video`: `charts` analysis type — extracts every chart, table, and data visualization as structured JSON (timestamp, type, axes, series, data values, notes)

### Changed
- All image generation tools (`generate_image`, `gemini-edit-image`, `gemini-advanced-image`) upgraded from Gemini 2.0/2.5 to `gemini-3.1-flash-image-preview` (Nano Banana 2)
- OpenRouter advanced image model updated to `google/gemini-3.1-flash-image-preview`

### Fixed
- `server.js`: double-parse bug where request body was parsed twice
- `gemini/client.js`: removed API key prefix from startup log
- `src/utils/file-utils.js`: added configurable path containment via `ALLOW_UNRESTRICTED_FILE_ACCESS` + `ALLOWED_DIRS`

### Removed
- ~25 junk files from root: restore scripts, test files, test audio, upstream doc files
- `src/tools/video-analysis.original.js` backup file
- `src/gemini/file-api/` directory (upstream file upload service, removed for security)

---

## [1.0.0] — 2026-02-26 (commit `0a3cc46`)

### Fork baseline from [Garblesnarff/gemini-mcp-server](https://github.com/Garblesnarff/gemini-mcp-server)

### Changed
- Hardcoded API keys stripped from `config.js`, wrapper script, and test files
- `gemini-wrapper.sh` rewritten to read `GEMINI_API_KEY` from macOS Keychain
- Output directory changed from `~/Claude/gemini-images` to `~/Pictures/gemini-output`
- Upstream CI workflow removed

### Removed
- `src/tools/file-upload.js` (`gemini-file-upload` tool) — reads arbitrary files and uploads to Google; removed as a security risk for personal use
