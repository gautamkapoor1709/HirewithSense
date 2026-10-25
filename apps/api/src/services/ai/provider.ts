import type { z } from 'zod';
import { env } from '../../config/env.js';

export interface JsonCompletionOptions<T> {
  task: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  temperature?: number;
  maxTokens?: number;
  /** Use the stronger/reasoning model when configured. */
  strong?: boolean;
}

export interface TextStreamOptions {
  task: string;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AiProvider {
  readonly name: string;
  readonly model: string | null;
  readonly configured: boolean;
  completeJson<T>(opts: JsonCompletionOptions<T>): Promise<T>;
  streamText(opts: TextStreamOptions): AsyncIterable<string>;
}

let provider: AiProvider | null = null;

export async function getAi(): Promise<AiProvider> {
  if (provider) return provider;
  const e = env();
  if (e.AI_PROVIDER === 'openai_compatible' && e.AI_API_KEY) {
    const { OpenAiCompatibleProvider } = await import('./openaiCompatible.js');
    provider = new OpenAiCompatibleProvider();
  } else {
    const { MockAiProvider } = await import('./mock.js');
    provider = new MockAiProvider();
  }
  return provider;
}

/** Test seam. */
export function setAiProvider(p: AiProvider | null) {
  provider = p;
}
