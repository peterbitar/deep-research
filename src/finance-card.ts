/**
 * Generate one report card using the finance app's external chat API.
 * Uses FINANCE_APP_URL if set; otherwise defaults to the Railway finance app (cards via Railway).
 */

export interface FinanceCardResult {
  title: string;
  content: string;
  emoji: string;
  eventType?: string;
}

/** Railway finance app URL used for cards when FINANCE_APP_URL is not set. */
const DEFAULT_FINANCE_APP_URL = 'https://advanced-chat-production.up.railway.app';

const CARD_PROMPT = (symbol: string) =>
  `Write a single investor news card for ${symbol} in the exact format below. Reply with ONLY a JSON object, no other text.

RULES:
- Only developments from the past 7 days. Plain English, conversational (like a smart friend over coffee). For long-term investors. No bullet points.
- Title: ONE short sentence (8-14 words), what happened and why it matters. No jargon.
- Emoji: one relevant emoji (e.g. 📰 💰 📉 🏦 🌍).
- Content: 4-6 paragraphs. Each paragraph MUST be: **bold mini-headline** (3-6 words, no period) then " - " then the paragraph content on the SAME line. Use double newlines (\\n\\n) between paragraphs. No bullet points.

Example content format:
**Here's what happened** - Bitcoin pulled back from highs as risk-off sentiment hit. ETF flows turned positive again.
**Why it matters** - For long-term holders, volatility is normal; the story is whether demand holds.
**What to watch** - Macro and regulatory headlines. If inflows persist, dips may keep getting bought.

JSON keys: "title", "emoji", "content". Example: {"title":"Bitcoin slid as risk-off hit; ETF inflows returned.","emoji":"📉","content":"**Here's what happened** - ...\\n\\n**Why it matters** - ..."}`;

/**
 * Call finance app's external chat API and parse response into one card.
 * Returns null if FINANCE_APP_URL is unset or the request fails.
 */
export async function generateOneCardFromFinance(
  symbol: string
): Promise<FinanceCardResult | null> {
  const baseUrl = (
    process.env.FINANCE_APP_URL !== undefined
      ? process.env.FINANCE_APP_URL
      : DEFAULT_FINANCE_APP_URL
  ).trim();
  if (!baseUrl) {
    console.warn('[Finance Card] No finance app URL (set FINANCE_APP_URL or use default Railway)');
    return null;
  }

  const url = `${baseUrl.replace(/\/$/, '')}/api/chat/external`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: CARD_PROMPT(symbol),
        model: 'openai',
        disableLocal: true,
      }),
      signal: AbortSignal.timeout(300_000), // 5 minutes
    });

    if (!res.ok) {
      console.warn(`[Finance Card] ${res.status} ${res.statusText}`);
      return null;
    }

    const data = (await res.json()) as { success?: boolean; response?: string };
    const text = data?.response?.trim() || '';
    if (!text) return null;

    // Try to parse JSON from the response (may be wrapped in markdown code block)
    let jsonStr = text;
    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlock) jsonStr = codeBlock[1].trim();
    const firstBrace = jsonStr.indexOf('{');
    if (firstBrace >= 0) jsonStr = jsonStr.slice(firstBrace);
    const lastBrace = jsonStr.lastIndexOf('}');
    if (lastBrace > firstBrace) jsonStr = jsonStr.slice(0, lastBrace + 1);

    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
    const content = typeof parsed.content === 'string' ? parsed.content.trim() : '';
    const emoji = typeof parsed.emoji === 'string' ? parsed.emoji.trim() || '📰' : '📰';
    if (!title || !content) return null;

    return { title, content, emoji };
  } catch (e) {
    console.warn('[Finance Card]', e instanceof Error ? e.message : e);
    return null;
  }
}
