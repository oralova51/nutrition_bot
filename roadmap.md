# ИНДЕКС ЭТАПОВ (статус реализации)

> Быстрый обзор статуса. Для экономии токенов сначала читай этот индекс, затем — только нужный этап ниже.
> Легенда: `[ ]` не начат · `[~]` в работе · `[x]` завершён (код реализован и проверен).
> Пометка `✓` внутри шагов = готова спецификация в `SA/`, **не** реализация кода.
> Правило: при старте шага ставь `[~]`, при завершении — `[x]`, и синхронизируй статус здесь.

**Текущий фокус:** Этап 10 — ошибки и edge cases.

- [x] Этап 0 — Подготовка (спецификации SA: ERD, Domain, adminAPI готовы; шаг 0.5 ✓)
- [x] Этап 1 — Каркас проекта (TS/ESLint/Prettier, БД, модели Client/Course/Enrollment/Notification/Message, логирование, health-check)
- [x] Этап 2 — Telegram-бот минимальный (webhook/polling, /start, deep link)
- [x] Этап 3 — Подключение клиента (3A ссылки — код и admin API полностью реализованы и проверены (3.1–3.6); 3B онбординг+анкета — welcome и анкета 3.9–3.15 реализованы; 3C настройки уведомлений — 3.16–3.24 реализованы)
- [x] Этап 4 — Ежедневное взаимодействие (планировщик/напоминания, дневник питания, вечернее напоминание)
- [x] Этап 5 — AI и рекомендации (абстракция AIEngine, анализ, генерация в мягком тоне, лимиты, rate limit; 5.11 OCR/vision отложён по решению)
- [x] Этап 6 — Неактивность и opt-out (ФТ-9..ФТ-12)
- [x] Этап 7 — Завершение курса (Report, Feedback, ветки оценок)
- [x] Этап 8 — Продление курса (ФТ-18)
- [x] Этап 9 — Панели управления (9.4–9.9 и 9.12–9.16 реализованы по SA/stage9-dashboards.md; 9.2, 9.3, 9.10 уже были готовы; UI — post-MVP)
- [ ] Этап 10 — Ошибки и edge cases (ФТ-21, ФТ-22)
- [ ] Этап 11 — Non-functional (шифрование, хранение, мониторинг, AIModelLog)
- [ ] Этап 12 — Пилот (seed, чек-листы CJM, метрики, go/no-go)

---

Этап 0. Подготовка (до кода)
#	Шаг
0.1
Зафиксировать стек: Node.js + TypeScript, Telegram Bot API, БД, очередь задач, AI-провайдер
> Заметка: зафиксировано в `.cursor/rules/stack.mdc` — Node.js + TypeScript, Supabase (PostgreSQL) через Sequelize, Telegram Bot API. Осознанно отложено: выбор очереди/планировщика (node-cron vs BullMQ) — до этапа 4.1; выбор конкретного AI-провайдера — до этапа 5.1. Для каркаса (этап 1) эти два пункта не блокирующие.
0.2
Согласовать открытые противоречия из аналитики (см. раздел «Вопросы» в конце)
0.3
Описать минимальный набор сущностей для MVP: Client, Course, ClientEnrollment, EnrollmentLink, NotificationSettings, Questionnaire, NutritionDiary, Message, Recommendation, Report, Feedback
0.4
Спроектировать ERD с привязкой NutritionDiary и Report к ClientEnrollment (как в Domain_Analysis_v2.md)
0.5
Описать API-контракты для admin API (генерация ссылок, просмотр клиентов) — ✓ `SA/adminAPI.md`
Этап 1. Каркас проекта
#	Шаг	Связь с ФТ
1.1 [x]
Инициализация monorepo / структуры: bot, api, shared, scheduler
—
1.2 [x]
Настройка TypeScript, ESLint, Prettier по стилю проекта
nonFR
1.3 [x]
Подключение PostgreSQL (или выбранной БД) + миграции
—
1.4 [x]
Модель и миграция Client
Domain
1.5 [x]
Модель и миграция Course
Domain
1.6 [x]
Модель и миграция ClientEnrollment (статусы: active, paused, completed, cancelled)
ФТ-13
1.7 [x]
Модель и миграция NotificationSettings (включая reason: user_request / inactivity)
ФТ-3, ФТ-10, ФТ-12
1.8 [x]
Модель и миграция Message (тип, категория transactional/optional, канал Telegram, статус доставки)
ФТ-21, nonFR §5
1.9 [x]
Базовое структурированное логирование
nonFR §6
1.10 [x]
Health-check endpoint
nonFR §2
Этап 2. Telegram-бот (минимальный)
#	Шаг	Связь с ФТ
2.1 [x]
Регистрация бота, webhook или long polling
—
2.2 [x]
Middleware: определение telegramId → поиск/создание Client
—
> Заметка: реализован только поиск. Client в MVP всегда создаётся администратором заранее (adminAPI.md §3 EnrollmentLink, telegramId=null) и получает telegramId лишь при активации ссылки — это шаги 2.4–2.5. Если Client по telegramId не найден, update проходит дальше без `ctx.client` (обработает хендлер `/start` на шаге 2.3).
2.3 [x]
Команда /start — заглушка «ожидаем ссылку подключения»
ФТ-1
2.4 [x]
Обработка deep link с enrollment-кодом
ФТ-1
2.5 [x]
Привязка telegramId к ClientEnrollment
ФТ-1
2.6 [x]
Логирование попыток использования ссылки (успех / ошибка / истёк срок)
ФТ-1
> Заметка: 2.4–2.6 реализованы одним слоем — `packages/bot/src/services/enrollment-link-activation.ts`. Для этого пришлось забежать на спецификацию 3.1 (сущности `EnrollmentLink` + `EnrollmentLinkAttempt` созданы как модели/миграции в `packages/shared`, доступ прямой через Sequelize — по аналогии с `Client` из 2.2, без Internal HTTP API из adminAPI.md §5). Admin-эндпоинты генерации/regenerate ссылок (3.2, 3.5, 3.6) не реализованы — это остаётся на Этап 3A.
Этап 3. Подключение клиента (Фаза 1 SA)
3A. Генерация ссылок (ФТ-1)
#	Шаг
3.1 [x]
Сущность EnrollmentLink: код, enrollmentId, expiresAt (+7 дней), usedAt — ✓ Domain + adminAPI.md
> Реализовано моделью/миграцией в `packages/shared` при выполнении 2.4–2.6 (см. заметку там), включая `EnrollmentLinkAttempt`.
3.2 [x]
API: POST /admin/enrollments/:id/link — генерация ссылки — ✓ adminAPI.md §4.4
> Реализовано в `packages/api/src/services/enrollment-links.ts` + `routes/enrollment-links.ts`. Admin-auth (Bearer, adminAPI.md §1) — `admin-auth.ts`; маршрутизация с `:params` — `router.ts` (без Express, по аналогии с существующим `server.ts`). Ошибки: 404 ENROLLMENT_NOT_FOUND, 422 ENROLLMENT_NOT_ACTIVE, 409 ACTIVE_LINK_EXISTS (`force:true` отзывает текущую active-ссылку).
3.3 [x]
Валидация: ссылка одноразовая по активации, многоразовая до активации в пределах 7 дней — ✓ adminAPI.md §2
> Реализовано в `enrollment-link-activation.ts` (2.4–2.6): статус `used` выставляется только при первой успешной активации.
3.4 [x]
Проверка истечения 7 дней при переходе по ссылке — ✓ adminAPI.md §5 (internal activate)
> Реализовано в `enrollment-link-activation.ts`: при обращении к просроченной ссылке статус переводится в `expired`.
3.5 [x]
API: POST /admin/enrollments/:id/link/regenerate — новая ссылка после истечения — ✓ adminAPI.md §4.4
> Реализовано в том же сервисе, что и 3.2 (общая генерация кода/URL). Если текущая active-ссылка ещё не истекла по времени и не использована — 422 LINK_STILL_ACTIVE (используйте `force:true` на обычном эндпоинте); если истекла лениво (статус ещё `active`, но `expiresAt` в прошлом) — переводится в `expired` перед созданием новой, как и при активации ботом (2.4–2.6).
3.6 [x]
Минимальная admin-страница или Postman-коллекция для генерации ссылок MVP — ✓ чек-лист adminAPI.md §8
> Чек-лист §8 пройден вручную (curl) на реальной БД: health, POST courses, POST clients, POST link, GET clients?linkStatus=active, GET clients/:id, POST link/regenerate — все шаги отработали корректно. Заодно реализован весь оставшийся набор admin-эндпоинтов из adminAPI.md §4 (`packages/api/src/{services,routes}/{courses,clients,enrollments}.ts` + `GET`/`DELETE` в `enrollment-links.ts`): `GET/POST /admin/courses`, `POST/GET /admin/clients`, `GET /admin/clients/:id`, `GET /admin/enrollments/:id`, `GET /admin/enrollments/:id/link`, `DELETE .../link/:linkId`, `GET /admin/enrollments/expired-links`. Общие валидаторы/пагинация — `packages/api/src/validation.ts`. Ограничение MVP: `onboarding.currentQuestion/totalQuestions/lastAnswerAt` и `onboarding.completedAt` — `null`, источник (Questionnaire) появится на 3.7+. Отдельный файл Postman-коллекции не создавался (не запрашивался).
3B. Онбординг (ФТ-2)
#	Шаг
3.7 [x]
Сущность Questionnaire + шаблон вопросов (минимум 5) — модель `packages/shared/src/models/questionnaire.ts`, миграция `migrations/20260710113800-create-questionnaires-table.ts`, шаблон `packages/shared/src/questionnaire/template.ts` (10 вопросов из SA/anketa.md)
3.8 [x]
State machine онбординга: welcome → questionnaire → settings — middleware загружает `ctx.enrollment`, сервис `packages/bot/src/services/onboarding.ts` управляет статусами, `packages/bot/src/handlers/onboarding-handler.ts` маршрутизирует сообщения, `/start` запускает onboarding после активации ссылки
3.9 [x]
Приветственное сообщение (цель бота, ежедневные напоминания)
> Реализовано в `packages/bot/src/services/onboarding.ts`: `WELCOME_MESSAGE` и `sendWelcomeMessage`, сообщение логируется в `Message`.
3.10 [x]
Пошаговый диалог анкеты: вопрос 1
> Реализовано в `startOnboarding` (`packages/bot/src/services/onboarding.ts`): создаётся `Questionnaire` со статусом `in_progress` и задаётся первый вопрос из `packages/shared/src/questionnaire/template.ts`.
3.11 [x]
Валидация обязательного поля + повторный запрос
> Реализовано в `handleQuestionnaireAnswer`: при нераспознанном или пустом ответе отправляется пояснение и текущий вопрос повторяется.
3.12 [x]
Вопросы 2–5 (по одному шагу на вопрос)
> Реализован полный шаблон из 10 вопросов (`packages/shared/src/questionnaire/template.ts`, источник `SA/anketa.md`); `handleQuestionnaireAnswer` после каждого ответа переходит к следующему вопросу, пока не пройдут все.
3.13 [x]
Сохранение ответов + completedAt
> Реализовано в `handleQuestionnaireAnswer`: ответы накапливаются в `answers`, при завершении обновляются `status: 'completed'`, `completedAt`, `lastAnswerAt`, а `ClientEnrollment` переводится в `onboardingStatus: 'settings_pending'`.
3.14 [x]
Обработка «бросила анкету на полпути» — напоминание через N часов
> Параметр N для теста зафиксирован как 2 минуты. Реализовано в `packages/scheduler/src/jobs/questionnaire-reminder.ts`: cron каждые 2 минуты, выборка `Questionnaire` со статусом `in_progress`, мягкое напоминание с номером текущего вопроса, обновление `lastReminderAt`.
3.15 [x]
Разрешить приблизительные ответы без цифр (рекомендация UserResearch для персоны Анны)
> Реализовано в `packages/bot/src/services/onboarding.ts`: `parseNumberAnswer` учитывает `question.allowApproximate`, а number-вопросы `age` и `weight` из `packages/shared/src/questionnaire/template.ts` получили подсказки, что можно ответить примерно.
3C. Настройки уведомлений (ФТ-3)
#	Шаг
3.16 [x]
Выбор времени напоминания (часы:минуты)
> Реализовано в `packages/bot/src/handlers/settings-handler.ts`: inline-кнопки с шагом 30 минут (07:00–21:00), сохранение в `NotificationSettings.reminderTime`.
3.17 [x]
Выбор частоты: ежедневно / через день / 3 раза в неделю / по дням
> Реализованы inline-кнопки для `daily`, `every_other_day`, `three_per_week`. Вариант `custom_days` отложён до пост-MVP, т.к. требует отдельного поля `custom_days` в БД и выбора дней недели; это было согласовано на старте шага.
3.18 [x]
Выбор типов уведомлений (дневник, рекомендации, еженедельные отчёты)
> Реализованы toggle-кнопки для `diary`, `recommendations`, `weekly_report`; сохранение в `NotificationSettings.enabledTypes`. Минимум один тип обязателен.
3.19 [x]
Сохранение в NotificationSettings, статус «включено»
> Настройки сохраняются при каждом нажатии кнопки. `NotificationSettings.enabled` остаётся `true` (по умолчанию); отключение через /stop /pause реализуется на этапе 6 (ФТ-12).
3.20 [x]
Подтверждение с итоговым расписанием
> После выбора часового пояса бот показывает итоговое сообщение с текущими настройками и переводит `ClientEnrollment.onboardingStatus` в `completed`.
3.21 [x]
Команда /settings — просмотр текущих настроек
> Команда `/settings` зарегистрирована в `packages/bot/src/bot.ts`; `handleSettingsCommand` показывает текущие настройки и кнопки «Изменить ...».
3.22 [x]
Команда /settings — изменение времени
> При нажатии «Изменить время» бот редактирует сообщение и показывает кнопки выбора времени; после выбора возвращается к просмотру настроек.
3.23 [x]
Команда /settings — изменение частоты и типов
> Аналогично 3.22: inline-кнопки для частоты и toggle-кнопки для типов; после выбора возвращается к просмотру настроек.
3.24 [x]
Учёт часового пояса клиента (nonFR §2 — зафиксировать источник: Telegram / ручной выбор)
> В `NotificationSettings` хранится IANA timezone (по умолчанию `Europe/Moscow`). В wizard и `/settings` доступен выбор из 5 популярных российских зон; Telegram не передаёт timezone, поэтому выбор ручной.
Этап 4. Ежедневное взаимодействие (Фаза 2 SA)
4A. Планировщик и напоминания (ФТ-4)
#	Шаг
4.1 [x]
Job scheduler (node-cron)
> Выбор: node-cron (без Redis, подходит для MVP). Реализован сервис `packages/scheduler`, запускается отдельным процессом, graceful shutdown по SIGINT/SIGTERM.
4.2 [x]
Выборка клиентов с активными NotificationSettings на текущий слот
> Реализовано в `packages/scheduler/src/jobs/daily-reminder.ts`: JOIN `Client` + `NotificationSettings` + `ClientEnrollment`, фильтрация по `enabled`, `enabledTypes` содержит `diary`, `telegramId` не пуст, `onboardingStatus = completed`.
4.3 [x]
Проверка частоты (ежедневно / через день / по дням)
> Реализовано в `daily-reminder.ts`: `daily` — каждый день, `every_other_day` — относительно `enrollment.startDate`, `three_per_week` — пн/ср/пт, `custom_days` — post-MVP (требует поля `custom_days`).
4.4 [x]
Отправка дружеского напоминания «Чем ты завтракал?»
> Текст и отправка в `daily-reminder.ts` через `sendTelegramMessageWithRetry`.
4.5 [x]
Запись Reminder + Message
> Запись `Message` создаётся в `sendTelegramMessage` (`packages/shared/src/telegram/sender.ts`) до отправки. Сущность `Reminder` отложена до post-MVP, т.к. не входит в MVP-подмножество (roadmap 0.3).
4.6 [x]
Логирование времени отправки
> `createdAt` в `Message` фиксирует время отправки; scheduler логирует `clientId`, `time`, `timezone` в `daily-reminder.ts`.
4.7 [x]
Retry при ошибке доставки: +5 мин, макс. 3 попытки
> Реализовано в `sendTelegramMessageWithRetry`: повторная отправка через 5 мин, `retryCount` в `Message`, после 3 попыток — `delivery_failed` и структурированный лог.
4B. Дневник питания (ФТ-5)
#	Шаг
4.8 [x]
Модель NutritionDiary (связь с ClientEnrollment, статус записи)
> Реализована модель `packages/shared/src/models/nutrition-diary.ts`, миграция `migrations/20260731120000-create-nutrition-diaries-table.ts`, связи `ClientEnrollment 1→M NutritionDiary` и `Client 1→M NutritionDiary` (denorm) в `packages/shared/src/models/index.ts`. Миграцию нужно применить к БД командой `npm run db:migrate` при наличии соединения.
4.9 [x]
Приём текстового описания блюда
> Реализовано в `packages/bot/src/services/nutrition-diary.ts`: текст сохраняется в `NutritionDiary.description`, обработчик подключён в `onboarding-handler.ts` для `onboardingStatus = completed`.
4.10 [x]
Автоопределение времени приёма или текущее время
> Реализовано в `nutrition-diary.ts`: парсится явное время («в 9:00») или ключевые слова (завтрак/обед/ужин/перекус), иначе используется текущее время в часовом поясе клиента из `NotificationSettings`.
4.11 [x]
Опциональное поле количества (не блокировать, если не указано)
> Калорийность извлекается опционально по паттерну «123 ккал/калорий/кал»; если не указана — `approxCalories = null`. Граммы и порции сохраняются в тексте `description` без блокировки.
4.12 [x]
Подтверждение «Спасибо, записал!» (< 5 сек, до AI)
> Подтверждение отправляется через `sendTelegramMessage` сразу после сохранения записи, до любого AI-анализа.
4.13 [x]
Приём фото еды — сохранение файла (encrypted storage)
> Реализовано в `packages/bot/src/handlers/photo-handler.ts` + `services/nutrition-diary.ts`: обработка `message:photo`, выбор самого большого изображения, сохранение `file_id` в `photoRef`, `hasPhoto = true`, подпись (caption) в `description`. Настоящее encrypted storage и скачивание файла отложены до 11.1 (non-functional); для MVP `file_id` достаточно для доступа к фото через Telegram Bot API.
4.14 [x]
Создание записи со статусом pending при отсутствии данных за день
> Реализовано в `packages/scheduler/src/jobs/pending-diary-job.ts`: cron в 00:30 UTC, выборка активных enrollment'ов с завершённым онбордингом, проверка записей `NutritionDiary` за «вчерашний» день в часовом поясе клиента, создание `pending`-записи, если данных не было. Подключено в `packages/scheduler/src/index.ts`.
4.15 [x]
Уточняющий вопрос при неполной информации
> Реализовано в `packages/bot/src/services/nutrition-diary.ts`: проверка `isIncompleteDescription` (менее 3 символов или без букв), создание записи `needs_clarification` с полем `clarificationAttempts`, до 3 попыток уточнения, после 3-й — сохранение как `needs_clarification` с сообщением «Записал как есть». Добавлена миграция `clarification_attempts`.
4C. Вечернее напоминание (ФТ-8)
#	Шаг
4.16 [x]
Job в 20:00 (с учётом TZ клиента)
> Реализовано в `packages/scheduler/src/jobs/evening-reminder-job.ts`: cron `*/30 * * * *`, проверка локального времени `20:00` в `NotificationSettings.timezone` клиента.
4.17 [x]
Проверка: < 3 записей за день
> В `evening-reminder-job.ts` считаются записи `NutritionDiary` за текущий день в часовом поясе клиента; напоминание отправляется только при `count < 3`.
4.18 [x]
Мягкое сообщение «не услышал про ужин»
> Текст в `evening-reminder-job.ts`: «Мне кажется, я не услышал о твоём ужине...». Отправка через `sendTelegramMessageWithRetry`.
4.19 [x]
Не более 1 вечернего напоминания в день
> Проверка по `Message` с `type = 'evening_reminder'` за текущий день в часовом поясе клиента. Добавлен новый тип `evening_reminder` в модель `Message` и миграция.
Этап 5. AI и рекомендации (Фаза 3 SA)
#	Шаг	Связь с ФТ
5.1 [x]
Абстракция AIEngine (интерфейс + mock-реализация для dev)
ФТ-6
5.2 [x]
Очередь асинхронной обработки после сохранения дневника
nonFR §1
5.3 [x]
Промпт: анализ одной записи по 6 критериям (вода, сладкое, белок, овощи/клетчатка, простые углеводы, переедание)
ФТ-6
5.4 [x]
Сравнение с историей клиента за enrollment
ФТ-6
5.5 [x]
Модель Recommendation (тип, приоритет, статус)
ФТ-6
5.6 [x]
Лимит: макс. 2–3 рекомендации в день
ФТ-7
5.7 [x]
Немедленная отправка при priority=critical
ФТ-6
5.8 [x]
Отложенная отправка (конец дня) для medium/low
ФТ-6
5.9 [x]
Генерация текста в мягком тоне (system prompt + few-shot из ФТ-7)
ФТ-7
5.10 [x]
Отправка рекомендации в Telegram + сохранение Message
ФТ-7
5.11 [ ]
OCR / vision для фото (опционально для MVP — отложено по решению)
ФТ-5
5.12 [x]
Логирование вызовов AI + ошибок
nonFR §6
5.13 [x]
Rate limiting вызовов AI
nonFR §7
Этап 6. Неактивность и opt-out (Фаза 4 SA)
#	Шаг	Связь с ФТ
6.1 [x]
Поле lastInteractionAt на Client / enrollment
ФТ-9
> Заметка: реализовано ранее. Поле `last_interaction_at` в таблице `clients` и в модели `Client` (`packages/shared/src/models/client.ts`) создано в миграции `20260709130000-create-clients-table.ts` с индексом. Middleware `packages/bot/src/middleware/client-context.ts` обновляет `Client.lastInteractionAt` при каждом входящем update от известного клиента (текст, фото, callback, команда).
6.2 [x]
Обновление lastInteractionAt при любом сообщении
—
> Заметка: реализовано ранее. `createClientContextMiddleware` (`packages/bot/src/middleware/client-context.ts`) обновляет `Client.lastInteractionAt` для любого входящего update с известным `telegramId` (text, photo, callback_query, команды). Активация enrollment-ссылки (`packages/bot/src/services/enrollment-link-activation.ts`) также проставляет `lastInteractionAt`.
6.3 [x]
Job: 48 ч без активности → предупреждение в 10:00
ФТ-9
> Реализовано: `packages/scheduler/src/jobs/inactivity-warning-job.ts` запускается каждые 30 минут (`packages/scheduler/src/index.ts`), выбирает активных клиентов с `lastInteractionAt < 48 ч` и включёнными уведомлениями, проверяет локальное время 10:00 по `NotificationSettings.timezone`, не отправляет повторно, если предупреждение уже есть после последнего взаимодействия. Добавлен тип сообщения `inactivity_warning` в модель `Message` и миграция `20260803100000-add-inactivity-warning-message-type.ts`.
6.4 [x]
Job: 72 ч без активности → NotificationSettings.status = off, reason=inactivity
ФТ-10
> Реализовано: `packages/scheduler/src/jobs/inactivity-deactivation-job.ts` запускается каждые 30 минут, выбирает активных клиентов с `lastInteractionAt < 72 ч`, устанавливает `NotificationSettings.enabled = false` и `disabledReason = 'inactivity'`.

6.5 [x]
Лог деактивации
ФТ-10
> Реализовано в том же job: при отключении создаётся запись `Message` с `type='info'`, `category='transactional'` и текстом о причине автоматического отключения.
6.6 [x]
Команда /stop и /pause — меню вариантов
ФТ-12
> Реализовано: `packages/bot/src/handlers/opt-out-handler.ts` + регистрация в `packages/bot/src/bot.ts`. Команды показывают inline-меню с вариантом отключения.

6.7 [x]
Отключить на день / неделю / полностью
ФТ-12
> Реализовано только «отключить полностью». Варианты «на день / неделю» отложены на post-MVP (решение по согласованию), потому что в модели `NotificationSettings` нет поля для отложенного включения, а добавление нового поля выходит за рамки текущего MVP.

6.8 [x]
Подтверждение при полном отключении
ФТ-12
> Реализовано: после нажатия «Отключить полностью» показывается подтверждение с callback `stop:confirm` → `stop:disable` / `stop:cancel`. Текст подтверждения: «Ты уверен? Ты всегда можешь снова включить уведомления командой /start».

6.9 [x]
Команда /start — повторное включение
ФТ-12
> Реализовано: обновлён `packages/bot/src/commands/start.ts`. Если /start приходит без payload от существующего клиента, уведомления включаются обратно (`enabled = true`, `disabledReason = null`).

6.10 [x]
Восстановление после любого сообщения post-inactivity
ФТ-11
> Реализовано: `packages/bot/src/middleware/client-context.ts` включает уведомления обратно при любом входящем сообщении от клиента, если они были отключены. Команды /stop и /pause (и их callback-подтверждения) исключены из автоматического восстановления, чтобы обработчик opt-out мог отключить уведомления.

6.11 [x]
Приветствие «Рад видеть, что ты вернулся!»
ФТ-11
> Реализовано: в том же middleware при автоматическом восстановлении отправляется сообщение «Рад видеть, что ты вернулся! Давай продолжим? 🙂». При восстановлении через /start — отдельное приветствие о включении уведомлений.

6.12 [x]
Разделение transactional vs optional сообщений (отчёт не блокируется /stop)
Domain §3
> Реализовано: модель `Message` имеет поле `category` (`transactional` | `optional`). Все текущие отправки из scheduler явно указывают категорию. Лог деактивации (6.5) создан как `transactional`. Future job-ы для отчёта и feedback будут использовать `transactional` и не будут проверять `enabled`.
Этап 7. Завершение курса (Фаза 5 SA)
#	Шаг	Связь с ФТ
7.1 [x]
Job: проверка enrollment.endDate
ФТ-13
> Реализовано: `packages/scheduler/src/jobs/course-completion-job.ts` запускается ежедневно в 00:01 UTC, сервис `packages/scheduler/src/services/course-completion.ts` выбирает активные enrollment'ы с `endDate <= текущей даты` и завершённым онбордингом.
7.2 [x]
Остановка регулярных напоминаний в день завершения
ФТ-13
> Реализовано: job завершения курса переводит enrollment в `status = 'completed'`, поэтому ежедневное напоминание (`daily-reminder`) больше не выбирает такой enrollment. Job стартует до утреннего слота напоминаний.
7.3 [x]
Модель Report
ФТ-14
> Реализовано: модель `packages/shared/src/models/report.ts`, миграция `migrations/20260804120000-create-reports-table.ts`. owning-связь через `clientEnrollmentId`, `clientId` денормализован. Поддерживаются типы `weekly|monthly|final`.
7.4 [x]
Агрегация: средняя калорийность, БЖУ
ФТ-14
> Реализовано: `avgCalories` считается по заполненным записям дневника. БЖУ (`avgProtein`, `avgFat`, `avgCarbs`) оставлены `null` в MVP, так как в текущей модели `NutritionDiary` хранится только `approxCalories`.
7.5 [x]
Агрегация: частота приёмов, график по времени суток
ФТ-14
> Реализовано: `diaryStats.mealsByHour` — распределение заполненных записей по часам UTC.
7.6 [x]
ТОП-5 продуктов и ТОП-5 проблем
ФТ-14
> Реализовано: `topProducts` — топ-5 частых слов из описаний; `topProblems` — топ-5 по ключевым словам (сладкое, фастфуд, перекус и т.д.).
7.7 [x]
% соблюдения рекомендаций
ФТ-14
> Реализовано: `adherencePercent` = `Recommendation.status='applied'` / общее число рекомендаций клиента.
7.8 [x]
Персональное AI-резюме в отчёте
ФТ-14
> Реализовано: шаблонное мягкое резюме на основе агрегатов, сохраняется в `Report.aiSummary`. Внешний AI-вызов для резюме отложён на post-MVP по решению (rate limits, стоимость).
7.9 [x]
Отправка отчёта в Telegram (форматированное сообщение)
ФТ-14
> Реализовано: `sendTelegramMessageWithRetry` с `category='transactional'`, `type='report'`, форматирование HTML.
7.10 [x]
Модель Feedback
ФТ-15
> Реализовано: модель `packages/shared/src/models/feedback.ts`, миграция `migrations/20260804130000-create-feedbacks-table.ts`. `recommendationId` сделан nullable для итоговой оценки курса; добавлено поле `source` (`course_final` | `recommendation`).
7.11 [x]
Inline-кнопки оценки 1–5 звёзд
ФТ-15
> Реализовано: `InlineKeyboard` с callback `feedback:stars:1..5`, отправляется в `requestFeedback` после итогового отчёта.
7.12 [x]
Сохранение оценки
ФТ-15
> Реализовано: `saveRating` в `packages/bot/src/handlers/feedback-handler.ts` создаёт/обновляет `Feedback` с `source='course_final'`.
7.13 [x]
Ветка 1–3 звезды: запрос комментария
ФТ-16
> Реализовано: при низкой оценке редактируется сообщение с текстом-запросом и кнопкой «Пропустить». Текстовый комментарий отлавливается в `onboardingMessageHandler` через `handleFeedbackComment`.
7.14 [x]
Сохранение комментария + уведомление администратору
ФТ-16
> Реализовано: комментарий сохраняется в `Feedback.comment`, уведомление администратора — запись `Message` с `type='feedback'`, `category='transactional'`, содержит оценку и комментарий (для будущей админ-панели).
7.15 [x]
Ветка 4–5 звёзд: благодарность + ссылки 2Gis / Яндекс.Карты
ФТ-17
> Реализовано: при высокой оценке отправляется благодарность и inline-кнопки с ссылками на 2GIS и Яндекс.Карты (константы в `feedback-handler.ts`).
7.16 [x]
Лог предложения бонуса (прессотерапия)
ФТ-17
> Реализовано: запись `Message` с описанием бонуса за отзыв.
7.17 [x]
Архивирование данных enrollment (не удалять)
ФТ-23
> Реализовано: данные enrollment, дневника, рекомендаций, feedback и report остаются в БД; удаление только по запросу/GDPR (post-MVP).
7.18 [x]
Статус enrollment → completed
ФТ-23
> Реализовано: `enrollment.update({ status: 'completed' })` в `completeCourse`.
Этап 8. Продление курса (Фаза 6 SA)
#	Шаг	Связь с ФТ    
8.1 [x]
Сообщение о продлении со скидкой 15% (после feedback)
ФТ-18
> Реализовано: в `packages/scheduler/src/services/course-renewal.ts` формируется сообщение с преимуществами, ценой и скидкой 15%. Отправляется из `completeCourse` после запроса feedback.
8.2 [x]
CTA-кнопка «Продлить курс» + ссылка на систему студии
ФТ-18
> Реализовано: inline-кнопка с callback `renewal:accept:{offerId}` и последующая ссылка на `RENEWAL_CHECKOUT_URL`. Обработчик — `packages/bot/src/handlers/renewal-handler.ts`.
8.3 [x]
Лог отправки предложения
ФТ-18
> Реализовано: запись в `RenewalOffer` (status='sent') и запись `Message` с type='renewal_offer', category='transactional'.
8.4 [x]
API: создание нового ClientEnrollment при продлении
ФТ-18, Domain
> Реализовано: `POST /admin/clients/:clientId/enrollments` в `packages/api/src/routes/clients.ts` + `services/enrollments.ts`. Проверяет отсутствие активного enrollment (422 ACTIVE_ENROLLMENT_EXISTS).
8.5 [x]
Использование истории прошлого enrollment в AI-анализе
ФТ-23
> Реализовано: `packages/ai/src/diary-processor.ts` подгружает последние 50 записей дневника из предыдущего завершённого enrollment и передаёт их в `DiaryAnalysisInput.previousHistory`. Prompt в `openai-compatible-engine.ts` включает сводку по предыдущему курсу.
Этап 9. Панели управления (Фаза 7 SA)
> Реализованы все dashboard-ендпоинты: `SA/stage9-dashboards.md` + `postman/stage9-dashboards.postman_collection.json`. UI-панели — post-MVP.

9A. Администратор (ФТ-19)
#	Шаг
9.1
Auth для admin API — ✓ MVP: Bearer token (adminAPI.md §1); post-MVP: JWT
9.2
Список клиентов: active / inactive — ✓ adminAPI.md §4.3 `GET /admin/clients`
> Эндпоинт реализован кодом на шаге 3.6 (`packages/api/src/services/clients.ts`); UI-панель (собственно этап 9) не начата.
9.3
Генерация ссылки из UI — ✓ adminAPI.md §4.4 (UI post-MVP; MVP — Postman §8)
> API реализовано на 3.2/3.5; UI — post-MVP, не начато.
9.4 [x]
Просмотр дневника (анонимизированно)
> Реализовано: `GET /admin/enrollments/:id/diary` в `packages/api/src/services/dashboards.ts` + `routes/dashboards.ts`. Фильтры по дате и статусу, без персональных данных в ответе.
9.5 [x]
Статистика соблюдения рекомендаций
> Реализовано: `GET /admin/statistics/recommendations` — агрегация по статусам и приоритетам, фильтр по курсу и периоду.
9.6 [x]
Inbox критической обратной связи (1–3 звезды)
> Реализовано: `GET /admin/feedback/critical`. Добавлено поле `isResolved` в модель `Feedback` и миграция `20260806130000-add-is-resolved-to-feedbacks.ts`. Фильтр `unresolvedOnly`.
9.7 [x]
Список клиентов с предложением продления
> Реализовано: `GET /admin/renewal-offers` со сводкой по статусам и конверсией.
9.8 [x]
Экспорт CSV/Excel
> Реализовано: `GET /admin/export/clients?format=csv` — CSV с BOM и UTF-8. XLSX — post-MVP.
9.9 [x]
Статус недоставленных сообщений
> Реализовано: `GET /admin/messages/failed` с фильтром `exhaustedRetries` для исчерпавших retry.
9.10
Ссылки с истёкшим сроком (для CJM: повторная генерация)
> Эндпоинт `GET /admin/enrollments/expired-links` реализован кодом на шаге 3.6 (`packages/api/src/services/enrollments.ts`); UI-панель не начата.
9B. Специалист (ФТ-20)
#	Шаг
9.11
Auth + привязка специалиста к клиентам
9.12 [x]
Просмотр итогового Report своих клиентов
> Реализовано: `GET /specialist/clients/:id/reports` — итоговые отчёты по клиенту с фильтром по типу.
9.13 [x]
% соблюдения рекомендаций
> Реализовано: `GET /specialist/clients/:id/compliance` — доля применённых рекомендаций за текущий enrollment.
9.14 [x]
ТОП проблем в питании
> Реализовано: `GET /specialist/statistics/problems` — агрегация `problemAreas` из отчётов.
9.15 [x]
Статистика активности (частота заполнения дневника)
> Реализовано: `GET /specialist/statistics/activity` — заполнение дневника по дням, фильтр `minFillRate`.
9.16 [x]
Просмотр Feedback (read-only)
> Реализовано: `GET /specialist/clients/:id/feedback` — read-only список feedback клиента.
Этап 10. Ошибки и edge cases (Фаза 8 SA)
#	Шаг	Связь с ФТ
10.1
Централизованный retry для Telegram (3×5 мин)
ФТ-21
10.2
Статус delivery_failed на Message
ФТ-21
10.3
Уведомление admin при delivery_failed
ФТ-21
10.4
Не падать при ошибке одного клиента
ФТ-21
10.5
Валидация ввода: «не понял, переформулируй»
ФТ-22
10.6
Макс. 3 попытки → статус needs_clarification
ФТ-22
10.7
Admin-просмотр записей needs_clarification
ФТ-22
10.8
Alert admin при массовых сбоях доставки
nonFR §6
Этап 11. Non-functional (параллельно, но до пилота)
#	Шаг
11.1
Шифрование фото и анкет at rest
11.2
Политика хранения: enrollment + 12 месяцев
11.3
Endpoint удаления данных по запросу клиента (152-ФЗ)
11.4
Мониторинг uptime / алерты
11.5
Модель AIModelLog + процесс обновления промпта по низким Feedback
11.6
Нагрузочный тест на N клиентов (значение N — на пилоте)
Этап 12. Пилот
#	Шаг
12.1
Seed: 1 студия, 1 курс, тестовые enrollment
12.2
Чек-лист happy path по CJM (шаги 3–12)
12.3
Чек-лист альтернативных веток CJM
12.4
Сбор метрик из vision.md §6
12.5
Решение go/no-go на масштабирование
Рекомендуемый порядок первых 10 «рабочих» шагов
Если начинать реализацию прямо сейчас, логичная последовательность:

1.1–1.3 — каркас + БД
1.4–1.7 — базовые сущности
2.1–2.5 — бот + deep link
3.1–3.6 — генерация ссылок (хотя бы через API)
3.7–3.13 — онбординг и анкета
3.16–3.20 — настройки уведомлений
4.1–4.7 — планировщик + ежедневное напоминание
4.8–4.12 — текстовый дневник
5.1–5.2, 5.9–5.10 — AI mock → реальные рекомендации
7.1–7.9, 7.11–7.12 — завершение курса + feedback
Остальное (неактивность, admin UI, vision для фото, продление) — следующими инкрементами.