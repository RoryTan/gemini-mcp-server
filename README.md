# claude-couch-potato 🛋️

MCP server that lets Claude watch YouTube videos, analyze images, transcribe audio, and generate images — powered by Gemini.

Forked from [Garblesnarff/gemini-mcp-server](https://github.com/Garblesnarff/gemini-mcp-server). Hardened for personal use — keys stripped, file-upload removed, macOS Keychain auth.

## Tools

| Tool | What it does |
|------|-------------|
| `gemini-analyze-video` | Watch a YouTube video or local file. Extract charts/tables as JSON, get a transcript, summarize, or run a custom prompt against it. |
| `gemini-analyze-image` | Analyze an image — objects, text, PII detection, custom. |
| `generate_image` | Text → image. |
| `gemini-edit-image` | Edit an image with a text instruction. |
| `advanced-image` | Image gen with reference images for style/character consistency. |
| `nano-banana-pro` | Higher quality image gen via OpenRouter (requires separate key). |
| `gemini-transcribe` | Transcribe audio files (MP3, WAV, FLAC, AAC, OGG, WEBM). |
| `gemini-chat` | Chat with Gemini directly. |
| `gemini-code-execute` | Run Python in Gemini's sandbox (not local). |

## Setup (macOS)

**1. Get a Gemini API key** from [Google AI Studio](https://aistudio.google.com) and store it:
```bash
security add-generic-password -s "gemini-api" -a "api_key" -w "YOUR_KEY_HERE"
```

**2. Clone the repo and install:**
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

## YouTube chart extraction

The main use case — point it at a YouTube video and pull every chart, table, and data visualization as structured JSON:

```
Use gemini-analyze-video with:
  youtube_url: "https://www.youtube.com/watch?v=..."
  analysis_type: "charts"
```

Returns a JSON array — one object per chart found, with timestamp, type, axes, data values, and notes. No download required, Gemini processes YouTube natively.

For full coverage run `charts` + `transcript` separately and merge: charts gets the visual data, transcript gets the spoken reasoning.

## Models

| Tools | Model |
|-------|-------|
| `generate_image`, `gemini-edit-image`, `advanced-image` | `gemini-3.1-flash-image-preview` (Nano Banana 2) |
| Everything else | `gemini-2.5-flash` |
| `nano-banana-pro` | `google/gemini-3-pro-image-preview` via OpenRouter |

## Security note for forks

By default, file-reading tools accept any path on the filesystem and send contents to Google's Gemini API. Fine for single-user personal use. For multi-user deployments set:

```bash
ALLOW_UNRESTRICTED_FILE_ACCESS=false
ALLOWED_DIRS=/your/uploads/dir
```

See `src/utils/file-utils.js`.

## Optional: OpenRouter key (for nano-banana-pro)

```bash
security add-generic-password -s "openrouter-api" -a "api_key" -w "YOUR_KEY_HERE"
```
