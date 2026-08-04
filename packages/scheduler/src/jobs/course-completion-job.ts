// Job завершения курса (roadmap 7.1–7.2, ФТ-13).
// Запускается раз в день в 00:01 UTC — после полуночи для всех российских часовых поясов,
// чтобы статус enrollment уже стал completed до утреннего ежедневного напоминания.

import { findAndCompleteCourses } from '../services/course-completion.js';
import type { Logger } from 'pino';

export async function runCourseCompletionJob(logger: Logger): Promise<void> {
  logger.info('Старт job завершения курсов');
  await findAndCompleteCourses(logger);
  logger.info('Job завершения курсов завершён');
}
