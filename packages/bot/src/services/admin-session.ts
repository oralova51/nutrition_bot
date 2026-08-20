// In-memory сессии админ-диалога в Telegram.
// Для одного администратора на пилоте достаточно; переживает только lifetime процесса бота.

export type AdminSession =
  { step: 'awaiting_course_days' } | { step: 'awaiting_client_name'; courseId: string };

const sessions = new Map<string, AdminSession>();

export function getAdminSession(telegramId: string): AdminSession | undefined {
  return sessions.get(telegramId);
}

export function setAdminSession(telegramId: string, session: AdminSession): void {
  sessions.set(telegramId, session);
}

export function clearAdminSession(telegramId: string): void {
  sessions.delete(telegramId);
}
