import cors from 'cors';
import express, { Request, Response } from 'express';
import * as fs from 'fs/promises';
import * as path from 'path';

import { deepResearch, writeFinalAnswer, writeFinalReport } from './deep-research';

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
  const cardHeaders: Array<{ index: number; emoji?: string; title: string }> = [];
  let match;
  const headerRegex = /^##\s*([^\s]+)?\s*(.+)$/gm;
  while ((match = headerRegex.exec(mainContent)) !== null) {
    const emoji = match[1] && /[\p{Emoji}]/u.test(match[1]) ? match[1] : undefined;
    const title = emoji ? match[2].trim() : (match[1] || match[2]).trim();
    cardHeaders.push({
      index: match.index!,
      emoji,
      title,
    });
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



// Start the server
app.listen(port, () => {
  console.log(`Deep Research API running on port ${port}`);
});

export default app;
