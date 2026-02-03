import { createFireworks } from '@ai-sdk/fireworks';
import { createOpenAI } from '@ai-sdk/openai';
import {
  extractReasoningMiddleware,
  LanguageModelV1,
  wrapLanguageModel,
} from 'ai';
import { getEncoding } from 'js-tiktoken';

import { RecursiveCharacterTextSplitter } from './text-splitter';

// Providers
const openai = process.env.OPENAI_KEY
  ? createOpenAI({
      apiKey: process.env.OPENAI_KEY,
      baseURL: process.env.OPENAI_ENDPOINT || 'https://api.openai.com/v1',
    })
  : undefined;

const fireworks = process.env.FIREWORKS_KEY
  ? createFireworks({
      apiKey: process.env.FIREWORKS_KEY,
    })
  : undefined;

const customModel = process.env.CUSTOM_MODEL
  ? openai?.(process.env.CUSTOM_MODEL, {
      structuredOutputs: true,
    })
  : undefined;

// Models — default is gpt-4o-mini; set DEFAULT_MODEL or CUSTOM_MODEL to override
const gpt4oMiniModel = openai?.('gpt-4o-mini', {
  structuredOutputs: true,
});

const o3MiniModel = openai?.('o3-mini', {
  reasoningEffort: 'medium',
  structuredOutputs: true,
});

const deepSeekR1Model = fireworks
  ? wrapLanguageModel({
      model: fireworks(
        'accounts/fireworks/models/deepseek-r1',
      ) as LanguageModelV1,
      middleware: extractReasoningMiddleware({ tagName: 'think' }),
    })
  : undefined;

/** Resolve default OpenAI model from DEFAULT_MODEL env (default: gpt-4o-mini). */
function getDefaultOpenAIModel(): LanguageModelV1 | undefined {
  const raw = process.env.DEFAULT_MODEL?.trim() || 'gpt-4o-mini';
  const name = raw.toLowerCase();
  if (name === 'o3-mini') return o3MiniModel;
  if (name === 'gpt-4o-mini') return gpt4oMiniModel;
  return openai?.(raw, { structuredOutputs: true });
}

export function getModel(): LanguageModelV1 {
  if (customModel) return customModel;
  const model = deepSeekR1Model ?? getDefaultOpenAIModel() ?? gpt4oMiniModel ?? o3MiniModel;
  if (!model) throw new Error('No model found');
  return model as LanguageModelV1;
}

/** Get a model by id (e.g. 'gpt-4o-mini', 'o3-mini'). Used for overrides like news-brief. */
export function getModelById(id: string): LanguageModelV1 {
  const name = id?.trim().toLowerCase() || 'gpt-4o-mini';
  if (name === 'o3-mini') return (o3MiniModel ?? getModel()) as LanguageModelV1;
  if (name === 'gpt-4o-mini') return (gpt4oMiniModel ?? getModel()) as LanguageModelV1;
  const custom = openai?.(id.trim(), { structuredOutputs: true });
  if (custom) return custom as LanguageModelV1;
  return getModel();
}

/** Model for news-brief card/opening generation. Default gpt-4o-mini for cost; set NEWS_BRIEF_MODEL to override. */
export function getModelForNewsBrief(): LanguageModelV1 {
  const raw = process.env.NEWS_BRIEF_MODEL?.trim() || 'gpt-4o-mini';
  return getModelById(raw);
}

const MinChunkSize = 140;
const encoder = getEncoding('o200k_base');

// trim prompt to maximum context size
export function trimPrompt(
  prompt: string,
  contextSize = Number(process.env.CONTEXT_SIZE) || 128_000,
) {
  if (!prompt) {
    return '';
  }

  const length = encoder.encode(prompt).length;
  if (length <= contextSize) {
    return prompt;
  }

  const overflowTokens = length - contextSize;
  // on average it's 3 characters per token, so multiply by 3 to get a rough estimate of the number of characters
  const chunkSize = prompt.length - overflowTokens * 3;
  if (chunkSize < MinChunkSize) {
    return prompt.slice(0, MinChunkSize);
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap: 0,
  });
  const trimmedPrompt = splitter.splitText(prompt)[0] ?? '';

  // last catch, there's a chance that the trimmed prompt is same length as the original prompt, due to how tokens are split & innerworkings of the splitter, handle this case by just doing a hard cut
  if (trimmedPrompt.length === prompt.length) {
    return trimPrompt(prompt.slice(0, chunkSize), contextSize);
  }

  // recursively trim until the prompt is within the context size
  return trimPrompt(trimmedPrompt, contextSize);
}
