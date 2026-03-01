#!/bin/bash
# Wrapper script for Gemini MCP server
# Forked from Garblesnarff/gemini-mcp-server — hardcoded keys stripped, file-upload removed

# API key from macOS Keychain (REQUIRED — no fallbacks)
export GEMINI_API_KEY=$(security find-generic-password -s "gemini-api" -a "api_key" -w 2>/dev/null)
if [ -z "$GEMINI_API_KEY" ]; then
    echo "ERROR: Gemini API key not found in Keychain. Run: key_chain_set gemini-api api_key <YOUR_KEY>" >&2
    exit 1
fi

export OUTPUT_DIR=${OUTPUT_DIR:-"$HOME/Pictures/gemini-output"}
export DEBUG=${DEBUG:-"false"}

mkdir -p "$OUTPUT_DIR"

cd "$(dirname "$0")"
exec node gemini-server.js
