import type { Sequelize } from 'sequelize';
import { getSequelize } from '../db/sequelize.js';
import { Client, initClientModel } from './client.js';
import { ClientEnrollment, initClientEnrollmentModel } from './client-enrollment.js';
import { Course, initCourseModel } from './course.js';
import {
  EnrollmentLinkAttempt,
  initEnrollmentLinkAttemptModel,
} from './enrollment-link-attempt.js';
import { EnrollmentLink, initEnrollmentLinkModel } from './enrollment-link.js';
import { Feedback, initFeedbackModel } from './feedback.js';
import { Message, initMessageModel } from './message.js';
import { NotificationSettings, initNotificationSettingsModel } from './notification-settings.js';
import { NutritionDiary, initNutritionDiaryModel } from './nutrition-diary.js';
import { Questionnaire, initQuestionnaireModel } from './questionnaire.js';
import { Recommendation, initRecommendationModel } from './recommendation.js';
import { Report, initReportModel } from './report.js';
import { RenewalOffer, initRenewalOfferModel } from './renewal-offer.js';

export { Client } from './client.js';
export {
  ClientEnrollment,
  CLIENT_ENROLLMENT_STATUSES,
  ONBOARDING_STATUSES,
  type ClientEnrollmentStatus,
  type OnboardingStatus,
} from './client-enrollment.js';
export { Course } from './course.js';
export { Feedback } from './feedback.js';
export {
  EnrollmentLink,
  ENROLLMENT_LINK_STATUSES,
  type EnrollmentLinkStatus,
} from './enrollment-link.js';
export {
  EnrollmentLinkAttempt,
  ENROLLMENT_LINK_ATTEMPT_RESULTS,
  type EnrollmentLinkAttemptResult,
} from './enrollment-link-attempt.js';
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
  NutritionDiary,
  NUTRITION_DIARY_STATUSES,
  type NutritionDiaryStatus,
} from './nutrition-diary.js';
export {
  NotificationSettings,
  DEFAULT_TIMEZONE,
  DISABLED_REASONS,
  NOTIFICATION_FREQUENCIES,
  NOTIFICATION_TYPES,
  type DisabledReason,
  type NotificationFrequency,
  type NotificationType,
} from './notification-settings.js';
export {
  Questionnaire,
  QUESTIONNAIRE_STATUSES,
  type QuestionnaireStatus,
} from './questionnaire.js';
export {
  Recommendation,
  RECOMMENDATION_PRIORITIES,
  RECOMMENDATION_STATUSES,
  RECOMMENDATION_TYPES,
  type RecommendationPriority,
  type RecommendationStatus,
  type RecommendationType,
} from './recommendation.js';
export {
  Report,
  REPORT_TYPES,
  type DiaryStats,
  type Dynamics,
  type ProblemArea,
  type ReportType,
} from './report.js';
export { RenewalOffer, RENEWAL_OFFER_STATUSES, type RenewalOfferStatus } from './renewal-offer.js';

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

  ClientEnrollment.hasMany(Questionnaire, {
    foreignKey: 'clientEnrollmentId',
    as: 'questionnaires',
  });
  Questionnaire.belongsTo(ClientEnrollment, { foreignKey: 'clientEnrollmentId', as: 'enrollment' });

  Client.hasMany(Questionnaire, { foreignKey: 'clientId', as: 'questionnaires' });
  Questionnaire.belongsTo(Client, { foreignKey: 'clientId', as: 'client' });

  ClientEnrollment.hasMany(NutritionDiary, {
    foreignKey: 'clientEnrollmentId',
    as: 'nutritionDiaries',
  });
  NutritionDiary.belongsTo(ClientEnrollment, {
    foreignKey: 'clientEnrollmentId',
    as: 'enrollment',
  });

  Client.hasMany(NutritionDiary, { foreignKey: 'clientId', as: 'nutritionDiaries' });
  NutritionDiary.belongsTo(Client, { foreignKey: 'clientId', as: 'client' });

  ClientEnrollment.hasMany(EnrollmentLink, { foreignKey: 'enrollmentId', as: 'enrollmentLinks' });
  EnrollmentLink.belongsTo(ClientEnrollment, { foreignKey: 'enrollmentId', as: 'enrollment' });

  EnrollmentLink.hasMany(EnrollmentLinkAttempt, { foreignKey: 'linkId', as: 'attempts' });
  EnrollmentLinkAttempt.belongsTo(EnrollmentLink, { foreignKey: 'linkId', as: 'link' });

  Client.hasMany(Recommendation, { foreignKey: 'clientId', as: 'recommendations' });
  Recommendation.belongsTo(Client, { foreignKey: 'clientId', as: 'client' });

  NutritionDiary.hasMany(Recommendation, { foreignKey: 'nutritionDiaryId', as: 'recommendations' });
  Recommendation.belongsTo(NutritionDiary, {
    foreignKey: 'nutritionDiaryId',
    as: 'nutritionDiary',
  });

  Questionnaire.hasMany(Recommendation, { foreignKey: 'questionnaireId', as: 'recommendations' });
  Recommendation.belongsTo(Questionnaire, { foreignKey: 'questionnaireId', as: 'questionnaire' });

  Recommendation.hasMany(Message, { foreignKey: 'recommendationId', as: 'messages' });
  Message.belongsTo(Recommendation, { foreignKey: 'recommendationId', as: 'recommendation' });

  ClientEnrollment.hasMany(Report, { foreignKey: 'clientEnrollmentId', as: 'reports' });
  Report.belongsTo(ClientEnrollment, { foreignKey: 'clientEnrollmentId', as: 'enrollment' });

  Client.hasMany(Report, { foreignKey: 'clientId', as: 'reports' });
  Report.belongsTo(Client, { foreignKey: 'clientId', as: 'client' });

  ClientEnrollment.hasMany(RenewalOffer, { foreignKey: 'enrollmentId', as: 'renewalOffers' });
  RenewalOffer.belongsTo(ClientEnrollment, { foreignKey: 'enrollmentId', as: 'enrollment' });

  Client.hasMany(RenewalOffer, { foreignKey: 'clientId', as: 'renewalOffers' });
  RenewalOffer.belongsTo(Client, { foreignKey: 'clientId', as: 'client' });

  Client.hasMany(Feedback, { foreignKey: 'clientId', as: 'feedbacks' });
  Feedback.belongsTo(Client, { foreignKey: 'clientId', as: 'client' });

  Recommendation.hasMany(Feedback, { foreignKey: 'recommendationId', as: 'feedbacks' });
  Feedback.belongsTo(Recommendation, { foreignKey: 'recommendationId', as: 'recommendation' });
}

/** Регистрирует все Sequelize-модели на переданном экземпляре. */
export function initModels(sequelize: Sequelize): void {
  initClientModel(sequelize);
  initCourseModel(sequelize);
  initClientEnrollmentModel(sequelize);
  initNotificationSettingsModel(sequelize);
  initMessageModel(sequelize);
  initNutritionDiaryModel(sequelize);
  initEnrollmentLinkModel(sequelize);
  initEnrollmentLinkAttemptModel(sequelize);
  initQuestionnaireModel(sequelize);
  initRecommendationModel(sequelize);
  initReportModel(sequelize);
  initRenewalOfferModel(sequelize);
  initFeedbackModel(sequelize);
  initAssociations();
  modelsInitialized = true;
}

/** Ленивая инициализация моделей при первом обращении к доменным сущностям. */
export function ensureModelsInitialized(): void {
  if (!modelsInitialized) {
    initModels(getSequelize());
  }
}
