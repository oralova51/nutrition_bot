// Unit-тесты публичного меню команд: /site, /buy и регистрация setMyCommands.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Bot, CommandContext } from 'grammy';
import type { Logger } from 'pino';
import type { BotContext } from '../context.js';
import {
  BOT_COMMANDS,
  BUY_MESSAGE,
  BUY_UNAVAILABLE_MESSAGE,
  handleBuyCommand,
  handleSiteCommand,
  registerBotCommands,
  SITE_MESSAGE,
} from './menu.js';

function createMockCommandContext(): CommandContext<BotContext> {
  return {
    reply: vi.fn(),
  } as unknown as CommandContext<BotContext>;
}

describe('BOT_COMMANDS', () => {
  it('uses Telegram-valid command names', () => {
    for (const item of BOT_COMMANDS) {
      expect(item.command).toMatch(/^[a-z0-9_]{1,32}$/);
    }
  });

  it('lists settings, site and buy', () => {
    expect(BOT_COMMANDS.map((item) => item.command)).toEqual(['settings', 'site', 'buy']);
  });
});

describe('handleSiteCommand', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sends a URL button to the company site', async () => {
    vi.stubEnv('COMPANY_SITE_URL', '');
    const ctx = createMockCommandContext();

    await handleSiteCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledOnce();
    const [, extras] = vi.mocked(ctx.reply).mock.calls[0] as [
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ text: string; url: string }>> } },
    ];
    expect(extras.reply_markup.inline_keyboard[0]?.[0]).toEqual({
      text: 'Открыть сайт',
      url: 'https://lpg39.ru',
    });
    expect(vi.mocked(ctx.reply).mock.calls[0]?.[0]).toBe(SITE_MESSAGE);
  });

  it('uses COMPANY_SITE_URL when it is set', async () => {
    vi.stubEnv('COMPANY_SITE_URL', 'https://www.lpg39.ru/');
    const ctx = createMockCommandContext();

    await handleSiteCommand(ctx);

    const [, extras] = vi.mocked(ctx.reply).mock.calls[0] as [
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ text: string; url: string }>> } },
    ];
    expect(extras.reply_markup.inline_keyboard[0]?.[0]?.url).toBe('https://www.lpg39.ru/');
  });
});

describe('handleBuyCommand', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('explains when checkout URL is not configured yet', async () => {
    vi.stubEnv('SUBSCRIPTION_CHECKOUT_URL', '');
    const ctx = createMockCommandContext();

    await handleBuyCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(BUY_UNAVAILABLE_MESSAGE);
  });

  it('sends a URL button when checkout URL is set', async () => {
    vi.stubEnv('SUBSCRIPTION_CHECKOUT_URL', 'https://yookassa.ru/checkout/placeholder');
    const ctx = createMockCommandContext();

    await handleBuyCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledOnce();
    const [, extras] = vi.mocked(ctx.reply).mock.calls[0] as [
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ text: string; url: string }>> } },
    ];
    expect(vi.mocked(ctx.reply).mock.calls[0]?.[0]).toBe(BUY_MESSAGE);
    expect(extras.reply_markup.inline_keyboard[0]?.[0]).toEqual({
      text: 'Купить абонемент',
      url: 'https://yookassa.ru/checkout/placeholder',
    });
  });
});

describe('registerBotCommands', () => {
  it('calls setMyCommands with the public menu', async () => {
    const setMyCommands = vi.fn().mockResolvedValue(true);
    const logger = { info: vi.fn(), error: vi.fn() } as unknown as Logger;
    const bot = { api: { setMyCommands } } as unknown as Bot<BotContext>;

    await registerBotCommands(bot, logger);

    expect(setMyCommands).toHaveBeenCalledWith([...BOT_COMMANDS]);
    expect(logger.info).toHaveBeenCalled();
  });

  it('logs an error when Telegram API fails', async () => {
    const setMyCommands = vi.fn().mockRejectedValue(new Error('telegram down'));
    const logger = { info: vi.fn(), error: vi.fn() } as unknown as Logger;
    const bot = { api: { setMyCommands } } as unknown as Bot<BotContext>;

    await registerBotCommands(bot, logger);

    expect(logger.error).toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });
});
