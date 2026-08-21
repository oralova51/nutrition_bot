import { defineConfig } from 'vitest/config';
import { workspaceAliases } from './vitest.config.js';

// Интеграционные наборы работают с настоящей БД: они требуют TEST_DATABASE_URL и
// чистят данные между кейсами, поэтому запускаются отдельной командой
// `npm run test:integration`, а не вместе с детерминированными юнит-тестами.
export default defineConfig({
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['packages/**/*.integration.test.ts'],
    setupFiles: ['./test/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Наборы делят одну базу и чистят её целиком — параллельный прогон файлов
    // приводил бы к тому, что один тест стирает данные другого.
    fileParallelism: false,
  },
});
