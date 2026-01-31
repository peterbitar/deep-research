// Holdings-based query generation for Wealthy Rabbit

import { generateObject } from './ai/generate-with-cost-log';
import { z } from 'zod';

import { getModel } from './ai/providers';
import { systemPrompt } from './prompt';
import type { Holding } from './holdings';

/**
 * Generate factual queries for a stock holding
 */
export async function generateStockQueries({
  symbol,
  numQueries = 3,
}: {
  symbol: string;
  numQueries?: number;
}): Promise<Array<{ query: string; researchGoal: string }>> {
  const res = await generateObject({
    model: getModel(),
    system: systemPrompt(),
    prompt: `Generate SERP queries to check for FACTUAL updates about ${symbol} in the LAST 7 DAYS. Focus ONLY on concrete facts, not trends or speculation.

FACTUAL UPDATES TO CHECK FOR (Comprehensive List):

1. FINANCIAL PERFORMANCE & FILINGS:
   - Earnings releases (actual numbers, guidance, revisions)
   - SEC filings (8-K, 10-Q, 10-K, proxy statements, S-1, S-3, 424B)
   - Revenue, profit, margin figures and guidance changes
   - Segment performance breakdowns (by geography, business unit, product line)
   - Non-GAAP metrics shifts (adjusted EPS, EBITDA, free cash flow)
   - Deferred revenue changes (signals bookings/backlog)
   - Customer concentration shifts (major customer wins/losses)
   - Geographic revenue exposure changes

2. PRODUCT & STRATEGY DEVELOPMENTS:
   - Product launches, releases, or announcements
   - Product roadmap acceleration, delays, or changes
   - Product discontinuations or sunsets
   - Hardware/software specification changes
   - Technology milestones (chip tapeouts, drug approvals, platform launches)
   - Early access programs, preorder campaigns
   - Patent filings or intellectual property developments

3. GEOPOLITICAL & TRADE POLICY:
   - Export bans, licensing restrictions, trade barriers
   - Tariff announcements or changes
   - Sanctions or retaliatory trade policies
   - Bilateral/trade agreement changes affecting operations
   - Government pressure on operations (regulatory, political)
   - Market access restrictions or changes
   - Cross-border supply chain disruptions

4. REGULATORY & LEGAL ACTIONS:
   - SEC, FTC, DOJ investigations or settlements
   - Antitrust actions or regulatory reviews
   - Court rulings, lawsuits, or legal settlements
   - Regulatory approvals or rejections (FDA, FCC, etc.)
   - Policy changes affecting the industry
   - Licensing or permit changes

5. LEADERSHIP & EXECUTIVE COMMUNICATION:
   - CEO/CFO commentary in press, interviews, earnings calls
   - Conference presentations, fireside chats, investor events
   - Tone shifts in executive communications
   - Guidance revisions or soft guidance changes
   - Strategic vision or direction changes
   - Management changes or executive appointments

6. OPERATIONAL DISRUPTIONS & CAPACITY:
   - Factory shutdowns, slowdowns, or closures
   - Supply chain disruptions or supplier changes
   - Key supplier relationships (gains/losses of critical suppliers)
   - Production capacity changes
   - Labor strikes, union actions, or large layoffs
   - Data breaches or security incidents
   - Manufacturing delays or quality issues

7. PARTNERSHIPS, CONTRACTS & CUSTOMERS:
   - Major partnership announcements
   - Large contract wins or losses
   - Customer concentration changes (major customer adds/drops)
   - Supplier relationship changes
   - Joint ventures or strategic alliances
   - Distribution or channel changes

8. CAPITAL ALLOCATION:
   - Dividend changes (increases, cuts, initiations)
   - Share buyback programs or changes
   - M&A transactions (acquisitions, divestitures, spin-offs)
   - Major investments or capital commitments
   - CapEx guidance changes or project announcements
   - Financing activities (debt issuance, equity raises)

9. COMPETITIVE DYNAMICS:
   - Market share shifts (gains/losses)
   - Competitive wins or losses (major contracts, customers)
   - Pricing strategy changes
   - Competitive product launches affecting the company
   - Market positioning shifts

10. MARKET & INDUSTRY DEVELOPMENTS:
    - Industry regulatory changes
    - Market structure shifts
    - Commodity price impacts (for commodity-dependent companies)
    - Currency impacts (for international companies)
    - Demand or supply shocks in the industry

REQUIREMENTS:
- Focus on information published in the LAST 7 DAYS only
- Prioritize Tier 1 sources: SEC.gov, company IR pages, Reuters, Bloomberg, FT, WSJ
- Use specific queries like "${symbol} earnings January 2026" or "${symbol} SEC filing 8-K" or "${symbol} product launch"
- Generate ${numQueries} queries that cover different types of factual updates
- Adapt queries to the company type (tech companies: product launches, geopolitical; manufacturing: operational, suppliers; financial: regulatory, capital; etc.)

Return queries that will find CONCRETE FACTS, not analysis or speculation.`,
    schema: z.object({
      queries: z
        .array(
          z.object({
            query: z.string().describe('The SERP query to find factual updates'),
            researchGoal: z
              .string()
              .describe('What factual update this query is checking for (earnings, filing, regulatory, etc.)'),
          }),
        )
        .max(numQueries)
        .describe(`List of SERP queries, max of ${numQueries}`),
    }),
  });

  return res.object.queries;
}

/**
 * Generate factual queries for a crypto holding
 */
export async function generateCryptoQueries({
  symbol,
  numQueries = 3,
}: {
  symbol: string;
  numQueries?: number;
}): Promise<Array<{ query: string; researchGoal: string }>> {
  const cryptoName = symbol === 'BTC' ? 'Bitcoin' : symbol === 'ETH' ? 'Ethereum' : symbol;
  
  const res = await generateObject({
    model: getModel(),
    system: systemPrompt(),
    prompt: `Generate SERP queries to check for FACTUAL updates about ${cryptoName} (${symbol}) in the LAST 7 DAYS. Focus ONLY on concrete facts, not price speculation or memecoin noise.

FACTUAL UPDATES TO CHECK FOR:
- Protocol-level changes (upgrades, forks, governance proposals - confirmed, not rumors)
- Institutional adoption signals (ETF approvals, custody announcements, corporate adoption)
- Major regulatory news (SEC, CFTC official statements, legislation)
- Major hacks/exploits (confirmed on-chain, not rumors)
- Macro influences (Fed rate decisions, USD moves - only if confirmed official data)

REQUIREMENTS:
- Focus on information published in the LAST 7 DAYS only
- Prioritize Tier 1 sources: SEC.gov, CFTC.gov, Reuters, Bloomberg, FT, WSJ
- AVOID: Price speculation, memecoin coverage, unverified on-chain rumors, analyst predictions
- Generate ${numQueries} queries that cover different types of factual updates

Return queries that will find CONCRETE FACTS, not price speculation or analysis.`,
    schema: z.object({
      queries: z
        .array(
          z.object({
            query: z.string().describe('The SERP query to find factual updates'),
            researchGoal: z
              .string()
              .describe('What factual update this query is checking for (protocol, institutional, regulatory, macro)'),
          }),
        )
        .max(numQueries)
        .describe(`List of SERP queries, max of ${numQueries}`),
    }),
  });

  return res.object.queries;
}

/**
 * Generate factual queries for a commodity holding
 */
export async function generateCommodityQueries({
  symbol,
  numQueries = 3,
}: {
  symbol: string;
  numQueries?: number;
}): Promise<Array<{ query: string; researchGoal: string }>> {
  const commodityName = symbol === 'OIL' || symbol === 'CL' ? 'oil' : 
                        symbol === 'GOLD' || symbol === 'XAU' ? 'gold' :
                        symbol === 'SILVER' || symbol === 'XAG' ? 'silver' :
                        symbol.toLowerCase();
  
  const res = await generateObject({
    model: getModel(),
    system: systemPrompt(),
    prompt: `Generate SERP queries to check for FACTUAL updates about ${commodityName} in the LAST 7 DAYS. Focus ONLY on concrete market facts, not trends or speculation.

FACTUAL UPDATES TO CHECK FOR:
- Current price levels and recent movements (actual numbers, not just "prices rose")
- Supply/demand balance (inventory data, production data from official sources)
- Producer decisions (OPEC statements, major producer announcements)
- Regulatory/policy changes (government decisions, trade policy)
- Inventory levels (EIA data for energy, COMEX data for metals)

REQUIREMENTS:
- Focus on information published in the LAST 7 DAYS only
- Prioritize Tier 1 sources: EIA.gov, OPEC.org, COMEX, Reuters, Bloomberg, FT, WSJ
- Include actual price numbers and data, not just trends
- Generate ${numQueries} queries that cover different aspects (price, supply/demand, producer behavior)

Return queries that will find CONCRETE MARKET DATA, not analysis or speculation.`,
    schema: z.object({
      queries: z
        .array(
          z.object({
            query: z.string().describe('The SERP query to find factual market updates'),
            researchGoal: z
              .string()
              .describe('What market fact this query is checking for (price, supply/demand, producer decision, etc.)'),
          }),
        )
        .max(numQueries)
        .describe(`List of SERP queries, max of ${numQueries}`),
    }),
  });

  return res.object.queries;
}

/**
 * Generate queries for a holding based on its type
 */
export async function generateHoldingQueries(holding: Holding, numQueries = 3): Promise<Array<{ query: string; researchGoal: string }>> {
  switch (holding.type) {
    case 'stock':
      return generateStockQueries({ symbol: holding.symbol, numQueries });
    case 'crypto':
      return generateCryptoQueries({ symbol: holding.symbol, numQueries });
    case 'commodity':
      return generateCommodityQueries({ symbol: holding.symbol, numQueries });
    default:
      // Fallback to stock queries
      return generateStockQueries({ symbol: holding.symbol, numQueries });
  }
}
