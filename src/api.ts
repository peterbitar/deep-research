import cors from 'cors';
import express, { Request, Response } from 'express';
import * as fs from 'fs/promises';
import * as path from 'path';
import { generateText } from './ai/generate-with-cost-log';
import { randomUUID } from 'crypto';

import { deepResearch, writeFinalAnswer, writeFinalReport } from './deep-research';
import { getModel } from './ai/providers';
import { pool, testConnection, initializeSchema } from './db/client';
import { saveReport, getLatestReport, getReportCards } from './db/reports';
import { saveChatSession, getChatSession, cleanupOldChatSessions } from './db/chat';
import { getCostLogs, getCostSummary, getCostLogsWithBreakdown } from './db/cost-logs';
import { getPipelineIterations, getPipelineStageData } from './db/pipeline-stages';
import { fetchUserHoldings } from './fetch-holdings';
import { parseReportToCards } from './report-parser';
import { runChatWithTools } from './chat-tools';

export { parseReportToCards };

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
    const { reportMarkdown } = await writeFinalReport({
      prompt: query,
      learnings,
      visitedUrls,
    });

    return res.json({ report: reportMarkdown });
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

// Common company name to ticker mappings (for well-known companies)
const COMPANY_NAME_MAP: Record<string, string> = {
  'NETFLIX': 'NFLX',
  'APPLE': 'AAPL',
  'NVIDIA': 'NVDA',
  'TESLA': 'TSLA',
  'MICROSOFT': 'MSFT',
  'GOOGLE': 'GOOGL',
  'AMAZON': 'AMZN',
  'BITCOIN': 'BTC',
  'ETHEREUM': 'ETH',
  'SOLANA': 'SOL',
  'BLACKBERRY': 'BB',
  'LIGHTSPEED': 'LSPD',
};

// Helper function to extract ticker symbols from text using regex
// Matches common ticker patterns: 1-5 uppercase letters, possibly with numbers
function extractTickerSymbols(text: string): string[] {
  // Pattern: Match tickers that are:
  // 1. Preceded by $, space, opening paren, comma, or start of string
  // 2. 1-5 uppercase letters/numbers
  // 3. Followed by space, closing paren, comma, period, semicolon, colon, or end of string
  // This ensures we match standalone tickers, not parts of words
  const tickerPattern = /(?:^|[\s$\(,])([A-Z0-9]{1,5})(?=[\s\)\.,;:]|$)/g;
  const commonWords = new Set([
    'THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'YOU', 'ALL', 'CAN', 'HER', 'WAS', 'ONE', 'OUR', 'OUT', 
    'DAY', 'GET', 'HAS', 'HIM', 'HIS', 'HOW', 'ITS', 'MAY', 'NEW', 'NOW', 'OLD', 'SEE', 'TWO', 'WHO',
    'BOY', 'DID', 'LET', 'PUT', 'SAY', 'SHE', 'TOO', 'USE', 'HAD', 'WITH', 'THIS', 'WEEK', 'THAT', 'FROM',
    'INTO', 'ONLY', 'OVER', 'UNDER', 'AFTER', 'BEFORE', 'ABOUT', 'ABOVE', 'BELOW', 'BETWEEN', 'AMONG',
    'STOCK', 'PRICE', 'SHARES', 'MARKET', 'TRADING', 'EARNINGS', 'REVENUE', 'GROWTH', 'SALES', 'PROFIT'
  ]);
  
  const matches = new Set<string>();
  let match;
  
  while ((match = tickerPattern.exec(text)) !== null) {
    const symbol = match[1];
    // Filter out common words and very short matches that are likely not tickers
    // Also filter out single characters and numbers-only matches
    if (symbol.length >= 2 && 
        !commonWords.has(symbol) && 
        /[A-Z]/.test(symbol)) { // Must contain at least one letter
      matches.add(symbol);
    }
  }
  
  return Array.from(matches);
}

// Helper function to determine ticker/macro from card title or content
function determineCardMetadata(
  title: string, 
  content: string,
  userHoldings?: Array<{ symbol: string }>
): {
  ticker?: string;
  macro?: string;
} {
  const upperTitle = title.toUpperCase();
  const upperContent = content.toUpperCase();
  const combinedText = `${upperTitle} ${upperContent}`;
  
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
  
  // Dynamic ticker detection
  // 1. Check for company names in text (map to tickers)
  for (const [companyName, ticker] of Object.entries(COMPANY_NAME_MAP)) {
    if (combinedText.includes(companyName)) {
      return { ticker };
    }
  }
  
  // 2. Extract potential ticker symbols from text
  const potentialTickers = extractTickerSymbols(combinedText);
  
  // 3. If user holdings provided, prioritize matching those
  if (userHoldings && userHoldings.length > 0) {
    const holdingsSymbols = new Set(userHoldings.map(h => h.symbol.toUpperCase()));
    for (const ticker of potentialTickers) {
      if (holdingsSymbols.has(ticker)) {
        return { ticker };
      }
    }
  }
  
  // 4. Check for well-known tickers in potential matches
  const wellKnownTickers = new Set([
    ...Object.values(COMPANY_NAME_MAP),
    'MU', 'AMD', 'INTC', 'QCOM', 'AVGO', 'TXN', 'MCHP', 'SWKS', 'QRVO', 'MRVL', // Common semiconductor tickers
    'CSU', 'LSPD', 'BB', // Other common holdings
  ]);
  for (const ticker of potentialTickers) {
    if (wellKnownTickers.has(ticker)) {
      return { ticker };
    }
  }
  
  // 5. If no user holdings, use first potential ticker (if it looks valid)
  // Only use if it's 2-5 characters (typical ticker length)
  if (potentialTickers.length > 0 && !userHoldings) {
    const firstTicker = potentialTickers[0];
    if (firstTicker.length >= 2 && firstTicker.length <= 5) {
      return { ticker: firstTicker };
    }
  }
  
  // Fallback macro checks
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

// Helper function to personalize cards based on user holdings
type CardType = { 
  title: string; 
  content: string; 
  emoji?: string; 
  ticker?: string | null; 
  macro?: string | null; 
  sources: string[]; 
  publishedDate: string; 
  isRelevant?: boolean;
};

function personalizeCards(
  cards: Array<Omit<CardType, 'isRelevant'>>,
  userHoldings: Array<{ symbol: string }>
): CardType[] {
  if (!userHoldings || userHoldings.length === 0) {
    return cards;
  }

  // Create set of user holdings symbols (uppercase for comparison)
  const holdingsSymbols = new Set(
    userHoldings.map(h => h.symbol.toUpperCase().trim())
  );

  // Categorize cards: relevant (matching holdings) vs others
  const relevantCards: CardType[] = [];
  const otherCards: CardType[] = [];

  for (const card of cards) {
    const cardTicker = card.ticker?.toUpperCase().trim();
    const isRelevant = cardTicker && holdingsSymbols.has(cardTicker);
    
    if (isRelevant) {
      relevantCards.push({ ...card, isRelevant: true });
    } else {
      otherCards.push(card);
    }
  }

  // Return: relevant cards first, then others (macro cards, non-matching holdings, etc.)
  return [...relevantCards, ...otherCards];
}

// GET endpoint to retrieve latest report with detailed card metadata for iOS app
app.get('/api/report/cards', async (req: Request, res: Response) => {
  try {
    // Get userId from query parameter (optional)
    const userId = req.query.userId as string | undefined;
    
    // Fetch user holdings if userId provided
    let userHoldings: Array<{ symbol: string }> = [];
    if (userId) {
      try {
        const mainBackendURL = process.env.MAIN_BACKEND_URL || 'https://wealthyrabbitios-production-03a4.up.railway.app';
        log(`📡 Fetching holdings for user: ${userId} from ${mainBackendURL}`);
        
        const fetchedHoldings = await fetchUserHoldings({
          userId,
          baseURL: mainBackendURL,
          healthCheck: false, // Skip health check for faster response
        });
        
        // Extract symbols for personalization
        userHoldings = fetchedHoldings.map(h => ({ symbol: h.symbol }));
        log(`✅ Fetched ${userHoldings.length} holdings for personalization`);
      } catch (holdingsError) {
        // Log but don't fail - continue without personalization
        console.error('⚠️  Failed to fetch holdings, continuing without personalization:', holdingsError);
        log(`⚠️  Holdings fetch failed, showing all cards (not personalized)`);
      }
    }

    // Try database first
    if (pool) {
      try {
        const dbData = await getReportCards();
        if (dbData) {
          const detailedCards = dbData.cards.map((card) => {
            // Prefer pipeline-tagged ticker/macro (stored at save time); infer only when null
            const metadata = determineCardMetadata(card.title, card.content, userHoldings);
            return {
              title: card.title,
              content: card.content,
              emoji: card.emoji,
              ticker: card.ticker ?? metadata.ticker ?? null,
              macro: card.macro ?? metadata.macro ?? null,
              sources: dbData.sources,
              publishedDate: dbData.publishedDate,
            };
          });

          // Personalize cards if user holdings available
          const personalizedCards = userHoldings.length > 0
            ? personalizeCards(detailedCards, userHoldings)
            : detailedCards;

          return res.json({
            success: true,
            runId: dbData.runId,
            publishedDate: dbData.publishedDate,
            opening: dbData.opening,
            cards: personalizedCards,
            metadata: {
              totalCards: personalizedCards.length,
              totalSources: dbData.sources.length,
              holdingsCards: personalizedCards.filter(c => c.ticker).length,
              macroCards: personalizedCards.filter(c => c.macro).length,
              personalized: userHoldings.length > 0,
              userHoldingsCount: userHoldings.length,
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
      const metadata = determineCardMetadata(card.title, card.content, userHoldings);
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

    // Personalize cards if user holdings available
    const personalizedCards = userHoldings.length > 0
      ? personalizeCards(detailedCards, userHoldings)
      : detailedCards;

    return res.json({
      success: true,
      runId: latestDir,
      publishedDate: publishedDate,
      opening: parsed.opening,
      cards: personalizedCards,
      metadata: {
        totalCards: personalizedCards.length,
        totalSources: parsed.sources.length,
        holdingsCards: personalizedCards.filter(c => c.ticker).length,
        macroCards: personalizedCards.filter(c => c.macro).length,
        personalized: userHoldings.length > 0,
        userHoldingsCount: userHoldings.length,
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
    const { query, depth = 3, breadth = 3, includeMacro = true } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }
    // Create runId up front so pipeline stages (gathered, triaged, filter, scraped) are saved to DB
    const runId = `research-${Date.now()}`;
    log('\n Starting research...\n');
    const { learnings, visitedUrls } = await deepResearch({
      query,
      breadth,
      depth,
      dbRunId: runId,
    });
    
    // Include macro research if requested (default: true for comprehensive reports)
    let allLearnings = [...learnings];
    let allUrls = [...visitedUrls];
    
    if (includeMacro) {
      log('\n🌍 Including macro & liquidity scan...\n');
      try {
        const { scanMacro } = await import('./macro-scan');
        const macroResult = await scanMacro(Math.min(breadth, 2), 1, undefined, undefined, runId);
        log(`  ✅ Macro learnings: ${macroResult.learnings.length}`);
        log(`  ✅ Macro URLs: ${macroResult.visitedUrls.length}\n`);
        allLearnings.push(...macroResult.learnings);
        allUrls.push(...macroResult.visitedUrls);
      } catch (error) {
        log(`  ⚠️  Error in macro scan:`, error);
        // Continue without macro if scan fails
      }
    }
    
    log(`\n\nTotal Learnings (including macro): ${allLearnings.length}\n\n${allLearnings.join('\n')}`);
    log(
      `\n\nTotal Visited URLs (${allUrls.length}):\n\n${allUrls.join('\n')}`,
    );
    const { reportMarkdown, cardMetadata } = await writeFinalReport({
      prompt: query,
      learnings: allLearnings,
      visitedUrls: allUrls,
    });

    // Parse report into cards
    const parsed = parseReportToCards(reportMarkdown);

    // Save to database if available (with pipeline-tagged ticker/macro per card)
    if (pool) {
      try {
        await saveReport({
          runId,
          query: includeMacro ? `${query} (with macro scan)` : query,
          depth,
          breadth,
          reportMarkdown,
          sources: parsed.sources,
          cardMetadata,
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

// Chat system prompt — aligned with news brief & report style
const chatSystemPrompt = `You are a smart financial friend helping long-term investors understand what changed this week and why it matters.

**GOAL:**
What changed this week, what didn't — and why that matters to a long-term investor. Focus on structural developments: price milestones, macro shifts, earnings changes, regulatory news, liquidity flows. Not just "news happened" — what changed for an investor.

**AUDIENCE:**
Write for someone not very financially literate. Keep the whole picture; stay conversational. Explain as if you're talking to a friend over coffee — no analyst jargon, no chart slang, no heavy technical detail. Lead with the story and why it matters, not with numbers or jargon.

**TONE & STYLE:**
- Short answers. No babbling. Straight to the point.
- Casual but sharp, relatable, real
- Whole picture, conversational, big picture only — do not go too technical
- Storyline first: lead with the story and driver, mention price/numbers only when they help
- One or two numbers per point is enough; avoid packing in technical levels

**SOURCE PRIORITY (when the knowledge base cites sources):**
- Tier 1 (trust): Bloomberg, Reuters, Financial Times, WSJ, Yahoo Finance, TechCrunch, SEC, CoinDesk, The Block, CryptoQuant (crypto), MarketWatch, etf.com, Morningstar
- Avoid or flag: Reddit, unsourced Twitter, AI blogs, low-quality aggregators
- If the knowledge base doesn't cover something, say so honestly

**KNOWLEDGE BASE:**
You have access to research data from articles and reports. Use this knowledge to answer questions accurately. Extract hard data + causes: exact date, price level and % change, why it moved (not just what). Note structural connections: Did several assets move together? Did earnings beat but stock fall? Tie findings together.

**WEB SEARCH:**
You have access to web search. Use it when: the knowledge base doesn't cover the question; you need fresh or updated information; or you need to verify a fact. Run targeted queries for precision. Prefer Tier 1 sources (Bloomberg, Reuters, FT, WSJ, Yahoo Finance, SEC, CoinDesk, etc.).

**TOOLS (use when appropriate):**
- getCryptoPrice: Real-time crypto prices (BTC, ETH, SOL, DOGE, XRP). Use when user asks "What's the current ETH price?" or "Price of Dogecoin now?"
- getStockPrice: Real-time stocks and ETFs (AAPL, TSLA, NVDA, SPY). Use when user asks "What's the price of Tesla?" or "How's the S&P 500 today?"
- getCommodityForexPrice: Gold, oil, forex (GOLD, OIL, USD/JPY). Use when user asks "Gold price right now?" or "Crude oil outlook?"

**NEUTRAL LANGUAGE (always):**
Never use suggestive phrases like "I recommend", "You should buy", "You should sell". Provide factual information and context; let the user decide. Avoid giving explicit buy/sell advice.

**MEMORY:**
You remember the conversation history. Reference previous topics naturally. Keep the conversation flowing like a real chat.

**RESPONSE FORMAT:**
- Lead with the answer/insight
- Back it up with context from knowledge base
- Plain, conversational English — no jargon or corporate speak
- End with a hook if relevant (question, next thing to watch, etc.)

Remember: You're their financial friend who's smart, fun to talk to, and actually helpful. Truth over comfort.`;

const CHAT_DISCLAIMER = `
---
*This is general information only and not financial advice. For personal guidance, please talk to a licensed professional.*`;

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
    const existingSessionId = sessionId || randomUUID();
    let session: ChatSession | undefined;
    if (pool) {
      session = (await getChatSession(existingSessionId)) ?? undefined;
    }
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

    // Build full prompt (system + knowledge + history + user)
    const fullPrompt = `${chatSystemPrompt}

Knowledge Base (latest research):
${knowledgeBase}

Conversation History:
${conversationHistory || '(New conversation)'}

User: ${message}

Assistant:`;

    // Use OpenAI Responses API with web_search + price tools when available; fall back to generateText
    let text: string;
    let citationUrls: string[] = [];
    const chatToolsResult = await runChatWithTools(fullPrompt);
    if (chatToolsResult) {
      text = chatToolsResult.text;
      citationUrls = chatToolsResult.urls;
    } else {
      const result = await generateText({
        model: getModel(),
        system: chatSystemPrompt,
        prompt: `Knowledge Base (latest research):
${knowledgeBase}

Conversation History:
${conversationHistory || '(New conversation)'}

User: ${message}

Assistant:`,
      });
      text = result.text;
    }
    text = text + CHAT_DISCLAIMER;

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
        webSearchUsed: citationUrls.length > 0,
        citationUrls: citationUrls.length > 0 ? citationUrls : undefined,
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

// Cost logs API - track LLM & Firecrawl costs
app.get('/api/cost-logs', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 100, 500);
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const service = req.query.service as string | undefined;
    const runId = req.query.runId as string | undefined;
    const sinceParam = req.query.since as string | undefined;
    const since = sinceParam ? new Date(sinceParam) : undefined;
    const breakdown = req.query.breakdown === '1' || req.query.breakdown === 'true';

    const logs = breakdown
      ? await getCostLogsWithBreakdown({ limit, offset, service, runId, since })
      : await getCostLogs({ limit, offset, service, runId, since });
    const summary = await getCostSummary({ since, runId });

    return res.json({
      logs,
      summary,
    });
  } catch (error: unknown) {
    console.error('Error fetching cost logs:', error);
    return res.status(500).json({
      error: 'Failed to fetch cost logs',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// Cost logs CSV export - columns: service, firecrawl_credits_used, firecrawl_effective_usd_per_credit, openai_input_tokens, openai_output_tokens, openai_input_rate, openai_output_rate, total_cost_usd
app.get('/api/cost-logs/csv', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 10000, 50000);
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const service = req.query.service as string | undefined;
    const runId = req.query.runId as string | undefined;
    const sinceParam = req.query.since as string | undefined;
    const since = sinceParam ? new Date(sinceParam) : undefined;

    const rows = await getCostLogsWithBreakdown({ limit, offset, service, runId, since });
    const cols = [
      'id',
      'service',
      'operation',
      'model',
      'firecrawl_credits_used',
      'firecrawl_effective_usd_per_credit',
      'openai_input_tokens',
      'openai_output_tokens',
      'openai_input_rate',
      'openai_output_rate',
      'total_cost_usd',
      'run_id',
      'created_at',
    ];
    const escape = (v: unknown): string => {
      if (v == null) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.join(','), ...rows.map((r) => cols.map((c) => escape((r as Record<string, unknown>)[c])).join(','))];
    const csv = lines.join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=cost_logs.csv');
    return res.send(csv);
  } catch (error: unknown) {
    console.error('Error exporting cost logs CSV:', error);
    return res.status(500).json({
      error: 'Failed to export cost logs CSV',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

app.get('/api/pipeline-stages/:runId', async (req: Request, res: Response) => {
  try {
    const { runId } = req.params;
    const iterationIdParam = req.query.iterationId as string | undefined;
    const stage = req.query.stage as string | undefined;

    const iterations = await getPipelineIterations(runId);
    if (iterations.length === 0) {
      return res.json({ iterations: [], message: 'No pipeline data for this run' });
    }

    if (iterationIdParam && stage) {
      const iterationId = parseInt(iterationIdParam, 10);
      const validStages = ['gathered', 'triaged', 'filter', 'scraped'];
      if (!validStages.includes(stage)) {
        return res.status(400).json({ error: 'Invalid stage. Use: gathered, triaged, filter, scraped' });
      }
      const data = await getPipelineStageData(iterationId, stage as any);
      return res.json({ iterationId, stage, data });
    }

    return res.json({ iterations });
  } catch (error: unknown) {
    console.error('Error fetching pipeline stages:', error);
    return res.status(500).json({
      error: 'Failed to fetch pipeline stages',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

app.get('/api/cost-logs/summary', async (req: Request, res: Response) => {
  try {
    const sinceParam = req.query.since as string | undefined;
    const runId = req.query.runId as string | undefined;
    const since = sinceParam ? new Date(sinceParam) : undefined;

    const summary = await getCostSummary({ since, runId });
    return res.json(summary);
  } catch (error: unknown) {
    console.error('Error fetching cost summary:', error);
    return res.status(500).json({
      error: 'Failed to fetch cost summary',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Deep Research API running on port ${port}`);
});

export default app;
