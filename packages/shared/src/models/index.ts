import type { Sequelize } from 'sequelize';
import { getSequelize } from '../db/sequelize.js';
import { Client, initClientModel } from './client.js';
import { ClientEnrollment, initClientEnrollmentModel } from './client-enrollment.js';
import { Course, initCourseModel } from './course.js';
import { Message, initMessageModel } from './message.js';
import { NotificationSettings, initNotificationSettingsModel } from './notification-settings.js';

export { Client } from './client.js';
export {
  ClientEnrollment,
  CLIENT_ENROLLMENT_STATUSES,
  ONBOARDING_STATUSES,
  type ClientEnrollmentStatus,
  type OnboardingStatus,
} from './client-enrollment.js';
export { Course } from './course.js';
export {
  Message,
  DELIVERY_STATUSES,
  MESSAGE_CATEGORIES,
  MESSAGE_CHANNELS,
  MESSAGE_TYPES,
  type DeliveryStatus,
  type MessageCategory,
  type MessageChannel,
  type MessageType,
} from './message.js';
export {
  NotificationSettings,
  DISABLED_REASONS,
  NOTIFICATION_FREQUENCIES,
  NOTIFICATION_TYPES,
  type DisabledReason,
  type NotificationFrequency,
  type NotificationType,
} from './notification-settings.js';

let modelsInitialized = false;

function initAssociations(): void {
  Client.hasMany(ClientEnrollment, { foreignKey: 'clientId', as: 'enrollments' });
  ClientEnrollment.belongsTo(Client, { foreignKey: 'clientId', as: 'client' });

  Course.hasMany(ClientEnrollment, { foreignKey: 'courseId', as: 'enrollments' });
  ClientEnrollment.belongsTo(Course, { foreignKey: 'courseId', as: 'course' });

  Client.hasOne(NotificationSettings, { foreignKey: 'clientId', as: 'notificationSettings' });
  NotificationSettings.belongsTo(Client, { foreignKey: 'clientId', as: 'client' });

  Client.hasMany(Message, { foreignKey: 'clientId', as: 'messages' });
  Message.belongsTo(Client, { foreignKey: 'clientId', as: 'client' });
}

/** Регистрирует все Sequelize-модели на переданном экземпляре. */
export function initModels(sequelize: Sequelize): void {
  initClientModel(sequelize);
  initCourseModel(sequelize);
  initClientEnrollmentModel(sequelize);
  initNotificationSettingsModel(sequelize);
  initMessageModel(sequelize);
  initAssociations();
  modelsInitialized = true;
}

/** Ленивая инициализация моделей при первом обращении к доменным сущностям. */
export function ensureModelsInitialized(): void {
  if (!modelsInitialized) {
    initModels(getSequelize());
  }
}
