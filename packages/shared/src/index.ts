// Точка входа общего пакета. Реэкспортирует доменные типы, константы и утилиты.
// Наполняется на последующих шагах этапа 1 (модели/типы) и далее.

export const PACKAGE_NAME = '@nutrition-bot/shared';

export * from './config/renewal.js';
export * from './db/index.js';
export * from './encryption/index.js';
export * from './logging/index.js';
export * from './models/index.js';
export * from './questionnaire/template.js';
export * from './services/data-deletion.js';
export * from './telegram/alerts.js';
export * from './telegram/sender.js';
