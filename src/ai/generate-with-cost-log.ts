/**
 * Wrappers for generateObject and generateText that log costs to DB
 */

import { generateObject as aiGenerateObject, generateText as aiGenerateText } from 'ai';
import { logLLMCostAsync } from '../cost-logger';

type GenerateObjectParams = Parameters<typeof aiGenerateObject>[0];
type GenerateTextParams = Parameters<typeof aiGenerateText>[0];

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
  const result = await aiGenerateObject(rest as GenerateObjectParams);
  const usage = result.usage;
  if (usage && (usage.promptTokens > 0 || usage.completionTokens > 0)) {
    logUsage(getModelId(params), usage, 'generateObject', runId);
  }
  return result;
}

export async function generateText(params: GenerateTextParams & { runId?: string }) {
  const { runId, ...rest } = params;
  const result = await aiGenerateText(rest as GenerateTextParams);
  const usage = result.usage;
  if (usage && (usage.promptTokens > 0 || usage.completionTokens > 0)) {
    logUsage(getModelId(params), usage, 'generateText', runId);
  }
  return result;
}
