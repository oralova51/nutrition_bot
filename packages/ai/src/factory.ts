/**
 * Фабрика AIEngine.
 * Выбирает реализацию на основе переменной окружения AI_PROVIDER.
 */

import { resolveAIConfig } from './config.js';
import { MockAIEngine } from './mock-engine.js';
import { OpenAICompatibleAIEngine } from './openai-compatible-engine.js';
import type { AIEngine } from './types.js';

let cachedEngine: AIEngine | undefined;

export function createAIEngine(): AIEngine {
  if (cachedEngine) return cachedEngine;

  const config = resolveAIConfig();

  if (config.provider === 'openai-compatible') {
    cachedEngine = new OpenAICompatibleAIEngine(config);
  } else {
    cachedEngine = new MockAIEngine();
  }

  return cachedEngine;
}

/** Сбросить кэшированный инстанс (полезно для тестов). */
export function resetAIEngine(): void {
  cachedEngine = undefined;
}
