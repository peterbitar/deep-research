import cors from 'cors';
import express, { Request, Response } from 'express';
import * as fs from 'fs/promises';
import * as path from 'path';
import { generateText } from 'ai';
import { randomUUID } from 'crypto';

import { deepResearch, writeFinalAnswer, writeFinalReport } from './deep-research';
import { getModel } from './ai/providers';
import { pool, testConnection, initializeSchema } from './db/client';
import { saveReport, getLatestReport, getReportCards } from './db/reports';
import { saveChatSession, getChatSession, cleanupOldChatSessions } from './db/chat';

const app = express();
const port = process.env.PORT || 3051;

// Initialize database on startup
(async () => {
  if (process.env.DATABASE_URL) {
    console.log('🔌 DATABASE_URL detected, initializing database...');
    if (pool) {
      const connected = await testConnection();
      if (connected) {
        await initializeSchema();
        // Cleanup old chat sessions on startup
        await cleanupOldChatSessions();
        console.log('✅ Database initialization complete');
      }
    } else {
      console.warn('⚠️  DATABASE_URL is set but pool is null');
    }
  } else {
    console.warn('⚠️  DATABASE_URL not set - using filesystem storage only');
  }
})();

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
export function parseReportToCards(reportMarkdown: string): {
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
    // Try database first
    if (pool) {
      try {
        const dbData = await getReportCards();
        if (dbData) {
          const detailedCards = dbData.cards.map((card) => {
            const metadata = determineCardMetadata(card.title, card.content);
            return {
              title: card.title,
              content: card.content,
              emoji: card.emoji,
              ticker: metadata.ticker || card.ticker || null,
              macro: metadata.macro || card.macro || null,
              sources: dbData.sources,
              publishedDate: dbData.publishedDate,
            };
          });

          return res.json({
            success: true,
            runId: dbData.runId,
            publishedDate: dbData.publishedDate,
            opening: dbData.opening,
            cards: detailedCards,
            metadata: {
              totalCards: detailedCards.length,
              totalSources: dbData.sources.length,
              holdingsCards: detailedCards.filter(c => c.ticker).length,
              macroCards: detailedCards.filter(c => c.macro).length,
            },
          });
        }
      } catch (dbError) {
        console.error('Database query failed, falling back to filesystem:', dbError);
      }
    }

    // Fallback to filesystem
    const researchResultsDir = path.join(process.cwd(), 'research-results');
    
    try {
      await fs.access(researchResultsDir);
    } catch {
      return res.status(404).json({
        error: 'No research results found',
        message: 'No research results directory exists. Run a research query first.',
      });
    }

    const entries = await fs.readdir(researchResultsDir, { withFileTypes: true });
    const directories = entries
      .filter(entry => entry.isDirectory() && entry.name.startsWith('research-'))
      .map(entry => entry.name)
      .sort()
      .reverse();

    if (directories.length === 0) {
      return res.status(404).json({
        error: 'No reports found',
        message: 'No research reports found. Run a research query first.',
      });
    }

    const latestDir = directories[0];
    const reportPath = path.join(researchResultsDir, latestDir, 'final-report.md');

    try {
      await fs.access(reportPath);
    } catch {
      return res.status(404).json({
        error: 'Report file not found',
        message: `Report directory found (${latestDir}) but final-report.md is missing.`,
        runId: latestDir,
      });
    }

    const timestampStr = latestDir.replace('research-', '');
    const timestamp = parseInt(timestampStr, 10);
    const publishedDate = new Date(timestamp).toISOString();

    const reportMarkdown = await fs.readFile(reportPath, 'utf-8');
    const parsed = parseReportToCards(reportMarkdown);

    const detailedCards = parsed.cards.map((card) => {
      const metadata = determineCardMetadata(card.title, card.content);
      return {
        title: card.title,
        content: card.content,
        emoji: card.emoji,
        ticker: metadata.ticker || null,
        macro: metadata.macro || null,
        sources: parsed.sources,
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

    // Save to database if available
    const runId = `research-${Date.now()}`;
    if (pool) {
      try {
        await saveReport({
          runId,
          query,
          depth,
          breadth,
          reportMarkdown,
          sources: parsed.sources,
        });
        log(`✅ Report saved to database: ${runId}`);
      } catch (dbError) {
        console.error('Error saving to database:', dbError);
        // Continue even if database save fails
      }
    }

    return res.json({
      success: true,
      runId,
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
  // Try database first
  if (pool) {
    try {
      const report = await getLatestReport();
      if (report) {
        return report.reportMarkdown;
      }
    } catch (dbError) {
      console.error('Database query failed, falling back to filesystem:', dbError);
    }
  }

  // Fallback to filesystem
  try {
    const researchResultsDir = path.join(process.cwd(), 'research-results');
    
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
    
    // Try database first
    if (pool) {
      const dbSession = await getChatSession(existingSessionId);
      if (dbSession) {
        session = dbSession;
      }
    }

    // Fallback to in-memory or create new
    if (!session) {
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

    // Save to database if available
    if (pool) {
      await saveChatSession(session.sessionId, session.messages);
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
    
    // Try database first
    let session: ChatSession | undefined;
    if (pool) {
      session = await getChatSession(sessionId) || undefined;
    }

    // Fallback to in-memory
    if (!session) {
      session = chatSessions.get(sessionId);
    }

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

// Podcast-style storytelling system prompt
const podcastSystemPrompt = `You are an engaging podcast host with deep financial expertise. Your job is to create a compelling, storytelling-style summary of the week's financial news that feels like a podcast episode.

**PODCAST STYLE & TONE:**
- Engaging, conversational, like you're talking directly to the listener
- Use storytelling techniques: hooks, tension, narrative arcs, vivid descriptions
- Make it feel like a real podcast: "Welcome back..." "Let's dive in..." "Here's what caught my attention..."
- Connect stories naturally - flow from one to the next like a narrative
- Use real, specific details: numbers, dates, company names - make it concrete
- Paint pictures with words - help listeners visualize what's happening
- Build intrigue and curiosity - make them want to keep listening

**LENGTH CONSTRAINT:**
- Target: 4 minutes MAXIMUM (approximately 500-600 words, NO MORE)
- This is CRITICAL - you MUST stay under 4 minutes
- Be concise but comprehensive - prioritize the most important stories
- Cut fluff, keep substance - every word must add value
- If you need to cover multiple stories, make them flow together efficiently
- Aim for 500-600 words to stay safely under 4 minutes (150 words/minute pace)

**STRUCTURE:**
1. **Opening Hook** (30-50 words): Start with something intriguing that grabs attention immediately
2. **Main Stories** (500-650 words): Weave together the key stories from the week
   - Flow from one story to the next naturally
   - Use transitions: "Meanwhile..." "At the same time..." "But here's the twist..."
   - Connect related stories to show the bigger picture
3. **Closing Thought** (30-50 words): End with a clear takeaway or what to watch next

**STORYTELLING TECHNIQUES:**
- Start stories with what happened, build tension, reveal why it matters
- Use specific details: "Apple announced..." not "A company announced..."
- Create narrative flow: cause → effect → implications
- Show connections between stories when they exist
- Use vivid language but stay factual - no hype

**VOICE:**
- Confident but approachable
- Smart but not condescending
- Passionate about the stories without being over-the-top
- Natural conversational tone, like you're talking to a friend

**CONTENT FOCUS:**
- Only use information from the research report provided
- Focus on what changed this week (not old news)
- Prioritize significant developments, strategic moves, regulatory changes
- Include context when it helps the story but don't dwell on old history
- Explain financial terms naturally as you go (like you would on a podcast)

Remember: This should feel like a real podcast episode that someone would actually want to listen to for 4 minutes. Make it engaging, informative, and entertaining.`;

// GET endpoint for podcast-style summary
app.get('/api/podcast/latest', async (req: Request, res: Response) => {
  try {
    // Load knowledge base (latest research report)
    const knowledgeBase = await loadKnowledgeBase();

    if (knowledgeBase.includes('No research data') || knowledgeBase.includes('Error loading')) {
      return res.status(404).json({
        error: 'No research data available',
        message: 'Run a research query first to generate podcast content.',
      });
    }

    // Get metadata from database or filesystem
    let runId: string;
    let publishedDate: string;

    if (pool) {
      try {
        const latestReport = await getLatestReport();
        if (latestReport) {
          runId = latestReport.runId;
          publishedDate = latestReport.created_at.toISOString();
        } else {
          throw new Error('No report in database');
        }
      } catch (dbError) {
        // Fallback to filesystem
        const researchResultsDir = path.join(process.cwd(), 'research-results');
        const entries = await fs.readdir(researchResultsDir, { withFileTypes: true });
        const directories = entries
          .filter(entry => entry.isDirectory() && entry.name.startsWith('research-'))
          .map(entry => entry.name)
          .sort()
          .reverse();

        if (directories.length === 0) {
          return res.status(404).json({
            error: 'No reports found',
            message: 'No research reports found. Run a research query first.',
          });
        }

        const latestDir = directories[0];
        const timestampStr = latestDir.replace('research-', '');
        const timestamp = parseInt(timestampStr, 10);
        runId = latestDir;
        publishedDate = new Date(timestamp).toISOString();
      }
    } else {
      // Filesystem only
      const researchResultsDir = path.join(process.cwd(), 'research-results');
      const entries = await fs.readdir(researchResultsDir, { withFileTypes: true });
      const directories = entries
        .filter(entry => entry.isDirectory() && entry.name.startsWith('research-'))
        .map(entry => entry.name)
        .sort()
        .reverse();

      if (directories.length === 0) {
        return res.status(404).json({
          error: 'No reports found',
          message: 'No research reports found. Run a research query first.',
        });
      }

      const latestDir = directories[0];
      const timestampStr = latestDir.replace('research-', '');
      const timestamp = parseInt(timestampStr, 10);
      runId = latestDir;
      publishedDate = new Date(timestamp).toISOString();
    }

    // Generate podcast-style content
    const { text: podcastContent } = await generateText({
      model: getModel(),
      system: podcastSystemPrompt,
      prompt: `Create a 4-minute podcast-style summary (MAXIMUM 500-600 words) of this week's financial news. Make it engaging, storytelling-focused, and conversational.

Research Report:
${knowledgeBase}

Generate a podcast episode that:
- Opens with an engaging hook (30-50 words)
- Weaves together the key stories from the week (450-550 words)
- Flows naturally from one story to the next
- Ends with a clear takeaway (30-50 words)
- MUST stay within 500-600 words total (4 minutes maximum at 150 words/minute)

Remember: Be concise. Every word counts. Cut to the essential stories and insights.`,
    });

    // Estimate word count and duration
    const wordCount = podcastContent.split(/\s+/).length;
    const estimatedMinutes = Math.ceil(wordCount / 150); // ~150 words per minute at normal pace

    return res.json({
      success: true,
      runId: runId,
      publishedDate: publishedDate,
      content: podcastContent,
      metadata: {
        wordCount: wordCount,
        estimatedMinutes: estimatedMinutes,
        estimatedSeconds: Math.ceil(wordCount / 150 * 60),
      },
    });
  } catch (error: unknown) {
    console.error('Error generating podcast:', error);
    return res.status(500).json({
      error: 'An error occurred generating podcast content',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Deep Research API running on port ${port}`);
});

export default app;
