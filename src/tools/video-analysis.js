/**
 * Enhanced Video Analysis Tool for Gemini MCP Server.
 * Includes better error handling and timeout management.
 */

const BaseTool = require('./base-tool');
const { log } = require('../utils/logger');
const { readFileAsBuffer, validateFileSize, getMimeType } = require('../utils/file-utils');
const { validateNonEmptyString, validateString } = require('../utils/validation');
const config = require('../config');

class VideoAnalysisTool extends BaseTool {
  constructor(intelligenceSystem, geminiService) {
    super(
      'gemini-analyze-video',
      'Analyze video files using Gemini\'s multimodal video understanding capabilities (with learned user preferences)',
      {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Path to the video file to analyze (supports MP4, MOV, AVI, WEBM, MKV, FLV) - for files under 100MB',
          },
          file_uri: {
            type: 'string',
            description: 'URI of pre-uploaded file (use gemini-upload-file first for files over 100MB)',
          },
          mime_type: {
            type: 'string',
            description: 'MIME type when using file_uri (e.g., "video/mp4")',
          },
          youtube_url: {
            type: 'string',
            description: 'YouTube video URL to analyze directly (e.g., https://www.youtube.com/watch?v=...) — no download required',
          },
          analysis_type: {
            type: 'string',
            description: 'Type of analysis to perform: "summary", "transcript", "objects", "detailed", "charts", or "custom"',
            enum: ['summary', 'transcript', 'objects', 'detailed', 'charts', 'custom'],
          },
          context: {
            type: 'string',
            description: 'Optional context for intelligent enhancement (e.g., "security", "educational", "entertainment")',
          },
        },
        required: [],
      },
      intelligenceSystem,
      geminiService,
    );
  }

  async execute(args) {
    const startTime = Date.now();
    const analysisType = args.analysis_type ? validateString(args.analysis_type, 'analysis_type', ['summary', 'transcript', 'objects', 'detailed', 'charts', 'custom']) : 'summary';
    const context = args.context ? validateString(args.context, 'context') : null;

    // Support YouTube URL, file path, or file URI
    const youtubeUrl = args.youtube_url;
    const fileUri = args.file_uri;
    const filePath = args.file_path;

    const sourceCount = [youtubeUrl, fileUri, filePath].filter(Boolean).length;
    if (sourceCount === 0) {
      throw new Error('One of youtube_url, file_path, or file_uri must be provided');
    }
    if (sourceCount > 1) {
      throw new Error('Please provide only one of youtube_url, file_path, or file_uri');
    }

    log(`Analyzing video ${fileUri ? 'from URI' : 'file'}: "${fileUri || filePath}" with analysis type: "${analysisType}" and context: ${context || 'general'}`, this.name);

    try {
      let analysisText;
      let videoSizeMB = 0;
      let mimeType;
      let fileName;
      
      // Prepare analysis prompt
      let baseAnalysisPrompt;
      switch (analysisType) {
        case 'summary':
          baseAnalysisPrompt = 'Please provide a comprehensive summary of this video. Describe what happens, who appears, key scenes, and the overall content.';
          break;
        case 'transcript':
          baseAnalysisPrompt = 'Please transcribe all spoken content in this video. Provide the complete text of dialogue, narration, and any other spoken words with timestamps if possible.';
          break;
        case 'objects':
          baseAnalysisPrompt = 'Please identify and describe all objects, people, locations, and visual elements visible in this video. List them systematically and note when they appear.';
          break;
        case 'detailed':
          baseAnalysisPrompt = 'Please provide a detailed analysis of this video including: summary of content, visual elements, audio/speech transcription, scene changes, key moments, and any notable details.';
          break;
        case 'charts':
          baseAnalysisPrompt = `Scan this video frame by frame and extract every chart, graph, table, and data visualization you find.

For EACH one found, output a JSON object with these fields:
- timestamp: approximate time in the video (e.g. "2:34")
- type: chart type (e.g. "bar chart", "line graph", "pie chart", "data table", "scatter plot")
- title: chart/table title if visible
- axes: { x: "label", y: "label" } where applicable
- series: list of data series names/colors if applicable
- data: extracted data points, rows, or values as precisely as possible
- notes: any annotations, callouts, or key takeaways visible on the chart

Return all findings as a JSON array. If no charts or tables are found in the video, return an empty array [].`;
          break;
        case 'custom':
          baseAnalysisPrompt = context || 'Please analyze this video and describe what you observe.';
          break;
        default:
          baseAnalysisPrompt = 'Please provide a summary of this video content.';
      }

      let enhancedAnalysisPrompt = baseAnalysisPrompt;
      if (this.intelligenceSystem.initialized) {
        try {
          enhancedAnalysisPrompt = await this.intelligenceSystem.enhancePrompt(baseAnalysisPrompt, context, this.name);
          log('Applied Tool Intelligence enhancement', this.name);
        } catch (err) {
          log(`Tool Intelligence enhancement failed: ${err.message}`, this.name);
        }
      }

      let analysisPrompt = enhancedAnalysisPrompt;
      if (context && analysisType !== 'custom') {
        analysisPrompt += ` Additional context: ${context}`;
      }
      
      if (youtubeUrl) {
        // YouTube URL — Gemini native support, no download needed
        fileName = youtubeUrl;
        mimeType = 'video/youtube';

        log(`Analyzing YouTube video: ${youtubeUrl}`, this.name);

        try {
          log('Starting YouTube video analysis (may take 30-90 seconds for longer videos)...', this.name);
          analysisText = await this.geminiService.analyzeVideoFromYouTube('VIDEO_ANALYSIS', analysisPrompt, youtubeUrl);
          const duration = ((Date.now() - startTime) / 1000).toFixed(1);
          log(`YouTube video analysis completed in ${duration} seconds`, this.name);
        } catch (error) {
          log(`YouTube video analysis failed: ${error.message}`, this.name);
          if (error.message.includes('timeout')) {
            throw new Error('YouTube video analysis timed out. Try a shorter video or use analysis_type "summary" instead of "charts".');
          }
          throw error;
        }

      } else if (fileUri) {
        // Using pre-uploaded file URI
        mimeType = validateNonEmptyString(args.mime_type, 'mime_type');
        fileName = fileUri.split('/').pop();
        
        log(`Using pre-uploaded file URI: ${fileUri}, MIME type: ${mimeType}`, this.name);
        
        try {
          // Add timeout warning
          log('Starting video analysis from URI (this may take 30-60 seconds for longer videos)...', this.name);
          
          // Analyze using file URI with explicit error handling
          analysisText = await this.geminiService.analyzeVideoFromUri('VIDEO_ANALYSIS', analysisPrompt, fileUri, mimeType);
          
          const duration = ((Date.now() - startTime) / 1000).toFixed(1);
          log(`Video analysis completed in ${duration} seconds`, this.name);
          
        } catch (error) {
          // Enhanced error logging
          log(`Video analysis from URI failed: ${error.message}`, this.name);
          if (error.message.includes('timeout')) {
            throw new Error('Video analysis timed out. This usually happens with longer videos. Try a shorter video or use a smaller analysis_type like "summary".');
          }
          throw error;
        }
        
      } else {
        // Traditional file path approach
        fileName = filePath;
        validateFileSize(filePath, config.MAX_VIDEO_SIZE_MB);
        const videoBuffer = readFileAsBuffer(filePath);
        videoSizeMB = videoBuffer.length / (1024 * 1024);
        const videoBase64 = videoBuffer.toString('base64');
        mimeType = getMimeType(filePath, config.SUPPORTED_VIDEO_MIMES);

        log(`Video file loaded: ${videoSizeMB.toFixed(2)}MB, MIME type: ${mimeType}`, this.name);
        
        try {
          // Add timeout warning
          log('Starting video analysis (this may take 30-60 seconds for longer videos)...', this.name);
          
          // Analyze using base64 data
          analysisText = await this.geminiService.analyzeVideo('VIDEO_ANALYSIS', analysisPrompt, videoBase64, mimeType);
          
          const duration = ((Date.now() - startTime) / 1000).toFixed(1);
          log(`Video analysis completed in ${duration} seconds`, this.name);
          
        } catch (error) {
          // Enhanced error logging
          log(`Video analysis failed: ${error.message}`, this.name);
          if (error.message.includes('timeout')) {
            throw new Error('Video analysis timed out. This usually happens with videos over 1 minute. Try a shorter video or upload it first using gemini-upload-file.');
          }
          throw error;
        }
      }

      if (analysisText) {
        log('Video analysis completed successfully', this.name);

        if (this.intelligenceSystem.initialized) {
          try {
            const resultSummary = `Video analysis completed successfully: ${analysisText.length} characters, type: ${analysisType}`;
            await this.intelligenceSystem.learnFromInteraction(baseAnalysisPrompt, enhancedAnalysisPrompt, resultSummary, context, this.name);
            log('Tool Intelligence learned from interaction', this.name);
          } catch (err) {
            log(`Tool Intelligence learning failed: ${err.message}`, this.name);
          }
        }

        let finalResponse = `✓ Video analyzed successfully:\n\n**Source:** ${fileName}\n`;

        if (youtubeUrl) {
          finalResponse += `**Method:** YouTube (native Gemini)\n`;
        } else if (fileUri) {
          finalResponse += `**Method:** File URI (pre-uploaded)\n**URI:** ${fileUri}\n`;
        } else {
          finalResponse += `**Method:** Direct upload\n**Size:** ${videoSizeMB.toFixed(2)}MB\n`;
          finalResponse += `**Format:** ${filePath.split('.').pop().toUpperCase()}\n`;
        }
        
        finalResponse += `**MIME Type:** ${mimeType}\n**Analysis Type:** ${analysisType}\n`;
        finalResponse += `**Processing Time:** ${((Date.now() - startTime) / 1000).toFixed(1)} seconds\n\n`;
        finalResponse += `**Analysis:**\n${analysisText}`;
        
        if (context && this.intelligenceSystem.initialized) {
          finalResponse += `\n\n---\n_Enhancement applied based on context: ${context}_`;
        }

        return {
          content: [
            {
              type: 'text',
              text: finalResponse,
            },
          ],
        };
      }
      
      log('No analysis text generated', this.name);
      return {
        content: [
          {
            type: 'text',
            text: `Could not analyze video file: "${fileName}". The video may be corrupted, too long (over 2 minutes), or in an unsupported format. For longer videos, try uploading first with gemini-upload-file.`,
          },
        ],
      };
    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      log(`Error analyzing video after ${duration} seconds: ${error.message}`, this.name);
      
      // Provide helpful error messages
      if (error.message.includes('timeout')) {
        throw new Error(`Video analysis timed out after ${duration} seconds. For videos longer than 1 minute, upload them first using gemini-upload-file, then analyze using the file_uri.`);
      } else if (error.message.includes('quota')) {
        throw new Error('Gemini API quota exceeded. Please try again later or check your API limits.');
      } else if (error.message.includes('Invalid')) {
        throw new Error(`Invalid video format or corrupted file. Supported formats: ${Object.keys(config.SUPPORTED_VIDEO_MIMES).join(', ')}`);
      }
      
      throw new Error(`Error analyzing video: ${error.message}`);
    }
  }
}

module.exports = VideoAnalysisTool;
