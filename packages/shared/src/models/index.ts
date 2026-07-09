import type { Sequelize } from 'sequelize';
import { getSequelize } from '../db/sequelize.js';
import { Client, initClientModel } from './client.js';
import { ClientEnrollment, initClientEnrollmentModel } from './client-enrollment.js';
import { Course, initCourseModel } from './course.js';

export { Client } from './client.js';
export {
  ClientEnrollment,
  CLIENT_ENROLLMENT_STATUSES,
  ONBOARDING_STATUSES,
  type ClientEnrollmentStatus,
  type OnboardingStatus,
} from './client-enrollment.js';
export { Course } from './course.js';

let modelsInitialized = false;

function initAssociations(): void {
  Client.hasMany(ClientEnrollment, { foreignKey: 'clientId', as: 'enrollments' });
  ClientEnrollment.belongsTo(Client, { foreignKey: 'clientId', as: 'client' });

  Course.hasMany(ClientEnrollment, { foreignKey: 'courseId', as: 'enrollments' });
  ClientEnrollment.belongsTo(Course, { foreignKey: 'courseId', as: 'course' });
}

/** Регистрирует все Sequelize-модели на переданном экземпляре. */
export function initModels(sequelize: Sequelize): void {
  initClientModel(sequelize);
  initCourseModel(sequelize);
  initClientEnrollmentModel(sequelize);
  initAssociations();
  modelsInitialized = true;
}

/** Ленивая инициализация моделей при первом обращении к доменным сущностям. */
export function ensureModelsInitialized(): void {
  if (!modelsInitialized) {
    initModels(getSequelize());
  }
}
