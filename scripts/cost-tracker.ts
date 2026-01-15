// Cost tracking utilities for test scripts
// Tracks API costs for Firecrawl and LLM calls

export type CostEntry = {
  service: 'firecrawl' | 'openai' | 'fireworks' | 'other';
  operation: string;
  count: number;
  costPerUnit: number;
  totalCost: number;
  metadata?: Record<string, any>;
};

export class CostTracker {
  private costs: CostEntry[] = [];
  private startTime: number;

  constructor() {
    this.startTime = Date.now();
  }

  // Firecrawl costs (approximate)
  // Search: ~$0.01 per search (varies by plan)
  // Scrape: ~$0.05-0.10 per page (varies by plan)
  trackFirecrawlSearch(count: number = 1) {
    const costPerSearch = 0.01; // $0.01 per search
    this.costs.push({
      service: 'firecrawl',
      operation: 'search',
      count,
      costPerUnit: costPerSearch,
      totalCost: count * costPerSearch,
      metadata: { type: 'search' },
    });
  }

  trackFirecrawlScrape(count: number = 1) {
    const costPerScrape = 0.075; // $0.075 per scrape (average)
    this.costs.push({
      service: 'firecrawl',
      operation: 'scrape',
      count,
      costPerUnit: costPerScrape,
      totalCost: count * costPerScrape,
      metadata: { type: 'scrape' },
    });
  }

  // LLM costs (approximate, varies by model)
  // OpenAI o3-mini: ~$0.15 per 1M input tokens, $0.60 per 1M output tokens
  // Fireworks R1: Similar pricing
  trackLLMCall(
    model: string,
    inputTokens: number,
    outputTokens: number,
    operation: string = 'generate'
  ) {
    // Estimate costs based on model
    let inputCostPer1M = 0.15;
    let outputCostPer1M = 0.60;

    if (model.includes('r1') || model.includes('fireworks')) {
      // Fireworks R1 pricing (approximate)
      inputCostPer1M = 0.20;
      outputCostPer1M = 0.80;
    } else if (model.includes('gpt-4') || model.includes('o1')) {
      // GPT-4 or O1 pricing (higher)
      inputCostPer1M = 2.50;
      outputCostPer1M = 10.00;
    }

    const inputCost = (inputTokens / 1_000_000) * inputCostPer1M;
    const outputCost = (outputTokens / 1_000_000) * outputCostPer1M;
    const totalCost = inputCost + outputCost;

    this.costs.push({
      service: model.includes('fireworks') ? 'fireworks' : 'openai',
      operation,
      count: 1,
      costPerUnit: totalCost,
      totalCost,
      metadata: {
        model,
        inputTokens,
        outputTokens,
        inputCost,
        outputCost,
      },
    });
  }

  // Estimate LLM call cost based on prompt length (rough estimate)
  trackLLMCallEstimate(
    model: string,
    promptLength: number,
    estimatedOutputLength: number = 500,
    operation: string = 'generate'
  ) {
    // Rough token estimation: ~4 chars per token
    const inputTokens = Math.ceil(promptLength / 4);
    const outputTokens = Math.ceil(estimatedOutputLength / 4);
    this.trackLLMCall(model, inputTokens, outputTokens, operation);
  }

  getTotalCost(): number {
    return this.costs.reduce((sum, entry) => sum + entry.totalCost, 0);
  }

  getCostsByService(): Record<string, number> {
    const byService: Record<string, number> = {};
    for (const entry of this.costs) {
      byService[entry.service] = (byService[entry.service] || 0) + entry.totalCost;
    }
    return byService;
  }

  getCostsByOperation(): Record<string, number> {
    const byOperation: Record<string, number> = {};
    for (const entry of this.costs) {
      byOperation[entry.operation] = (byOperation[entry.operation] || 0) + entry.totalCost;
    }
    return byOperation;
  }

  getSummary() {
    const totalTime = Date.now() - this.startTime;
    return {
      totalCost: this.getTotalCost(),
      totalTime: totalTime,
      costByService: this.getCostsByService(),
      costByOperation: this.getCostsByOperation(),
      entryCount: this.costs.length,
      costs: this.costs,
    };
  }

  getCosts(): CostEntry[] {
    return [...this.costs];
  }

  reset() {
    this.costs = [];
    this.startTime = Date.now();
  }
}
