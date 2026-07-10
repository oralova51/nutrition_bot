// Курсы студии — adminAPI.md §4.2.

import { Course } from '@nutrition-bot/shared';
import { addDaysToIsoDate } from '../validation.js';

export interface CourseView {
  id: string;
  name: string;
  durationDays: number;
  startDate: string;
  endDate: string;
}

export interface CreateCourseInput {
  name: string;
  durationDays: number;
  startDate: string;
}

export function serializeCourse(course: Course): CourseView {
  return {
    id: course.id,
    name: course.name,
    durationDays: course.durationDays,
    startDate: course.startDate,
    endDate: course.endDate,
  };
}

/** GET /admin/courses (adminAPI.md §4.2). */
export async function listCourses(): Promise<Course[]> {
  return Course.findAll({ order: [['startDate', 'DESC']] });
}

/**
 * POST /admin/courses (adminAPI.md §4.2, roadmap 12.1).
 * `endDate` вычисляется как `startDate + durationDays` (см. пример enrollment в §4.3,
 * подтверждающий формулу; пример в §4.2 расходится на 1 день — считаем опиской в доке).
 */
export async function createCourse(input: CreateCourseInput): Promise<Course> {
  const endDate = addDaysToIsoDate(input.startDate, input.durationDays);

  return Course.create({
    name: input.name,
    durationDays: input.durationDays,
    startDate: input.startDate,
    endDate,
  });
}
