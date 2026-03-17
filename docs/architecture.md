# Architecture

## Overview

stdio MCP server. Claude sends JSON-RPC over stdin, gets responses over stdout. No HTTP, no daemon — the process lives only while Claude needs it.

```
Claude Code  ──stdin──▶  gemini-server.js  ──HTTPS──▶  Google Gemini API
             ◀─stdout──                    ◀──────────
                                  │
                                  └──HTTPS──▶  OpenRouter API  (nano-banana-pro only)
```

---

## Tool dispatch

```mermaid
flowchart TD
    A[Claude sends tools/call JSON-RPC] --> B[server.js: parse request]
    B --> C{method?}
    C -->|initialize| D[return server capabilities + tool list]
    C -->|tools/list| E[return all 9 tool schemas]
    C -->|tools/call| F[ToolRegistry.execute]
    F --> G{tool name}
    G -->|generate_image| H[ImageGenerationTool]
    G -->|gemini-edit-image| I[ImageEditTool]
    G -->|gemini-advanced-image| J[AdvancedImageTool]
    G -->|nano-banana-pro| K[NanaBananaProTool]
    G -->|gemini-analyze-image| L[ImageAnalysisTool]
    G -->|gemini-analyze-video| M[VideoAnalysisTool]
    G -->|gemini-transcribe| N[AudioTranscriptionTool]
    G -->|gemini-chat| O[ChatTool]
    G -->|gemini-code-execute| P[CodeExecutionTool]
    H & I & J & L & M & N & O & P --> Q[GeminiService]
    K --> R[OpenRouterService]
    Q --> S[Google Gemini API]
    R --> T[OpenRouter API]
    S & T --> U[response → Claude]
```

---

## Auth / credential flow

```mermaid
flowchart LR
    A[gemini-wrapper.sh] -->|security find-generic-password| B[macOS Keychain]
    B -->|GEMINI_API_KEY| C[gemini-server.js env]
    B -->|OPENROUTER_API_KEY| C
    C --> D[config.js]
    D -->|API_KEY| E[gemini/client.js → GoogleGenerativeAI]
    D -->|OPENROUTER_API_KEY| F[openrouter/openrouter-service.js]
    E --> G[Gemini API]
    F --> H[OpenRouter API]
```

Keys never touch disk — always read from Keychain at process start.

---

## YouTube chart extraction

```mermaid
sequenceDiagram
    participant C as Claude
    participant V as VideoAnalysisTool
    participant GS as GeminiService
    participant GA as Gemini API

    C->>V: tools/call gemini-analyze-video<br/>{youtube_url, analysis_type: "charts"}
    V->>V: build charts extraction prompt<br/>(JSON schema, frame-by-frame instruction)
    V->>GS: analyzeVideoFromYouTube(prompt, youtubeUrl)
    GS->>GA: generateContent({contents:[<br/>  {text: prompt},<br/>  {fileData: {fileUri: youtubeUrl}}<br/>]})
    Note over GA: Gemini fetches YouTube natively<br/>No download, no yt-dlp
    GA-->>GS: text response (JSON array of chart objects)
    GS-->>V: raw text
    V-->>C: [{timestamp, type, axes, series, data, notes}, ...]
```

**Key**: `fileData.fileUri` accepts YouTube URLs directly — Gemini handles the fetch. No local download step.

---

## File I/O flow (local files)

```mermaid
flowchart TD
    A[tool receives file_path] --> B[file-utils.js: readFileAsBuffer]
    B --> C{ALLOW_UNRESTRICTED_FILE_ACCESS?}
    C -->|true default| D[read any path]
    C -->|false| E{path in ALLOWED_DIRS?}
    E -->|yes| D
    E -->|no| F[throw: access denied]
    D --> G[validateFileSize — max 20MB images / 100MB video]
    G --> H[getMimeType — extension → MIME map]
    H --> I[base64 encode]
    I --> J[GeminiService.analyzeImage / analyzeVideo / transcribeAudio]
    J --> K[inlineData: {data: base64, mimeType}]
    K --> L[Gemini API]
    L --> M[response → tool → Claude]
```

Output files (generated images) go to `~/Pictures/gemini-output/` by default, configurable via `OUTPUT_DIR` env.

---

## Image generation paths

```mermaid
flowchart TD
    A[generate_image] -->|prompt| B[GeminiService.generateImage]
    C[gemini-edit-image] -->|prompt + source image base64| D[GeminiService.analyzeImage IMAGE_EDITING]
    E[gemini-advanced-image] -->|prompt + up to 8 ref images| F[GeminiService.generateAdvancedImage]
    G[nano-banana-pro] -->|prompt + up to 14 ref images| H[OpenRouterService.generateImage]

    B & D & F --> I[gemini-3.1-flash-image-preview<br/>Nano Banana 2]
    H --> J[google/gemini-3-pro-image-preview<br/>via OpenRouter]

    I & J --> K[base64 image in response]
    K --> L[save to OUTPUT_DIR]
    L --> M[return file path + preview to Claude]
```
