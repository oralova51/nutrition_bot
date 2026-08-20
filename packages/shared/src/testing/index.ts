// Точка входа тестовых утилит: подключается как `@nutrition-bot/shared/testing`.
// Намеренно не реэкспортируется из основного index.ts, чтобы vitest
// не попал в зависимости production-сборки.

export * from './database.js';
export * from './factories.js';
export * from './mock-model.js';
