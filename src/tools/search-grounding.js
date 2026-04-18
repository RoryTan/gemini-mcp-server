/**
 * Search Grounding Tool for Gemini MCP Server.
 * Real-time web search via Google Search grounding — returns synthesised answer with citations.
 * Use when WebSearch returns poor results or recency matters (news, logistics, current events).
 */

const https = require('https');
const BaseTool = require('./base-tool');
const { log } = require('../utils/logger');
const { validateNonEmptyString } = require('../utils/validation');
const config = require('../config');

class SearchGroundingTool extends BaseTool {
  constructor(intelligenceSystem, geminiService) {
    super(
      'gemini-search',
      'Real-time web search via Google Search grounding. Returns synthesised answer with citations. Use for current events, logistics, news, or when WebSearch returns poor results.',
      {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query',
          },
        },
        required: ['query'],
      },
      intelligenceSystem,
      geminiService,
    );
  }

  async execute(args) {
    const query = validateNonEmptyString(args.query, 'query');
    log(`Search grounding query: "${query}"`, this.name);

    const body = JSON.stringify({
      contents: [{ parts: [{ text: query }] }],
      tools: [{ googleSearch: {} }],
    });

    const result = await new Promise((resolve, reject) => {
      const req = https.request({
        host: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${config.API_KEY}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error(`Parse error: ${data.substring(0, 300)}`)); }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    if (result.error) {
      throw new Error(`Search grounding failed: ${result.error.message || JSON.stringify(result.error)}`);
    }

    const candidate = result.candidates?.[0];
    if (!candidate) {
      throw new Error('No response from search grounding');
    }

    const text = candidate.content?.parts?.find((p) => p.text)?.text || '';
    const sources = (candidate.groundingMetadata?.groundingChunks || [])
      .map((c) => c.web)
      .filter(Boolean);

    let response = text;
    if (sources.length > 0) {
      response += '\n\n**Sources:**\n';
      sources.forEach((s, i) => {
        response += `${i + 1}. [${s.title || s.uri}](${s.uri})\n`;
      });
    }

    log(`Search grounding completed: ${sources.length} sources`, this.name);
    return { content: [{ type: 'text', text: response }] };
  }
}

module.exports = SearchGroundingTool;
