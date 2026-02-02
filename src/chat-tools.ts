/**
 * Chat tools for the Finance & Economics GPT.
 * Integrates with OpenAI Responses API: web_search_preview + custom function tools.
 */

import OpenAI from 'openai';
import { getPriceDataForHolding } from './price-detection';

const WEB_SEARCH_TOOL = { type: 'web_search_preview' as const };

/** Function tools for price data (Yahoo Finance). */
const CHAT_FUNCTION_TOOLS: OpenAI.Responses.FunctionTool[] = [
  {
    type: 'function',
    name: 'getCryptoPrice',
    strict: false,
    description:
      'Get real-time price of cryptocurrency. Use when user asks: "What\'s the current ETH price?", "Price of Dogecoin now?", "BTC price?". Supports BTC, ETH, SOL, DOGE, XRP.',
    parameters: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Ticker symbol, e.g. BTC, ETH, SOL, DOGE, XRP',
        },
      },
      required: ['symbol'],
    },
  },
  {
    type: 'function',
    name: 'getStockPrice',
    strict: false,
    description:
      'Get real-time price of stocks and ETFs. Use when user asks: "What\'s the price of Tesla?", "How\'s the S&P 500 today?", "AAPL stock price?", "NVDA price?".',
    parameters: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Ticker symbol, e.g. AAPL, TSLA, NVDA, SPY',
        },
      },
      required: ['symbol'],
    },
  },
  {
    type: 'function',
    name: 'getCommodityForexPrice',
    strict: false,
    description:
      'Get real-time price of commodities and forex. Use when user asks: "Gold price right now?", "Crude oil outlook?", "USD/JPY?", "Silver price?". Supports gold, silver, oil, natural gas, DXY, USD/JPY, EUR/USD.',
    parameters: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description:
            'Symbol: GOLD, SILVER, OIL, WTI, BRENT, NG, DXY, USD/JPY, EUR/USD',
        },
      },
      required: ['symbol'],
    },
  },
];

const CHAT_TOOLS: OpenAI.Responses.Tool[] = [
  WEB_SEARCH_TOOL,
  ...CHAT_FUNCTION_TOOLS,
];

function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const symbol = String(args?.symbol ?? '').trim();
  if (!symbol) {
    return Promise.resolve(
      JSON.stringify({ error: 'Missing required parameter: symbol' })
    );
  }

  return getPriceDataForHolding(symbol).then((data) => {
    if (!data) {
      return JSON.stringify({
        error: `Could not fetch price for ${symbol}. Symbol may be invalid or data unavailable.`,
      });
    }
    return JSON.stringify({
      symbol: data.symbol,
      currentPrice: data.currentPrice,
      changePercent7d: data.changePercent.toFixed(2),
      changePercent1d: data.changePercent1d?.toFixed(2),
      price7DaysAgo: data.price7DaysAgo,
    });
  });
}

function extractOutputText(response: OpenAI.Responses.Response): string {
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }
  const output = response.output;
  if (!Array.isArray(output)) return '';

  const parts: string[] = [];
  for (const item of output) {
    const msg = item as {
      type?: string;
      content?: Array<{ type?: string; text?: string }>;
    };
    if (msg.type !== 'message' || !Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block.type === 'output_text' && typeof block.text === 'string') {
        parts.push(block.text);
      }
    }
  }
  return parts.join('\n').trim();
}

function extractUrlsFromResponse(response: OpenAI.Responses.Response): string[] {
  const urls: string[] = [];
  const output = response.output;
  if (!Array.isArray(output)) return urls;

  for (const item of output) {
    const msg = item as {
      content?: Array<{
        type?: string;
        url?: string;
        citation?: { url?: string };
      }>;
    };
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block.type === 'output_text' && typeof block.url === 'string')
        urls.push(block.url);
      if (block.citation?.url) urls.push(block.citation.url);
    }
  }
  return [...new Set(urls)];
}

function getFunctionCalls(
  response: OpenAI.Responses.Response
): Array<{ id: string; name: string; arguments: string }> {
  const output = response.output;
  if (!Array.isArray(output)) return [];

  const calls: Array<{ id: string; name: string; arguments: string }> = [];
  for (const item of output) {
    const fc = item as {
      type?: string;
      name?: string;
      id?: string;
      call_id?: string;
      arguments?: string;
      function?: { name?: string; arguments?: string };
    };
    // Handle Responses API format: type === 'function_call'
    if (fc.type === 'function_call' && fc.name) {
      const callId = fc.call_id ?? fc.id;
      if (callId) {
        calls.push({
          id: callId,
          name: fc.name,
          arguments: fc.arguments ?? '{}',
        });
      }
    }
    // Handle Chat Completions style (sometimes mixed in): type === 'function' with .function
    else if (fc.type === 'function' && fc.function?.name) {
      const callId = fc.call_id ?? fc.id;
      if (callId) {
        calls.push({
          id: callId,
          name: fc.function.name,
          arguments: fc.function.arguments ?? '{}',
        });
      }
    }
  }
  // Log for debugging
  if (calls.length > 0) {
    console.log(
      `[Chat Tools] getFunctionCalls found ${calls.length}:`,
      calls.map((c) => `${c.name}(${c.id})`).join(', ')
    );
  }
  return calls;
}

/**
 * Run chat with web search + price tools.
 * Handles agentic loop for function calls.
 * @param prompt - User message (may include knowledge base context)
 * @param options.model - OpenAI model (default: gpt-4o-mini)
 * @param options.systemPrompt - System instructions (optional)
 */
export async function runChatWithTools(
  prompt: string,
  options?: { model?: string; systemPrompt?: string }
): Promise<{ text: string; urls: string[] } | null> {
  const apiKey = process.env.OPENAI_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const client = new OpenAI({ apiKey });
  const model = options?.model ?? 'gpt-4o-mini';

  // System instructions for tool usage
  const systemInstructions = options?.systemPrompt || `You are a helpful financial assistant with access to real-time price tools.

IMPORTANT TOOL USAGE:
- When the user asks for a current/real-time price of ANY stock, crypto, commodity, or forex, ALWAYS call the appropriate price tool FIRST.
- getCryptoPrice: For BTC, ETH, SOL, DOGE, XRP
- getStockPrice: For stocks like AAPL, MSFT, NVDA, TSLA, SPY, etc.
- getCommodityForexPrice: For GOLD, SILVER, OIL, USD/JPY, EUR/USD
- Do NOT answer price questions from memory or the knowledge base - use the tools to get live data.
- After getting the price, provide helpful context.`;

  const initialInput: OpenAI.Responses.ResponseInputItem[] = [
    { type: 'message', role: 'user', content: prompt },
  ];

  let fullInput: OpenAI.Responses.ResponseInputItem[] = [...initialInput];
  console.log(`[Chat Tools] Starting with instructions: ${systemInstructions.slice(0, 100)}...`);
  let response: OpenAI.Responses.Response = await client.responses.create({
    model,
    instructions: systemInstructions,
    input: fullInput,
    tools: CHAT_TOOLS,
  });
  const allUrls: string[] = [...extractUrlsFromResponse(response)];

  const MAX_STEPS = 5;
  for (let step = 0; step < MAX_STEPS; step++) {
    // Debug: log all output item types
    if (Array.isArray(response.output)) {
      const types = response.output.map((item) => {
        const i = item as { type?: string; name?: string; id?: string; call_id?: string };
        return `${i.type ?? 'unknown'}${i.name ? ':' + i.name : ''}${i.call_id ?? i.id ? '(' + (i.call_id ?? i.id) + ')' : ''}`;
      });
      console.log(`[Chat Tools] Step ${step + 1} output items:`, types.join(', '));
    }

    const calls = getFunctionCalls(response);
    if (calls.length === 0) break;

    console.log(`[Chat Tools] Step ${step + 1}: Found ${calls.length} function call(s)`);

    const outputs: OpenAI.Responses.ResponseInputItem.FunctionCallOutput[] = [];
    for (const call of calls) {
      console.log(`[Chat Tools] Executing ${call.name} with call_id ${call.id}`);
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.arguments || '{}');
      } catch {
        args = {};
      }
      const result = await executeTool(call.name, args);
      console.log(`[Chat Tools] Result: ${result.slice(0, 100)}...`);
      outputs.push({
        type: 'function_call_output',
        call_id: call.id,
        output: result,
      });
    }

    console.log(
      `[Chat Tools] Continuing with ${fullInput.length} input items + ${response.output.length} output items + ${outputs.length} function outputs`
    );
    fullInput = [...fullInput, ...response.output, ...outputs];
    response = await client.responses.create({
      model,
      instructions: systemInstructions,
      input: fullInput,
      tools: CHAT_TOOLS,
    });
    allUrls.push(...extractUrlsFromResponse(response));
  }

  const text = extractOutputText(response);
  return { text, urls: [...new Set(allUrls)] };
}
