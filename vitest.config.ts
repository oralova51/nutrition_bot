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
    },
  },
});
