/**
 * Wrappers for generateObject and generateText that log costs to DB
 */

import { generateObject as aiGenerateObject, generateText as aiGenerateText } from 'ai';
import { logLLMCostAsync } from '../cost-logger';

type GenerateObjectParams = Parameters<typeof aiGenerateObject>[0];
type GenerateTextParams = Parameters<typeof aiGenerateText>[0];

/** Optional cap from env; set OPENAI_MAX_OUTPUT_TOKENS (e.g. 8192) to limit output tokens. Leave unset for no cap. */
function getMaxOutputTokens(): number | undefined {
  const raw = process.env.OPENAI_MAX_OUTPUT_TOKENS?.trim();
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : undefined;
}

function getModelId(params: { model?: { modelId?: string } }): string {
  return params.model?.modelId ?? 'unknown';
}

function logUsage(
  modelId: string,
  usage: { promptTokens: number; completionTokens: number },
  operation: string,
  runId?: string
): void {
  logLLMCostAsync({
    modelId,
    inputTokens: usage.promptTokens,
    outputTokens: usage.completionTokens,
    operation,
    runId,
  });
}

export async function generateObject<T extends Record<string, unknown>>(
  params: GenerateObjectParams & { runId?: string }
) {
  const { runId, ...rest } = params;
  const maxTokens = rest.maxTokens ?? getMaxOutputTokens();
  const result = await aiGenerateObject({ ...rest, ...(maxTokens != null && { maxTokens }) } as GenerateObjectParams);
  const usage = result.usage;
  if (usage && (usage.promptTokens > 0 || usage.completionTokens > 0)) {
    logUsage(getModelId(params), usage, 'generateObject', runId);
  }
  return result;
}

export async function generateText(
  params: GenerateTextParams & { runId?: string; operation?: string }
) {
  const { runId, operation, ...rest } = params;
  const maxTokens = rest.maxTokens ?? getMaxOutputTokens();
  const result = await aiGenerateText({ ...rest, ...(maxTokens != null && { maxTokens }) } as GenerateTextParams);
  const usage = result.usage;
  if (usage && (usage.promptTokens > 0 || usage.completionTokens > 0)) {
    logUsage(getModelId(params), usage, operation ?? 'generateText', runId);
  }
  return result;
}
