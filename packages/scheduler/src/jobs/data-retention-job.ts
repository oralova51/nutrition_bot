// Job политики хранения: удаляет данные клиентов, у которых все enrollment'ы
// завершились более 12 месяцев назад (nonFR §3, roadmap 11.2).

import { subMonths } from 'date-fns';
import type { Logger } from 'pino';
import { ClientEnrollment, deleteClientData, getSequelize } from '@nutrition-bot/shared';
import type { SchedulerJobOptions, SchedulerJobResult } from './types.js';

const DEFAULT_RETENTION_MONTHS = 12;

function resolveRetentionMonths(): number {
  const raw = process.env.DATA_RETENTION_MONTHS;
  if (!raw) return DEFAULT_RETENTION_MONTHS;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 1) return DEFAULT_RETENTION_MONTHS;
  return parsed;
}

export async function runDataRetentionJob(
  logger: Logger,
  options?: SchedulerJobOptions,
): Promise<SchedulerJobResult> {
  const retentionMonths = resolveRetentionMonths();
  const cutoffDate = subMonths(new Date(), retentionMonths);
  cutoffDate.setHours(0, 0, 0, 0);

  logger.info(
    { cutoffDate: cutoffDate.toISOString(), retentionMonths },
    'Запуск job очистки данных по политике хранения',
  );

  const enrollmentGroups = (await ClientEnrollment.findAll({
    attributes: [
      'clientId',
      [getSequelize().fn('MAX', getSequelize().col('end_date')), 'maxEndDate'],
    ],
    group: ['clientId'],
    raw: true,
  })) as unknown as Array<{ clientId: string; maxEndDate: string }>;

  const clientIdsToDelete = enrollmentGroups
    .filter((group) => new Date(group.maxEndDate) < cutoffDate)
    .map((group) => group.clientId);

  if (clientIdsToDelete.length === 0) {
    logger.info('Нет клиентов, подпадающих под политику хранения');
    return {
      job: 'data-retention',
      force: options?.force ?? false,
      considered: 0,
      sent: 0,
      skipped: 0,
      errors: 0,
    };
  }

  logger.info({ clientCount: clientIdsToDelete.length }, 'Клиенты для удаления по сроку хранения');

  let deletedClients = 0;
  let errors = 0;

  for (const clientId of clientIdsToDelete) {
    try {
      await deleteClientData(clientId);
      deletedClients += 1;
      logger.info({ clientId }, 'Данные клиента удалены по политике хранения');
    } catch (err) {
      errors += 1;
      logger.error({ err, clientId }, 'Ошибка удаления данных клиента по политике хранения');
    }
  }

  const skipped = clientIdsToDelete.length - deletedClients;

  logger.info({ deletedClients, skipped, errors }, 'Job очистки данных завершён');
  return {
    job: 'data-retention',
    force: options?.force ?? false,
    considered: clientIdsToDelete.length,
    sent: deletedClients,
    skipped,
    errors,
  };
}
