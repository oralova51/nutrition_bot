// Кастомный контекст grammY бота.
// roadmap 2.2: заполняется в middleware src/middleware/client-context.ts.

import type { Client } from '@nutrition-bot/shared';
import type { Context } from 'grammy';

export type BotContext = Context & {
  /**
   * Client, найденный по telegramId текущего update.
   * undefined, если Client с таким telegramId ещё не существует: клиент заводится
   * администратором заранее (adminAPI.md §3 EnrollmentLink) и получает telegramId
   * только при активации ссылки-приглашения (roadmap 2.4–2.5).
   */
  client?: Client;
};
