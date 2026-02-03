/**
 * Cost configuration - Firecrawl (credit-based) and OpenAI (token-based).
 * Reads from env with defaults; used by cost-logger.
 */

export type CostConfig = {
  /** Firecrawl plan price in USD (e.g. 113) */
  firecrawlPlanPriceUsd: number;
  /** Firecrawl monthly credit bucket (e.g. 100000) */
  firecrawlMonthlyCredits: number;
  /** OpenAI input price per 1M tokens (USD) */
  openaiInputUsdPer1M: number;
  /** OpenAI output price per 1M tokens (USD) */
  openaiOutputUsdPer1M: number;
  /** Optional per-model overrides: modelId -> { inputPer1M, outputPer1M } */
  openaiModelOverrides: Record<string, { inputPer1M: number; outputPer1M: number }>;
};

const defaultConfig: CostConfig = {
  firecrawlPlanPriceUsd: 113,
  firecrawlMonthlyCredits: 100_000,
  openaiInputUsdPer1M: 0.15,
  openaiOutputUsdPer1M: 0.6,
  openaiModelOverrides: {
    // More specific first (getOpenAIRates uses substring match)
    'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
    'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10.0 },
    'o4-mini': { inputPer1M: 2.5, outputPer1M: 10.0 },
    'gpt-4': { inputPer1M: 2.5, outputPer1M: 10.0 },
    'o1': { inputPer1M: 2.5, outputPer1M: 10.0 },
    'r1': { inputPer1M: 0.2, outputPer1M: 0.8 },
    fireworks: { inputPer1M: 0.2, outputPer1M: 0.8 },
  },
};

function parseNum(val: string | undefined, fallback: number): number {
  if (val === undefined || val === '') return fallback;
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : fallback;
}

let cached: CostConfig | null = null;

export function getCostConfig(): CostConfig {
  if (cached) return cached;
  cached = {
    firecrawlPlanPriceUsd: parseNum(process.env.FIRECRAWL_PLAN_PRICE_USD, defaultConfig.firecrawlPlanPriceUsd),
    firecrawlMonthlyCredits: parseNum(process.env.FIRECRAWL_MONTHLY_CREDITS, defaultConfig.firecrawlMonthlyCredits),
    openaiInputUsdPer1M: parseNum(process.env.OPENAI_INPUT_USD_PER_1M, defaultConfig.openaiInputUsdPer1M),
    openaiOutputUsdPer1M: parseNum(process.env.OPENAI_OUTPUT_USD_PER_1M, defaultConfig.openaiOutputUsdPer1M),
    openaiModelOverrides: defaultConfig.openaiModelOverrides,
  };
  return cached;
}

/** Effective cost per Firecrawl credit (plan_price / monthly_credits) */
export function getFirecrawlEffectiveUsdPerCredit(): number {
  const c = getCostConfig();
  if (c.firecrawlMonthlyCredits <= 0) return 0;
  return c.firecrawlPlanPriceUsd / c.firecrawlMonthlyCredits;
}

/** OpenAI rates per 1M tokens for a model (config or override) */
export function getOpenAIRates(modelId: string): { inputPer1M: number; outputPer1M: number } {
  const c = getCostConfig();
  const m = (modelId || '').toLowerCase();
  for (const [key, rates] of Object.entries(c.openaiModelOverrides)) {
    if (m.includes(key)) return rates;
  }
  return { inputPer1M: c.openaiInputUsdPer1M, outputPer1M: c.openaiOutputUsdPer1M };
}
