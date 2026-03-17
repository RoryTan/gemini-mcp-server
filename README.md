# claude-couch-potato 🛋️

Gemini as Claude's eyes and ears. Watch YouTube videos, extract charts, transcribe audio, analyze images, and generate/edit images — all without leaving Claude Code.

Forked from [Garblesnarff/gemini-mcp-server](https://github.com/Garblesnarff/gemini-mcp-server). Hardened for personal use — keys stripped, file-upload removed, macOS Keychain auth.

## What it does

**Watching stuff**
- Point it at any YouTube URL — get a summary, full transcript, or extract every chart and data visualization as structured JSON
- Works on local video files too (MP4, MOV, AVI, WEBM, MKV — up to 100MB)
- No yt-dlp, no download — Gemini fetches YouTube natively

**Listening**
- Transcribe audio files: MP3, WAV, FLAC, AAC, OGG, WEBM, M4A
- Optional prompt to guide transcription style (verbatim, speaker labels, etc.)

**Looking at images**
- Analyze images: describe, extract text, detect objects, find PII
- Custom prompts for anything else

**Making images**
- Text → image (`generate_image`, `gemini-advanced-image`)
- Edit an existing image with a text instruction (`gemini-edit-image`)
- High-consistency generation with reference images — great for brand/character consistency (`gemini-advanced-image` up to 8 refs, `nano-banana-pro` up to 14 refs at up to 4K)

**Other**
- Chat with Gemini directly (`gemini-chat`)
- Run Python in Gemini's sandbox, not local (`gemini-code-execute`)

## Tools

| Tool | Input | What it does |
|------|-------|-------------|
| `gemini-analyze-video` | YouTube URL or local file | Summary, transcript, objects, charts/tables as JSON, or custom prompt |
| `gemini-analyze-image` | Local image file | Objects, text extraction, PII detection, or custom |
| `gemini-transcribe` | Local audio file | Transcription, optionally guided by a prompt |
| `generate_image` | Text prompt | Text → image (Nano Banana 2) |
| `gemini-edit-image` | Image + instruction | Edit an image with a text instruction |
| `gemini-advanced-image` | Prompt + up to 8 ref images | Multi-image fusion, character/style consistency |
| `nano-banana-pro` | Prompt + up to 14 ref images | Highest quality image gen, up to 4K (needs OpenRouter key) |
| `gemini-chat` | Text | Chat with Gemini |
| `gemini-code-execute` | Python code | Run Python in Gemini's sandbox |

## Setup (macOS)

**1. Get a Gemini API key** from [Google AI Studio](https://aistudio.google.com) and store it:
```bash
security add-generic-password -s "gemini-api" -a "api_key" -w "YOUR_KEY_HERE"
```

**2. Clone and install:**
```bash
git clone https://github.com/RoryTan/gemini-mcp-server.git
cd gemini-mcp-server
npm install
```

**3. Wire into Claude Code** — add to your MCP config:
```json
{
  "mcpServers": {
    "gemini": {
      "command": "/absolute/path/to/gemini-mcp-server/gemini-wrapper.sh"
    }
  }
}
```

**4. Restart Claude Code.** Tools appear automatically.

## Use cases

### Watch a YouTube video and extract all charts
```
gemini-analyze-video
  youtube_url: "https://www.youtube.com/watch?v=..."
  analysis_type: "charts"
```
Returns a JSON array — one object per chart with timestamp, type, axes, series, data values, and notes. Run `charts` + `transcript` separately for full coverage: charts gets the visual data, transcript gets the spoken reasoning.

### Get a full transcript
```
gemini-analyze-video
  youtube_url: "https://www.youtube.com/watch?v=..."
  analysis_type: "transcript"
```

### Transcribe an audio file
```
gemini-transcribe
  file_path: "/path/to/recording.mp3"
```

### Generate an image with reference photos for consistency
```
gemini-advanced-image
  prompt: "Eddie the dog sitting in a park, golden hour"
  reference_images: ["/photos/eddie1.jpg", "/photos/eddie2.jpg"]
  mode: "consistency"
```

### Detect PII in a screenshot
```
gemini-analyze-image
  file_path: "/path/to/screenshot.png"
  analysis_type: "custom"
  custom_prompt: "List all personally identifiable information visible in this image"
```

## Models

| Tools | Model |
|-------|-------|
| `generate_image`, `gemini-edit-image`, `gemini-advanced-image` | `gemini-3.1-flash-image-preview` (Nano Banana 2) |
| `gemini-analyze-video`, `gemini-analyze-image`, `gemini-transcribe`, `gemini-chat`, `gemini-code-execute` | `gemini-2.5-flash` |
| `nano-banana-pro` | `google/gemini-3-pro-image-preview` via OpenRouter |

## Optional: OpenRouter key (for nano-banana-pro)

```bash
security add-generic-password -s "openrouter-api" -a "api_key" -w "YOUR_KEY_HERE"
```

## Security note for forks

By default, file-reading tools accept any path on the filesystem and send contents to Google's Gemini API. Fine for single-user personal use. For multi-user deployments:

```bash
ALLOW_UNRESTRICTED_FILE_ACCESS=false
ALLOWED_DIRS=/your/uploads/dir
```

See `src/utils/file-utils.js` and `.env.example`.
