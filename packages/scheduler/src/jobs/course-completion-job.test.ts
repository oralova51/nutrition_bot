// ФТ-13: job завершения курса — тонкая обёртка над сервисом, поэтому проверяем
// проброс опций ручного запуска и форму результата.

import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/course-completion.js', () => ({ findAndCompleteCourses: vi.fn() }));

import { makeTestLogger } from '@nutrition-bot/shared/testing';
import { findAndCompleteCourses } from '../services/course-completion.js';
import { runCourseCompletionJob } from './course-completion-job.js';

describe('runCourseCompletionJob', () => {
  it('возвращает итог сервиса под именем job', async () => {
    vi.mocked(findAndCompleteCourses).mockResolvedValue({
      considered: 3,
      sent: 2,
      skipped: 1,
      errors: 0,
    });

    const result = await runCourseCompletionJob(makeTestLogger());

    expect(result).toEqual({
      job: 'course-completion',
      force: false,
      considered: 3,
      sent: 2,
      skipped: 1,
      errors: 0,
    });
  });

  it('пробрасывает force и clientId в сервис', async () => {
    vi.mocked(findAndCompleteCourses).mockResolvedValue({
      considered: 1,
      sent: 1,
      skipped: 0,
      errors: 0,
    });

    const result = await runCourseCompletionJob(makeTestLogger(), {
      force: true,
      clientId: 'client-1',
    });

    expect(findAndCompleteCourses).toHaveBeenCalledWith(expect.anything(), {
      force: true,
      clientId: 'client-1',
    });
    expect(result.force).toBe(true);
  });
});
