import cors from 'cors';
import express, { Request, Response } from 'express';
import * as fs from 'fs/promises';
import * as path from 'path';
import { generateText } from 'ai';
import { randomUUID } from 'crypto';

import { deepResearch, writeFinalAnswer, writeFinalReport } from './deep-research';
import { getModel } from './ai/providers';

const app = express();
const port = process.env.PORT || 3051;

// Middleware
app.use(cors());
app.use(express.json());

// Helper function for consistent logging
function log(...args: any[]) {
  console.log(...args);
}

// API endpoint to run research
app.post('/api/research', async (req: Request, res: Response) => {
  try {
    const { query, depth = 3, breadth = 3 } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    log('\nStarting research...\n');

    const { learnings, visitedUrls } = await deepResearch({
      query,
      breadth,
      depth,
    });

    log(`\n\nLearnings:\n\n${learnings.join('\n')}`);
    log(
      `\n\nVisited URLs (${visitedUrls.length}):\n\n${visitedUrls.join('\n')}`,
    );

    const answer = await writeFinalAnswer({
      prompt: query,
      learnings,
    });

    // Return the results
    return res.json({
      success: true,
      answer,
      learnings,
      visitedUrls,
    });
  } catch (error: unknown) {
    console.error('Error in research API:', error);
    return res.status(500).json({
      error: 'An error occurred during research',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// Helper function to parse markdown report into cards
function parseReportToCards(reportMarkdown: string): {
  opening: string;
  cards: Array<{ title: string; content: string; emoji?: string }>;
  sources: string[];
} {
  // Split by card headers (## followed by optional emoji and title)
  const sourcesRegex = /^##\s+Sources\s*$/m;
  
  // Find sources section
  const sourcesMatch = reportMarkdown.match(sourcesRegex);
  const sourcesIndex = sourcesMatch ? sourcesMatch.index! : reportMarkdown.length;
  
  // Split into main content and sources
  const mainContent = reportMarkdown.substring(0, sourcesIndex).trim();
  const sourcesSection = sourcesMatch 
    ? reportMarkdown.substring(sourcesIndex).trim()
    : '';
  
  // Extract sources list
  const sources: string[] = [];
  if (sourcesSection) {
    const sourceLines = sourcesSection.split('\n').slice(1); // Skip "## Sources" header
    for (const line of sourceLines) {
      const match = line.match(/^-\s*(.+)$/);
      if (match) {
        sources.push(match[1].trim());
      }
    }
  }
  
  // Find all card headers
  // Cards can be either: "## [EMOJI] Title" or "[EMOJI] Title" (without ##)
  const cardHeaders: Array<{ index: number; emoji?: string; title: string }> = [];
  let match;
  
  // Try pattern with ## first
  const headerRegexWithHash = /^##\s*([^\s]+)?\s*(.+)$/gm;
  while ((match = headerRegexWithHash.exec(mainContent)) !== null) {
    const emoji = match[1] && /[\p{Emoji}]/u.test(match[1]) ? match[1] : undefined;
    const title = emoji ? match[2].trim() : (match[1] || match[2]).trim();
    cardHeaders.push({
      index: match.index!,
      emoji,
      title,
    });
  }
  
  // If no headers found with ##, try pattern without ## (emoji at start of line)
  if (cardHeaders.length === 0) {
    const headerRegexWithoutHash = /^([\p{Emoji}])\s+(.+)$/gmu;
    while ((match = headerRegexWithoutHash.exec(mainContent)) !== null) {
      cardHeaders.push({
        index: match.index!,
        emoji: match[1],
        title: match[2].trim(),
      });
    }
  }
  
  // Extract opening (everything before first card)
  const opening = cardHeaders.length > 0
    ? mainContent.substring(0, cardHeaders[0].index).trim()
    : mainContent.trim();
  
  // Extract cards
  const cards: Array<{ title: string; content: string; emoji?: string }> = [];
  for (let i = 0; i < cardHeaders.length; i++) {
    const startIndex = cardHeaders[i].index;
    const endIndex = i < cardHeaders.length - 1
      ? cardHeaders[i + 1].index
      : mainContent.length;
    
    const cardContent = mainContent.substring(startIndex, endIndex).trim();
    // Remove the header line from content
    const contentLines = cardContent.split('\n');
    const content = contentLines.slice(1).join('\n').trim();
    
    cards.push({
      title: cardHeaders[i].title,
      content,
      emoji: cardHeaders[i].emoji,
    });
  }
  
  return { opening, cards, sources };
}

// generate report API (returns markdown)
app.post('/api/generate-report', async (req: Request, res: Response) => {
  try {
    const { query, depth = 3, breadth = 3 } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }
    log('\n Starting research...\n');
    const { learnings, visitedUrls } = await deepResearch({
      query,
      breadth,
      depth,
    });
    log(`\n\nLearnings:\n\n${learnings.join('\n')}`);
    log(
      `\n\nVisited URLs (${visitedUrls.length}):\n\n${visitedUrls.join('\n')}`,
    );
    const report = await writeFinalReport({
      prompt: query,
      learnings,
      visitedUrls,
    });

    return res.json({ report });
  } catch (error: unknown) {
    console.error('Error in generate report API:', error);
    return res.status(500).json({
      error: 'An error occurred during research',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// GET endpoint to retrieve the most recent report
app.get('/api/report/latest', async (req: Request, res: Response) => {
  try {
    const researchResultsDir = path.join(process.cwd(), 'research-results');
    
    // Check if research-results directory exists
    try {
      await fs.access(researchResultsDir);
    } catch {
      return res.status(404).json({
        error: 'No research results found',
        message: 'No research results directory exists. Run a research query first.',
      });
    }

    // Get all directories in research-results
    const entries = await fs.readdir(researchResultsDir, { withFileTypes: true });
    const directories = entries
      .filter(entry => entry.isDirectory() && entry.name.startsWith('research-'))
      .map(entry => entry.name)
      .sort()
      .reverse(); // Most recent first

    if (directories.length === 0) {
      return res.status(404).json({
        error: 'No reports found',
        message: 'No research reports found. Run a research query first.',
      });
    }

    // Get the most recent directory
    const latestDir = directories[0];
    const reportPath = path.join(researchResultsDir, latestDir, 'final-report.md');

    // Check if report file exists
    try {
      await fs.access(reportPath);
    } catch {
      return res.status(404).json({
        error: 'Report file not found',
        message: `Report directory found (${latestDir}) but final-report.md is missing.`,
        runId: latestDir,
      });
    }

    // Read and parse the report
    const reportMarkdown = await fs.readFile(reportPath, 'utf-8');
    const parsed = parseReportToCards(reportMarkdown);

    return res.json({
      success: true,
      runId: latestDir,
      timestamp: latestDir.replace('research-', ''),
      opening: parsed.opening,
      cards: parsed.cards,
      sources: parsed.sources,
      metadata: {
        totalCards: parsed.cards.length,
        totalSources: parsed.sources.length,
        reportPath,
      },
    });
  } catch (error: unknown) {
    console.error('Error retrieving latest report:', error);
    return res.status(500).json({
      error: 'An error occurred while retrieving the report',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// Helper function to determine ticker/macro from card title or content
function determineCardMetadata(title: string, content: string): {
  ticker?: string;
  macro?: string;
} {
  const upperTitle = title.toUpperCase();
  const upperContent = content.toUpperCase();
  
  // Check for macro categories FIRST (priority - avoids false ticker matches)
  // Central Bank Policy - must have FED/ECB in title or prominent in content
  if ((upperTitle.includes('FED') && !upperTitle.includes('ETHEREUM')) || 
      (upperTitle.includes('ECB') && !upperTitle.includes('ETHEREUM')) || 
      upperTitle.includes('CENTRAL BANK')) {
    return { macro: 'Central Bank Policy' };
  }
  if ((upperContent.includes('FED ') || upperContent.includes(' FED ') || upperContent.includes('FEDERAL RESERVE')) && 
      !upperContent.includes('ETHEREUM')) {
    return { macro: 'Central Bank Policy' };
  }
  if (upperContent.includes('ECB ') || upperContent.includes(' EUROPEAN CENTRAL BANK')) {
    return { macro: 'Central Bank Policy' };
  }
  
  // Economic Data - specific economic indicators
  if (upperTitle.includes('ECONOMIC DATA') || (upperTitle.includes('GDP') && upperTitle.includes('INFLATION'))) {
    return { macro: 'Economic Data' };
  }
  
  // Currency Moves - explicit currency mentions
  if (upperTitle.includes('CURRENCY') || (upperTitle.includes('DOLLAR') && upperTitle.includes('EXCHANGE'))) {
    return { macro: 'Currency Moves' };
  }
  
  // Geopolitical - explicit geopolitical mentions (not just "political")
  if (upperTitle.includes('GEOPOLITICAL') || upperTitle.includes('GEO-POLITICAL')) {
    return { macro: 'Geopolitical' };
  }
  
  // Check for ticker symbols (after macro checks)
  const tickers = ['AAPL', 'APPLE', 'NVDA', 'NVIDIA', 'TSLA', 'TESLA', 'MSFT', 'MICROSOFT', 'XRP', 'BTC', 'BITCOIN', 'ETH', 'ETHEREUM'];
  for (const ticker of tickers) {
    if (upperTitle.includes(ticker) || upperContent.includes(ticker)) {
      // Map full names to symbols
      if (ticker === 'APPLE') return { ticker: 'AAPL' };
      if (ticker === 'NVIDIA') return { ticker: 'NVDA' };
      if (ticker === 'TESLA') return { ticker: 'TSLA' };
      if (ticker === 'MICROSOFT') return { ticker: 'MSFT' };
      if (ticker === 'BITCOIN') return { ticker: 'BTC' };
      if (ticker === 'ETHEREUM') return { ticker: 'ETH' };
      return { ticker };
    }
  }
  if (upperTitle.includes('ECONOMIC') || upperContent.includes('GDP') || upperContent.includes('INFLATION')) {
    return { macro: 'Economic Data' };
  }
  if (upperTitle.includes('CURRENCY') || upperContent.includes('DOLLAR') || upperContent.includes('EXCHANGE RATE')) {
    return { macro: 'Currency Moves' };
  }
  if (upperTitle.includes('GEOPOLITICAL') || upperContent.includes('POLITICAL') || upperContent.includes('WAR')) {
    return { macro: 'Geopolitical' };
  }
  
  return {};
}

// GET endpoint to retrieve latest report with detailed card metadata for iOS app
app.get('/api/report/cards', async (req: Request, res: Response) => {
  try {
    const researchResultsDir = path.join(process.cwd(), 'research-results');
    
    // Check if research-results directory exists
    try {
      await fs.access(researchResultsDir);
    } catch {
      return res.status(404).json({
        error: 'No research results found',
        message: 'No research results directory exists. Run a research query first.',
      });
    }

    // Get all directories in research-results
    const entries = await fs.readdir(researchResultsDir, { withFileTypes: true });
    const directories = entries
      .filter(entry => entry.isDirectory() && entry.name.startsWith('research-'))
      .map(entry => entry.name)
      .sort()
      .reverse(); // Most recent first

    if (directories.length === 0) {
      return res.status(404).json({
        error: 'No reports found',
        message: 'No research reports found. Run a research query first.',
      });
    }

    // Get the most recent directory
    const latestDir = directories[0];
    const reportPath = path.join(researchResultsDir, latestDir, 'final-report.md');

    // Check if report file exists
    try {
      await fs.access(reportPath);
    } catch {
      return res.status(404).json({
        error: 'Report file not found',
        message: `Report directory found (${latestDir}) but final-report.md is missing.`,
        runId: latestDir,
      });
    }

    // Extract timestamp from run ID (format: research-1768758513249)
    const timestampStr = latestDir.replace('research-', '');
    const timestamp = parseInt(timestampStr, 10);
    const publishedDate = new Date(timestamp).toISOString();

    // Read and parse the report
    const reportMarkdown = await fs.readFile(reportPath, 'utf-8');
    const parsed = parseReportToCards(reportMarkdown);

    // Build detailed cards with metadata
    const detailedCards = parsed.cards.map((card) => {
      const metadata = determineCardMetadata(card.title, card.content);
      
      return {
        title: card.title,
        content: card.content,
        emoji: card.emoji,
        ticker: metadata.ticker || null,
        macro: metadata.macro || null,
        sources: parsed.sources, // Global sources for now (could be per-card if needed)
        publishedDate: publishedDate,
      };
    });

    return res.json({
      success: true,
      runId: latestDir,
      publishedDate: publishedDate,
      opening: parsed.opening,
      cards: detailedCards,
      metadata: {
        totalCards: detailedCards.length,
        totalSources: parsed.sources.length,
        holdingsCards: detailedCards.filter(c => c.ticker).length,
        macroCards: detailedCards.filter(c => c.macro).length,
      },
    });
  } catch (error: unknown) {
    console.error('Error retrieving report cards:', error);
    return res.status(500).json({
      error: 'An error occurred while retrieving the report cards',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// generate report API with cards as JSON
app.post('/api/generate-report-json', async (req: Request, res: Response) => {
  try {
    const { query, depth = 3, breadth = 3 } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }
    log('\n Starting research...\n');
    const { learnings, visitedUrls } = await deepResearch({
      query,
      breadth,
      depth,
    });
    log(`\n\nLearnings:\n\n${learnings.join('\n')}`);
    log(
      `\n\nVisited URLs (${visitedUrls.length}):\n\n${visitedUrls.join('\n')}`,
    );
    const reportMarkdown = await writeFinalReport({
      prompt: query,
      learnings,
      visitedUrls,
    });

    // Parse report into cards
    const parsed = parseReportToCards(reportMarkdown);

    return res.json({
      success: true,
      query,
      opening: parsed.opening,
      cards: parsed.cards,
      sources: parsed.sources,
      metadata: {
        totalCards: parsed.cards.length,
        totalSources: parsed.sources.length,
        totalLearnings: learnings.length,
      },
    });
  } catch (error: unknown) {
    console.error('Error in generate report JSON API:', error);
    return res.status(500).json({
      error: 'An error occurred during research',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});



// In-memory chat session storage (simple memory management)
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface ChatSession {
  sessionId: string;
  messages: ChatMessage[];
  createdAt: number;
  lastAccessed: number;
}

const chatSessions = new Map<string, ChatSession>();
const MAX_SESSION_AGE = 24 * 60 * 60 * 1000; // 24 hours
const MAX_MESSAGES_PER_SESSION = 50; // Keep last 50 messages for context

// Helper to clean up old sessions
function cleanupOldSessions() {
  const now = Date.now();
  for (const [sessionId, session] of chatSessions.entries()) {
    if (now - session.lastAccessed > MAX_SESSION_AGE) {
      chatSessions.delete(sessionId);
    }
  }
}

// Helper to load knowledge base from latest research
async function loadKnowledgeBase(): Promise<string> {
  try {
    const researchResultsDir = path.join(process.cwd(), 'research-results');
    
    // Get latest research directory
    const entries = await fs.readdir(researchResultsDir, { withFileTypes: true });
    const directories = entries
      .filter(entry => entry.isDirectory() && entry.name.startsWith('research-'))
      .map(entry => entry.name)
      .sort()
      .reverse();

    if (directories.length === 0) {
      return 'No research data available yet. Run a research query first.';
    }

    const latestDir = directories[0];
    const reportPath = path.join(researchResultsDir, latestDir, 'final-report.md');

    try {
      const reportMarkdown = await fs.readFile(reportPath, 'utf-8');
      return reportMarkdown;
    } catch {
      return 'Latest research report not found.';
    }
  } catch (error) {
    console.error('Error loading knowledge base:', error);
    return 'Error loading knowledge base.';
  }
}

// Gen Z Financial Friend system prompt
const chatSystemPrompt = `You are a Gen Z financial friend - ultra smart, well-versed, and great at storytelling. Your vibe:

**TONE & STYLE:**
- Short answers. No babbling. Straight to the point.
- Gen Z energy: casual but sharp, relatable, real
- Use modern language but stay professional
- Drop knowledge bombs, not walls of text
- Make finance interesting with storytelling when it helps

**PERSONALITY:**
- Smart friend who actually knows their stuff
- Confident but not arrogant
- Helpful without being condescending
- Straight-talker who cuts through BS
- Storyteller who makes complex topics digestible

**COMMUNICATION RULES:**
- Keep it SHORT - max 2-3 sentences per point
- Be DIRECT - skip fluff, get to value
- Use CONVERSATIONAL language - "yeah", "so", "tbh", "ngl"
- Make it RELEVANT - connect to what they care about
- Tell STORIES when it helps explain concepts
- Ask FOLLOW-UP questions to go deeper if needed
- Be HONEST about what you know and don't know

**KNOWLEDGE BASE:**
You have access to research data from articles and reports. Use this knowledge to answer questions accurately. If the knowledge base doesn't cover something, say so honestly.

**MEMORY:**
You remember the conversation history. Reference previous topics naturally. Keep the conversation flowing like a real chat.

**RESPONSE FORMAT:**
- Lead with the answer/insight
- Back it up with context from knowledge base
- Keep it conversational and engaging
- End with a hook if relevant (question, next thing to watch, etc.)

Remember: You're their financial friend who's smart, fun to talk to, and actually helpful.`;

// POST endpoint for chat
app.post('/api/chat', async (req: Request, res: Response) => {
  try {
    const { message, sessionId } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Clean up old sessions periodically
    cleanupOldSessions();

    // Get or create session
    let session: ChatSession;
    const existingSessionId = sessionId || randomUUID();
    
    if (chatSessions.has(existingSessionId)) {
      session = chatSessions.get(existingSessionId)!;
      session.lastAccessed = Date.now();
    } else {
      session = {
        sessionId: existingSessionId,
        messages: [],
        createdAt: Date.now(),
        lastAccessed: Date.now(),
      };
      chatSessions.set(existingSessionId, session);
    }

    // Load knowledge base
    const knowledgeBase = await loadKnowledgeBase();

    // Build conversation context (last 20 messages)
    const recentMessages = session.messages.slice(-20);
    const conversationHistory = recentMessages
      .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n\n');

    // Build prompt with context
    const prompt = `Knowledge Base (latest research):
${knowledgeBase}

Conversation History:
${conversationHistory || '(New conversation)'}

User: ${message}

Assistant:`;

    // Generate response
    const { text } = await generateText({
      model: getModel(),
      system: chatSystemPrompt,
      prompt: prompt,
    });

    // Save messages to session
    session.messages.push({
      role: 'user',
      content: message,
      timestamp: Date.now(),
    });
    
    session.messages.push({
      role: 'assistant',
      content: text,
      timestamp: Date.now(),
    });

    // Limit messages per session
    if (session.messages.length > MAX_MESSAGES_PER_SESSION) {
      session.messages = session.messages.slice(-MAX_MESSAGES_PER_SESSION);
    }

    return res.json({
      success: true,
      sessionId: existingSessionId,
      message: text,
      metadata: {
        sessionAge: Date.now() - session.createdAt,
        messageCount: session.messages.length,
      },
    });
  } catch (error: unknown) {
    console.error('Error in chat API:', error);
    return res.status(500).json({
      error: 'An error occurred during chat',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// GET endpoint to get session history (optional)
app.get('/api/chat/session/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const session = chatSessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    return res.json({
      success: true,
      sessionId: session.sessionId,
      messages: session.messages,
      metadata: {
        createdAt: session.createdAt,
        lastAccessed: session.lastAccessed,
        messageCount: session.messages.length,
      },
    });
  } catch (error: unknown) {
    console.error('Error getting chat session:', error);
    return res.status(500).json({
      error: 'An error occurred',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Deep Research API running on port ${port}`);
});

export default app;
