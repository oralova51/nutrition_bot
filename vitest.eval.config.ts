import { defineConfig } from 'vitest/config';
import { workspaceAliases } from './vitest.config.js';

// Eval-наборы проверяют свойства ответа AI Engine и не должны смешиваться
// с быстрыми юнит-тестами. Запускаются отдельной командой `npm run eval`.
export default defineConfig({
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['packages/**/*.eval.ts'],
    setupFiles: ['./test/setup.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // У AI-провайдера есть rate limit — параллельный прогон файлов его выбивает.
    fileParallelism: false,
    // Наборы появятся вместе с ИИ-уточнениями (roadmap 13.8); до тех пор
    // команда должна завершаться успехом, а не «сломанным» кодом возврата.
    passWithNoTests: true,
  },
});
