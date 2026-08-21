# ФТ-24: Ежедневный вечерний summary (evening summary)

> Спецификация + чек-лист ручной проверки. Связь: `Functional_Requirements.md` (ФТ-24), roadmap этап 4D.

## 1. Цель

Клиент в течение дня пишет приёмы пищи (завтрак, обед, ужин, перекусы). Вечером бот присылает **одну** развёрнутую сводку: что хватало, чего не хватало, что добавить и улучшить.

Это **не** ФТ-8 (короткое напоминание «не услышал про ужин») и **не** ФТ-14 (итоговый отчёт за весь курс).

## 2. Расписание и условия

| Параметр | Значение |
|----------|----------|
| Время | `21:00` в TZ клиента (MVP: `Europe/Kaliningrad`) |
| Cron | `*/30 * * * *` (как другие TZ-aware job'ы) |
| Тип уведомления | `evening_summary` в `NotificationSettings.enabledTypes` |
| Минимум данных | ≥ 1 запись `NutritionDiary` со `status = filled` за текущий день |
| Лимит | 1 summary / клиент / день |
| Категория Message | `optional` (блокируется `/stop`) |
| Тип Message | `evening_summary` |
| Тип Report | `daily` (`periodStart = periodEnd = YYYY-MM-DD` дня) |

### Независимость от ФТ-8

- **20:00** — evening reminder, если записей за день `< 3`
- **21:00** — evening summary, если есть ≥ 1 `filled` запись

Клиент может получить оба сообщения в один вечер (например, 2 записи → reminder + summary).

## 3. Содержимое сообщения

Мягкий тон (ФТ-7). Сводка **может** перечислить день («сегодня был бокал пива») — это обзор, не реакция «через две секунды». Разовый treat не превращать в пункт «замени на воду / протеиновый коктейль». Повтор того же класса — мягкая частотная заметка в «можно улучшить».

Структура текста:

1. Короткое приветствие / заголовок дня
2. **Что хватало** — позитивные наблюдения
3. **Чего не хватало** — дефициты без осуждения
4. **Что можно добавить** — конкретные предложения на завтра
5. **Что можно улучшить** — 1–2 мягких совета

AI Engine: `generateEveningSummary(input)` → `EveningSummaryResult` с блоками + готовым `summaryText` для Telegram (HTML допустим, как в других сообщениях).

## 4. Данные

- Создаётся/обновляется `Report`:
  - `type = daily`
  - `diaryStats` (кол-во записей, avgCalories, topProducts и т.п.)
  - `problemAreas`
  - `aiSummary` = полный текст сводки
- Уникальность: один daily-Report на `(client_enrollment_id, period_start)`
- Отправляется `Message` с `type = evening_summary`

## 5. Ручной запуск (тест)

Scheduler HTTP API (порт `SCHEDULER_PORT`, по умолчанию `3002`):

```http
POST /internal/jobs/evening-summary
Authorization: Bearer <ADMIN_API_TOKEN>
Content-Type: application/json

{ "force": true, "clientId": "<uuid>" }
```

`ADMIN_API_TOKEN` — тот же, что в корневом `.env` и что для admin API на порту 3000.
В Postman переменная `adminToken` = **только токен**, без слова `Bearer` (иначе получится `Bearer Bearer ...` → 401).

`force=true` — игнорирует слот 21:00 и дневной дедуп (для локального теста). Без `force` endpoint отвечает `400 FORCE_REQUIRED`.

Ответ:

```json
{
  "job": "evening-summary",
  "force": true,
  "considered": 1,
  "sent": 1,
  "skipped": 0,
  "errors": 0
}
```

Проверить результат:

- Telegram клиента — сообщение-сводка
- `GET /api/v1/specialist/clients/:id/reports?type=daily` — появился daily-Report
- В БД: `messages.type = 'evening_summary'`, `reports.type = 'daily'`

## 6. Postman

Коллекция: `postman/scheduler-jobs.postman_collection.json`  
Запросы: **Evening summary (force, все…)** и **Evening summary (force, один clientId)**.

Переменные: `schedulerUrl`, `adminToken`, `clientId`.

## 7. Чек-лист

- [ ] Миграции применены (`evening_summary` в messages, `daily` в reports, тип в enabledTypes)
- [ ] У тестового клиента `enabledTypes` содержит `evening_summary`, onboarding completed, telegramId есть
- [ ] Есть ≥ 1 filled-запись дневника «сегодня» (по Kaliningrad)
- [ ] `POST .../evening-summary` с `force=true` → `sent >= 1`
- [ ] В Telegram пришла сводка с блоками «хватало / не хватало / добавить / улучшить»
- [ ] `GET .../reports?type=daily` возвращает отчёт
- [ ] Повторный запуск **без** force в тот же день → `skipped` (дедуп)
- [ ] Клиент без записей за день → `skipped`
- [ ] `/settings` — можно выключить тип «Вечерняя сводка»
- [ ] При `enabled=false` или без `evening_summary` в типах → не отправляется
