import type { Sequelize } from 'sequelize';
import { getSequelize } from '../db/sequelize.js';
import { initClientModel } from './client.js';
import { initCourseModel } from './course.js';

export { Client } from './client.js';
export { Course } from './course.js';

let modelsInitialized = false;

/** Регистрирует все Sequelize-модели на переданном экземпляре. */
export function initModels(sequelize: Sequelize): void {
  initClientModel(sequelize);
  initCourseModel(sequelize);
  modelsInitialized = true;
}

/** Ленивая инициализация моделей при первом обращении к доменным сущностям. */
export function ensureModelsInitialized(): void {
  if (!modelsInitialized) {
    initModels(getSequelize());
  }
}
