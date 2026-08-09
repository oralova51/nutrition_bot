// Сервис настроек уведомлений: inline-клавиатуры, форматирование и работа с БД.
// Реализует ФТ-3 (roadmap 3.16–3.24): время, частота, типы, /settings.
// Часовой пояс фиксирован: Europe/Kaliningrad (MVP, все клиенты студии).

import {
  DEFAULT_TIMEZONE,
  NotificationSettings,
  type NotificationFrequency,
  type NotificationType,
} from '@nutrition-bot/shared';
import { InlineKeyboard } from 'grammy';

export const TIME_SLOTS = [
  '07:00',
  '07:30',
  '08:00',
  '08:30',
  '09:00',
  '09:30',
  '10:00',
  '10:30',
  '11:00',
  '11:30',
  '12:00',
  '12:30',
  '13:00',
  '13:30',
  '14:00',
  '14:30',
  '15:00',
  '15:30',
  '16:00',
  '16:30',
  '17:00',
  '17:30',
  '18:00',
  '18:30',
  '19:00',
  '19:30',
  '20:00',
  '20:30',
  '21:00',
] as const;

export const FREQUENCY_LABELS: Record<NotificationFrequency, string> = {
  daily: 'Ежедневно',
  every_other_day: 'Через день',
  three_per_week: '3 раза в неделю',
  custom_days: 'По дням недели',
};

export const TYPE_LABELS: Record<NotificationType, string> = {
  diary: 'Дневник питания',
  recommendations: 'Рекомендации',
  weekly_report: 'Еженедельный отчёт',
};

function chunk<T>(array: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

export async function getOrCreateSettings(clientId: string): Promise<NotificationSettings> {
  const settings = await NotificationSettings.findOne({ where: { clientId } });
  if (settings) {
    if (settings.timezone !== DEFAULT_TIMEZONE) {
      await settings.update({ timezone: DEFAULT_TIMEZONE });
    }
    return settings;
  }
  return NotificationSettings.create({ clientId, timezone: DEFAULT_TIMEZONE });
}

export function buildTimeKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const row of chunk(TIME_SLOTS, 4)) {
    keyboard.row(...row.map((slot) => InlineKeyboard.text(slot, `settings:time:${slot}`)));
  }
  return keyboard;
}

export function buildFrequencyKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .row(
      InlineKeyboard.text(FREQUENCY_LABELS.daily, 'settings:freq:daily'),
      InlineKeyboard.text(FREQUENCY_LABELS.every_other_day, 'settings:freq:every_other_day'),
    )
    .row(InlineKeyboard.text(FREQUENCY_LABELS.three_per_week, 'settings:freq:three_per_week'));
}

export function buildTypesKeyboard(settings: NotificationSettings): InlineKeyboard {
  const enabled = new Set(settings.enabledTypes);
  const keyboard = new InlineKeyboard();
  for (const type of Object.keys(TYPE_LABELS) as NotificationType[]) {
    const label = `${enabled.has(type) ? '✅' : '⬜'} ${TYPE_LABELS[type]}`;
    keyboard.row(InlineKeyboard.text(label, `settings:type:${type}`));
  }
  keyboard.row(InlineKeyboard.text('Готово', 'settings:types_done'));
  return keyboard;
}

export function buildSettingsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .row(
      InlineKeyboard.text('Изменить время', 'settings:edit:time'),
      InlineKeyboard.text('Изменить частоту', 'settings:edit:frequency'),
    )
    .row(InlineKeyboard.text('Изменить типы', 'settings:edit:types'));
}

export function formatFrequency(frequency: NotificationFrequency): string {
  return FREQUENCY_LABELS[frequency] ?? frequency;
}

export function formatTypes(enabledTypes: NotificationType[]): string {
  if (enabledTypes.length === 0) return 'не выбраны';
  return enabledTypes.map((type) => TYPE_LABELS[type] ?? type).join(', ');
}

export function formatSettingsMessage(settings: NotificationSettings): string {
  const status = settings.enabled ? 'включены' : 'отключены';
  return (
    `Текущие настройки уведомлений (${status}):

` +
    `⏰ Время: ${settings.reminderTime}\n` +
    `📅 Частота: ${formatFrequency(settings.frequency)}\n` +
    `📨 Типы: ${formatTypes(settings.enabledTypes)}`
  );
}

export async function toggleNotificationType(
  settings: NotificationSettings,
  type: NotificationType,
): Promise<NotificationType[]> {
  const enabled = new Set(settings.enabledTypes);
  if (enabled.has(type)) {
    enabled.delete(type);
  } else {
    enabled.add(type);
  }
  const newTypes = [...enabled] as NotificationType[];
  await settings.update({ enabledTypes: newTypes });
  return newTypes;
}
