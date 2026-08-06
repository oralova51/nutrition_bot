// Unit-тесты для сервиса enrollments (roadmap 8.4: создание нового enrollment при продлении).

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createEnrollmentForClient, serializeEnrollment } from './enrollments.js';
import type { ClientEnrollment as ClientEnrollmentModel } from '@nutrition-bot/shared';

vi.mock('@nutrition-bot/shared', () => ({
  Client: { findByPk: vi.fn() },
  ClientEnrollment: { findOne: vi.fn(), create: vi.fn() },
  Course: { findByPk: vi.fn() },
}));

vi.mock('sequelize', () => ({
  Op: { in: Symbol('Op.in') },
}));

import { Client, ClientEnrollment, Course } from '@nutrition-bot/shared';

const mockedClientFindByPk = vi.mocked(Client.findByPk);
const mockedClientEnrollmentFindOne = vi.mocked(ClientEnrollment.findOne);
const mockedClientEnrollmentCreate = vi.mocked(ClientEnrollment.create);
const mockedCourseFindByPk = vi.mocked(Course.findByPk);

describe('createEnrollmentForClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws 404 when client is not found', async () => {
    mockedClientFindByPk.mockResolvedValue(null);

    await expect(
      createEnrollmentForClient({
        clientId: 'client-1',
        courseId: 'course-1',
        startDate: '2026-08-07',
      }),
    ).rejects.toMatchObject({ code: 'CLIENT_NOT_FOUND' });
  });

  it('throws 404 when course is not found', async () => {
    mockedClientFindByPk.mockResolvedValue({ id: 'client-1' } as unknown as Awaited<
      ReturnType<typeof mockedClientFindByPk>
    >);
    mockedCourseFindByPk.mockResolvedValue(null);

    await expect(
      createEnrollmentForClient({
        clientId: 'client-1',
        courseId: 'course-1',
        startDate: '2026-08-07',
      }),
    ).rejects.toMatchObject({ code: 'COURSE_NOT_FOUND' });
  });

  it('throws 422 when active or paused enrollment exists', async () => {
    mockedClientFindByPk.mockResolvedValue({ id: 'client-1' } as unknown as Awaited<
      ReturnType<typeof mockedClientFindByPk>
    >);
    mockedCourseFindByPk.mockResolvedValue({
      id: 'course-1',
      durationDays: 30,
    } as unknown as Awaited<ReturnType<typeof mockedCourseFindByPk>>);
    mockedClientEnrollmentFindOne.mockResolvedValue({ id: 'enrollment-1' } as unknown as Awaited<
      ReturnType<typeof mockedClientEnrollmentFindOne>
    >);

    await expect(
      createEnrollmentForClient({
        clientId: 'client-1',
        courseId: 'course-1',
        startDate: '2026-08-07',
      }),
    ).rejects.toMatchObject({ code: 'ACTIVE_ENROLLMENT_EXISTS' });
  });

  it('creates enrollment with onboardingStatus completed', async () => {
    mockedClientFindByPk.mockResolvedValue({ id: 'client-1' } as unknown as Awaited<
      ReturnType<typeof mockedClientFindByPk>
    >);
    mockedCourseFindByPk.mockResolvedValue({
      id: 'course-1',
      durationDays: 30,
    } as unknown as Awaited<ReturnType<typeof mockedCourseFindByPk>>);
    mockedClientEnrollmentFindOne.mockResolvedValue(null);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    mockedClientEnrollmentCreate.mockResolvedValue({
      id: 'enrollment-2',
      clientId: 'client-1',
      courseId: 'course-1',
      startDate: '2026-08-07',
      endDate: '2026-09-06',
      status: 'active',
      onboardingStatus: 'completed',
    } as unknown as Awaited<ReturnType<typeof mockedClientEnrollmentCreate>>);

    const result = await createEnrollmentForClient({
      clientId: 'client-1',
      courseId: 'course-1',
      startDate: '2026-08-07',
    });

    expect(mockedClientEnrollmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client-1',
        courseId: 'course-1',
        startDate: '2026-08-07',
        endDate: '2026-09-06',
        onboardingStatus: 'completed',
      }),
    );
    expect(result.enrollment.onboardingStatus).toBe('completed');
  });
});

describe('serializeEnrollment', () => {
  it('returns plain view of enrollment', () => {
    const enrollment = {
      id: 'enrollment-1',
      clientId: 'client-1',
      courseId: 'course-1',
      status: 'active',
      startDate: '2026-08-07',
      endDate: '2026-09-06',
      onboardingStatus: 'completed',
    } as unknown as ClientEnrollmentModel;

    expect(serializeEnrollment(enrollment)).toEqual({
      id: 'enrollment-1',
      clientId: 'client-1',
      courseId: 'course-1',
      status: 'active',
      startDate: '2026-08-07',
      endDate: '2026-09-06',
      onboardingStatus: 'completed',
    });
  });
});
