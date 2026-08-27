# Этап 10. Ошибки и edge cases (Фаза 8 SA)

> Закрывает: roadmap 10.1–10.8, ФТ-21, ФТ-22, nonFR §6.  
> Связанные документы: `Functional_Requirements.md`, `nonFR.md`, `SA_SUMMARY.md`.

## 1. Что входит в этап

- Централизованный retry отправки в Telegram (3 попытки с интервалом 5 мин).
- Статус `delivery_failed` на сущности `Message`.
- Уведомление администратора при фатальном сбое доставки.
- Изоляция ошибок одного клиента: scheduler и бот не падают из-за одного сбоя.
- Валидация некорректного ввода в дневник: «Кажется, я не понял. Можете переформулировать?».
- После 3 попыток уточнения запись `NutritionDiary` остаётся в статусе `needs_clarification`.
- Admin-просмотр записей `needs_clarification` через фильтр дневника.
- Алерт администратору при массовых сбоях доставки Telegram.

## 2. Централизованный retry Telegram

- Реализован в `packages/shared/src/telegram/sender.ts`.
- `sendTelegramMessage` — синхронная отправка без retry, используется ботом для real-time ответов.
- `sendTelegramMessageWithRetry` — отправка для scheduler/background: до 3 попыток, пауза 5 мин.
- Постоянные ошибки Telegram (`400 chat not found`, `403 forbidden` и аналогичные) **не ретраятся**: сразу `delivery_failed` и один алерт. Повторный алерт по тому же клиенту — не чаще раза в 24 ч. Окно считается по записям `Message` со статусом `delivery_failed` (не только по памяти процесса), чтобы рестарт scheduler не спамил администратора.
- При каждой неудаче поле `Message.retryCount` увеличивается, `deliveryStatus` временно `delivery_failed`.
- После исчерпания попыток `Message.deliveryStatus` окончательно `delivery_failed`, ошибка логируется и администратор получает алерт.
- Важно: повторные попытки обновляют одну и ту же запись `Message`, а не создают новые.

## 3. Уведомление администратора при delivery_failed

- Если задана переменная окружения `ADMIN_ALERT_TELEGRAM_ID`, система отправляет личное сообщение администратору в Telegram при исчерпании retry. Повтор по тому же `clientId` в течение 24 ч не отправляется.
- Сообщение содержит: `clientId`, `messageId`, тип сообщения, количество попыток и текст ошибки.
- Если `ADMIN_ALERT_TELEGRAM_ID` не задан или отправка не удалась — ошибка только в лог, работа не прерывается.

## 4. Массовые сбои доставки (roadmap 10.8)

- Job: `packages/scheduler/src/jobs/delivery-failure-alert-job.ts`.
- Запускается каждые 10 минут.
- Считает сообщения со статусом `delivery_failed` за окно `MASS_FAILURE_WINDOW_MINUTES` (default 30).
- Если количество ≥ `MASS_FAILURE_THRESHOLD` (default 5) — отправляет алерт администратору.
- Дедупликация: не чаще одного алерта за `MASS_FAILURE_ALERT_INTERVAL_MINUTES` (default 60), чтобы не спамить.
- Параметры настраиваются в `.env`:
  - `ADMIN_ALERT_TELEGRAM_ID`
  - `MASS_FAILURE_WINDOW_MINUTES`
  - `MASS_FAILURE_THRESHOLD`
  - `MASS_FAILURE_ALERT_INTERVAL_MINUTES`

## 5. Валидация ввода и needs_clarification

- Реализовано в `packages/bot/src/services/nutrition-diary.ts`.
- При неполном/нераспознанном описании бот просит переформулировать: «Кажется, я не понял. Можете переформулировать?».
- Создаётся запись `NutritionDiary` со статусом `needs_clarification` и `clarificationAttempts = 1`.
- При каждой следующей нераспознанной попытке счётчик растёт; после 3 попыток бот сообщает «Записал как есть. Позже мы уточним детали.», а запись остаётся в статусе `needs_clarification` для администратора.
- Система не прерывает работу при некорректном вводе.

## 6. Admin-просмотр needs_clarification

- Используется существующий endpoint просмотра дневника с фильтром по статусу:
  - `GET /api/v1/admin/enrollments/:enrollmentId/diary?status=needs_clarification`
- Ответ анонимизирован: не содержит персональных данных клиента, только `id`, `mealAt`, `description`, `approxCalories`, `hasPhoto`, `photoRef`, `status`.
- Ручная обработка записей (PATCH) — post-MVP.

## 7. Изоляция ошибок одного клиента

- Все scheduler job-ы обёрнуты в `try/catch` и не прерывают обработку других клиентов.
- grammY-бот имеет централизованный `bot.catch`, который логирует ошибки и продолжает работу.
- Асинхронный AI-анализ дневника запускается через `void ... .catch(...)` и не ломает ответ пользователю.
