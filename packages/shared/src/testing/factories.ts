// Фабрики тестовых данных: собирают поддельные экземпляры моделей с разумными
// значениями по умолчанию. Набор полей выводится из самих моделей через
// InferAttributes, поэтому новое поле в модели ломает сборку фабрики,
// а не тихо остаётся незаполненным.

import type { InferAttributes, Model } from 'sequelize';
import type { Client } from '../models/client.js';
import type { ClientEnrollment } from '../models/client-enrollment.js';
import type { Course } from '../models/course.js';
import type { EnrollmentLink } from '../models/enrollment-link.js';
import type { Feedback } from '../models/feedback.js';
import type { Message } from '../models/message.js';
import type { NotificationSettings } from '../models/notification-settings.js';
import type { NutritionDiary } from '../models/nutrition-diary.js';
import type { Questionnaire } from '../models/questionnaire.js';
import type { Recommendation } from '../models/recommendation.js';
import type { RenewalOffer } from '../models/renewal-offer.js';
import type { Report } from '../models/report.js';
import { DEFAULT_TIMEZONE } from '../models/notification-settings.js';
import { buildMockModel, type MockModel } from './mock-model.js';

/**
 * Опорный момент времени для тестов: середина месяца, будний день, утро
 * по Europe/Kaliningrad. Используйте вместе с `vi.setSystemTime(TEST_NOW)`,
 * чтобы логика с часовыми поясами и «сегодняшним днём» была детерминированной.
 */
export const TEST_NOW = new Date('2026-01-15T09:00:00.000Z');

type Overrides<T extends Model> = Partial<InferAttributes<T>>;

export function makeClient(overrides: Overrides<Client> = {}): MockModel<Client> {
  const attributes: InferAttributes<Client> = {
    id: 'client-1',
    firstName: 'Анна',
    lastName: 'Иванова',
    telegramId: '100200300',
    telegramUsername: 'anna_test',
    email: null,
    phone: null,
    registeredAt: TEST_NOW,
    lastInteractionAt: TEST_NOW,
    ...overrides,
  };

  return buildMockModel(attributes) as unknown as MockModel<Client>;
}

export function makeCourse(overrides: Overrides<Course> = {}): MockModel<Course> {
  const attributes: InferAttributes<Course> = {
    id: 'course-1',
    name: 'Курс 30 дней',
    durationDays: 30,
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    ...overrides,
  };

  return buildMockModel(attributes) as unknown as MockModel<Course>;
}

export function makeEnrollment(
  overrides: Overrides<ClientEnrollment> = {},
): MockModel<ClientEnrollment> {
  const attributes: InferAttributes<ClientEnrollment> = {
    id: 'enrollment-1',
    clientId: 'client-1',
    courseId: 'course-1',
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    status: 'active',
    onboardingStatus: 'completed',
    ...overrides,
  };

  return buildMockModel(attributes) as unknown as MockModel<ClientEnrollment>;
}

export function makeEnrollmentLink(
  overrides: Overrides<EnrollmentLink> = {},
): MockModel<EnrollmentLink> {
  const attributes: InferAttributes<EnrollmentLink> = {
    id: 'link-1',
    enrollmentId: 'enrollment-1',
    code: 'abcdefgh12345678',
    expiresAt: new Date('2026-01-22T09:00:00.000Z'),
    usedAt: null,
    usedByTelegramId: null,
    status: 'active',
    createdAt: TEST_NOW,
    revokedAt: null,
    ...overrides,
  };

  return buildMockModel(attributes) as unknown as MockModel<EnrollmentLink>;
}

export function makeNotificationSettings(
  overrides: Overrides<NotificationSettings> = {},
): MockModel<NotificationSettings> {
  const attributes: InferAttributes<NotificationSettings> = {
    id: 'notification-settings-1',
    clientId: 'client-1',
    reminderTime: '09:00',
    frequency: 'daily',
    enabledTypes: ['diary', 'recommendations', 'weekly_report', 'evening_summary'],
    timezone: DEFAULT_TIMEZONE,
    enabled: true,
    disabledReason: null,
    ...overrides,
  };

  return buildMockModel(attributes) as unknown as MockModel<NotificationSettings>;
}

export function makeQuestionnaire(
  overrides: Overrides<Questionnaire> = {},
): MockModel<Questionnaire> {
  const attributes: InferAttributes<Questionnaire> = {
    id: 'questionnaire-1',
    clientEnrollmentId: 'enrollment-1',
    clientId: 'client-1',
    answers: {},
    currentQuestion: 0,
    status: 'in_progress',
    lastAnswerAt: null,
    lastReminderAt: null,
    completedAt: null,
    analysisResult: null,
    ...overrides,
  };

  return buildMockModel(attributes) as unknown as MockModel<Questionnaire>;
}

export function makeDiaryEntry(
  overrides: Overrides<NutritionDiary> = {},
): MockModel<NutritionDiary> {
  const attributes: InferAttributes<NutritionDiary> = {
    id: 'diary-1',
    clientEnrollmentId: 'enrollment-1',
    clientId: 'client-1',
    mealAt: TEST_NOW,
    description: 'Овсянка с яблоком',
    approxCalories: null,
    hasPhoto: false,
    photoRef: null,
    status: 'filled',
    clarificationAttempts: 0,
    createdAt: TEST_NOW,
    ...overrides,
  };

  return buildMockModel(attributes) as unknown as MockModel<NutritionDiary>;
}

export function makeMessage(overrides: Overrides<Message> = {}): MockModel<Message> {
  const attributes: InferAttributes<Message> = {
    id: 'message-1',
    clientId: 'client-1',
    recommendationId: null,
    type: 'info',
    category: 'optional',
    content: 'Тестовое сообщение',
    channel: 'telegram',
    deliveryStatus: 'sent',
    retryCount: 0,
    createdAt: TEST_NOW,
    ...overrides,
  };

  return buildMockModel(attributes) as unknown as MockModel<Message>;
}

export function makeRecommendation(
  overrides: Overrides<Recommendation> = {},
): MockModel<Recommendation> {
  const attributes: InferAttributes<Recommendation> = {
    id: 'recommendation-1',
    clientId: 'client-1',
    nutritionDiaryId: 'diary-1',
    questionnaireId: null,
    type: 'habit',
    priority: 'medium',
    content: 'Попробуй добавить стакан воды к следующему приёму пищи.',
    status: 'sent',
    createdAt: TEST_NOW,
    ...overrides,
  };

  return buildMockModel(attributes) as unknown as MockModel<Recommendation>;
}

export function makeFeedback(overrides: Overrides<Feedback> = {}): MockModel<Feedback> {
  const attributes: InferAttributes<Feedback> = {
    id: 'feedback-1',
    clientId: 'client-1',
    recommendationId: 'recommendation-1',
    rating: 5,
    comment: null,
    isApplied: null,
    isResolved: false,
    source: 'recommendation',
    createdAt: TEST_NOW,
    ...overrides,
  };

  return buildMockModel(attributes) as unknown as MockModel<Feedback>;
}

export function makeReport(overrides: Overrides<Report> = {}): MockModel<Report> {
  const attributes: InferAttributes<Report> = {
    id: 'report-1',
    clientEnrollmentId: 'enrollment-1',
    clientId: 'client-1',
    periodStart: '2026-01-01',
    periodEnd: '2026-01-31',
    type: 'final',
    diaryStats: { totalDays: 30, totalRecords: 45, filledEntries: 45, pendingEntries: 0 },
    adherencePercent: 70,
    problemAreas: [],
    dynamics: { calorieTrend: 'stable', adherenceTrend: 'up' },
    aiSummary: null,
    createdAt: TEST_NOW,
    ...overrides,
  };

  return buildMockModel(attributes) as unknown as MockModel<Report>;
}

export function makeRenewalOffer(overrides: Overrides<RenewalOffer> = {}): MockModel<RenewalOffer> {
  const attributes: InferAttributes<RenewalOffer> = {
    id: 'renewal-offer-1',
    clientId: 'client-1',
    enrollmentId: 'enrollment-1',
    status: 'sent',
    checkoutUrl: 'https://example.test/checkout/renewal-offer-1',
    basePrice: 1_000_000,
    discountPercent: 15,
    finalPrice: 850_000,
    offeredAt: TEST_NOW,
    clickedAt: null,
    ...overrides,
  };

  return buildMockModel(attributes) as unknown as MockModel<RenewalOffer>;
}
