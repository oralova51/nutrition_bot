// Job завершения курса (roadmap 7.1–7.2, ФТ-13).
// Запускается раз в день в 00:01 UTC — после полуночи для всех российских часовых поясов,
// чтобы статус enrollment уже стал completed до утреннего ежедневного напоминания.
// force=true + clientId — ручная симуляция конца курса до endDate (Postman).

import { findAndCompleteCourses } from '../services/course-completion.js';
import type { Logger } from 'pino';
import type { SchedulerJobOptions, SchedulerJobResult } from './types.js';

export async function runCourseCompletionJob(
  logger: Logger,
  options: SchedulerJobOptions = {},
): Promise<SchedulerJobResult> {
  const force = options.force === true;
  logger.info(
    { force, clientId: options.clientId ?? null },
    'Старт job завершения курсов',
  );

  const outcome = await findAndCompleteCourses(logger, {
    force,
    clientId: options.clientId,
  });

  logger.info(
    { ...outcome, force, clientId: options.clientId ?? null },
    'Job завершения курсов завершён',
  );

  return {
    job: 'course-completion',
    force,
    considered: outcome.considered,
    sent: outcome.sent,
    skipped: outcome.skipped,
    errors: outcome.errors,
  };
}
