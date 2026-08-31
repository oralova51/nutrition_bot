import { describe, expect, it } from 'vitest';
import {
  TELEGRAM_MAX_MESSAGE_LENGTH,
  sanitizeTelegramHtml,
  stripTelegramHtml,
  truncateTelegramText,
} from './html.js';

describe('sanitizeTelegramHtml', () => {
  it('сохраняет парные <b> и экранирует сравнения', () => {
    expect(sanitizeTelegramHtml('<b>Сводка</b>\nбелка < 20 г & много')).toBe(
      '<b>Сводка</b>\nбелка &lt; 20 г &amp; много',
    );
  });

  it('превращает <br> в перевод строки, а чужие теги экранирует', () => {
    expect(sanitizeTelegramHtml('<b>День</b><br>салат<ul>')).toBe('<b>День</b>\nсалат&lt;ul&gt;');
  });

  it('снимает непарные <b>, чтобы Telegram не отверг сообщение', () => {
    expect(sanitizeTelegramHtml('<b>Заголовок без закрытия')).toBe('Заголовок без закрытия');
  });
});

describe('stripTelegramHtml', () => {
  it('оставляет читаемый текст без тегов', () => {
    expect(stripTelegramHtml('<b>Сводка</b><br>обед')).toBe('Сводка\nобед');
  });
});

describe('truncateTelegramText', () => {
  it('не трогает короткий текст', () => {
    expect(truncateTelegramText('привет')).toBe('привет');
  });

  it('закрывает обрезанный <b> и не превышает лимит', () => {
    const text = `<b>${'а'.repeat(TELEGRAM_MAX_MESSAGE_LENGTH)}</b>`;
    const result = truncateTelegramText(text);
    expect(result.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE_LENGTH);
    expect(result.endsWith('…')).toBe(true);
    expect(result.includes('</b>')).toBe(true);
  });
});
