// Проверка прав администратора Telegram-бота.
// MVP: один allowlist ID из ADMIN_ALERT_TELEGRAM_ID (тот же, что для алертов доставки).

export function resolveAdminTelegramId(): string | undefined {
  const raw = process.env.ADMIN_ALERT_TELEGRAM_ID;
  if (!raw || raw.trim().length === 0) {
    return undefined;
  }
  return raw.trim();
}

/** true, если update пришёл от администратора из allowlist. */
export function isAdminTelegramUser(telegramId: number | string | undefined): boolean {
  if (telegramId === undefined) {
    return false;
  }
  const adminId = resolveAdminTelegramId();
  if (!adminId) {
    return false;
  }
  return String(telegramId) === adminId;
}
