import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const fromRoot = (relativePath: string): string =>
  fileURLToPath(new URL(relativePath, import.meta.url));

// Workspace-пакеты резолвим в исходники: иначе тесты проверяют содержимое dist,
// то есть последнюю сборку, а не текущий код.
export const workspaceAliases = [
  {
    find: /^@nutrition-bot\/shared\/testing$/,
    replacement: fromRoot('./packages/shared/src/testing/index.ts'),
  },
  { find: /^@nutrition-bot\/shared$/, replacement: fromRoot('./packages/shared/src/index.ts') },
  { find: /^@nutrition-bot\/ai$/, replacement: fromRoot('./packages/ai/src/index.ts') },
];

export default defineConfig({
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['packages/**/*.test.ts'],
    // Интеграционные наборы требуют настоящую БД — они живут в отдельной команде
    // `npm run test:integration` (vitest.integration.config.ts).
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts'],
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.eval.ts',
        '**/types.ts',
        'packages/shared/src/testing/**',
        'packages/*/src/index.ts',
      ],
      // Порог по набору `npm test` (без integration/eval). Числа — floor текущего
      // покрытия: регресс ломает `npm run test:coverage`, шум v8 на десятые — нет.
      // Глобальный порог считает все файлы, даже те, что ниже покрыты glob'ами.
      thresholds: {
        statements: 34,
        branches: 27,
        functions: 31,
        lines: 34,
        // http-server.ts и config.ts — транспорт (0%), не логика job'ов.
        'packages/scheduler/src/jobs/**/*.ts': {
          statements: 94,
          branches: 88,
          functions: 100,
          lines: 96,
        },
        'packages/shared/src/telegram/sender.ts': {
          statements: 100,
          branches: 91,
          functions: 100,
          lines: 100,
        },
        'packages/ai/src/diary-processor.ts': {
          statements: 100,
          branches: 92,
          functions: 100,
          lines: 100,
        },
        'packages/ai/src/evening-summary.ts': {
          statements: 100,
          branches: 92,
          functions: 100,
          lines: 100,
        },
        'packages/ai/src/history-summary.ts': {
          100: true,
        },
      },
    },
  },
});
