// Роуты курсов студии — adminAPI.md §4.2.

import { readJsonBody, sendJson } from '../http.js';
import type { RouteContext, RouteDefinition } from '../router.js';
import { createCourse, listCourses, serializeCourse } from '../services/courses.js';
import {
  requireIsoDate,
  requireObjectBody,
  requirePositiveInteger,
  requireString,
} from '../validation.js';

export function createCourseRoutes(): RouteDefinition[] {
  return [
    {
      method: 'GET',
      pattern: '/admin/courses',
      requiresAdminAuth: true,
      handler: async ({ res }: RouteContext): Promise<void> => {
        const courses = await listCourses();
        sendJson(res, 200, { data: courses.map(serializeCourse) });
      },
    },
    {
      method: 'POST',
      pattern: '/admin/courses',
      requiresAdminAuth: true,
      handler: async ({ req, res }: RouteContext): Promise<void> => {
        const body = requireObjectBody(await readJsonBody(req));

        const course = await createCourse({
          name: requireString(body, 'name'),
          durationDays: requirePositiveInteger(body, 'durationDays'),
          startDate: requireIsoDate(body, 'startDate'),
        });

        sendJson(res, 201, serializeCourse(course));
      },
    },
  ];
}
