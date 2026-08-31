// Telegram parse_mode=HTML принимает узкий набор тегов и падает на любом «лишнем» `<`.
// Вечерняя сводка нейронки часто приходит с <br>, markdown и сравнениями вроде «белка < 20 г».

export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

const BOLD_OPEN = '\u0001B\u0001';
const BOLD_CLOSE = '\u0001/B\u0001';

/** Оставляет только парные <b>, экранирует остальной HTML, обрезает до лимита Telegram. */
export function sanitizeTelegramHtml(text: string): string {
  const withBreaks = text.replace(/<br\s*\/?>/gi, '\n');
  const marked = withBreaks.replace(/<b>/gi, BOLD_OPEN).replace(/<\/b>/gi, BOLD_CLOSE);
  const escaped = marked.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const openCount = countOccurrences(escaped, BOLD_OPEN);
  const closeCount = countOccurrences(escaped, BOLD_CLOSE);
  const restored =
    openCount > 0 && openCount === closeCount
      ? escaped.replaceAll(BOLD_OPEN, '<b>').replaceAll(BOLD_CLOSE, '</b>')
      : escaped.replaceAll(BOLD_OPEN, '').replaceAll(BOLD_CLOSE, '');

  return truncateTelegramText(restored);
}

/** Убирает разметку, если Telegram отклонил HTML — клиент всё равно получит текст. */
export function stripTelegramHtml(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?b>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function truncateTelegramText(text: string, max = TELEGRAM_MAX_MESSAGE_LENGTH): string {
  if (text.length <= max) return text;

  const ellipsis = '…';
  const closeTag = '</b>';
  let sliced = text.slice(0, max - ellipsis.length);
  const opens = countOccurrences(sliced, '<b>');
  const closes = countOccurrences(sliced, closeTag);
  if (opens > closes) {
    const budget = max - ellipsis.length - closeTag.length;
    sliced = `${text.slice(0, Math.max(0, budget))}${closeTag}`;
  }
  return `${sliced}${ellipsis}`;
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}
