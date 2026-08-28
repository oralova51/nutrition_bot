import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@nutrition-bot/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nutrition-bot/shared')>();
  return {
    ...actual,
    sendAdminAlert: vi.fn(),
    Course: { findByPk: vi.fn() },
    Questionnaire: { findOne: vi.fn() },
  };
});

import { Course, Questionnaire, sendAdminAlert, type Report } from '@nutrition-bot/shared';
import { makeTestLogger } from '@nutrition-bot/shared/testing';
import { notifyAdminAboutCourseCompletion } from './admin-course-summary.js';

const mockedSendAdminAlert = vi.mocked(sendAdminAlert);
const mockedCourseFindByPk = vi.mocked(Course.findByPk);
const mockedQuestionnaireFindOne = vi.mocked(Questionnaire.findOne);

function buildEnrollment() {
  return {
    id: 'enr-1',
    clientId: 'client-1',
    courseId: 'course-1',
    startDate: '2026-08-01',
    endDate: '2026-08-30',
    client: {
      id: 'client-1',
      firstName: 'Анна',
      lastName: 'Иванова',
      telegramId: '123',
      telegramUsername: 'anna',
    },
  };
}

const report = {
  periodStart: '2026-08-01',
  periodEnd: '2026-08-30',
  diaryStats: { totalDays: 30, totalRecords: 4, filledEntries: 4, avgCalories: 1400 },
  adherencePercent: 50,
  problemAreas: [],
} as unknown as Report;

describe('notifyAdminAboutCourseCompletion', () => {
  beforeEach(() => {
    mockedSendAdminAlert.mockReset();
    mockedCourseFindByPk.mockReset();
    mockedQuestionnaireFindOne.mockReset();
    mockedSendAdminAlert.mockResolvedValue(undefined);
    mockedCourseFindByPk.mockResolvedValue({ name: 'Курс 30 дней' } as never);
    mockedQuestionnaireFindOne.mockResolvedValue({
      answers: { goal: 'weight_loss' },
    } as never);
  });

  it('sends a digest to the administrator', async () => {
    await notifyAdminAboutCourseCompletion(buildEnrollment() as never, report, makeTestLogger());

    expect(mockedSendAdminAlert).toHaveBeenCalledOnce();
    const text = mockedSendAdminAlert.mock.calls[0]?.[0] ?? '';
    expect(text).toContain('Анна Иванова');
    expect(text).toContain('Курс 30 дней');
    expect(text).toContain('Снизить вес');
    expect(text).toContain('4 заполнено / 4 записей');
  });

  it('does not throw if the admin alert fails', async () => {
    mockedSendAdminAlert.mockRejectedValue(new Error('Telegram недоступен'));

    await expect(
      notifyAdminAboutCourseCompletion(buildEnrollment() as never, report, makeTestLogger()),
    ).resolves.toBeUndefined();
  });

  it('skips send when enrollment has no client', async () => {
    const enrollment = { id: 'enr-1', clientId: 'client-1', courseId: 'course-1' };

    await notifyAdminAboutCourseCompletion(enrollment as never, report, makeTestLogger());

    expect(mockedSendAdminAlert).not.toHaveBeenCalled();
  });
});
