# ИНДЕКС ЭТАПОВ (статус реализации)

> Быстрый обзор статуса. Для экономии токенов сначала читай этот индекс, затем — только нужный этап ниже.
> Легенда: `[ ]` не начат · `[~]` в работе · `[x]` завершён (код реализован и проверен).
> Пометка `✓` внутри шагов = готова спецификация в `SA/`, **не** реализация кода.
> Правило: при старте шага ставь `[~]`, при завершении — `[x]`, и синхронизируй статус здесь.

**Текущий фокус:** Этап 13 завершён (13.1–13.9). Порог покрытия зафиксирован в `vitest.config.ts` по `npm test`: 34% statements / 27% branches / 31% functions / 34% lines; job'ы scheduler — 94% statements. Интеграционные и сценарные наборы — отдельная команда `npm run test:integration`, в порог не входят. Пилот (этап 12) — go/no-go после цикла когорты.

- [x] Этап 0 — Подготовка (спецификации SA: ERD, Domain, adminAPI готовы; шаг 0.5 ✓)
- [x] Этап 1 — Каркас проекта (TS/ESLint/Prettier, БД, модели Client/Course/Enrollment/Notification/Message, логирование, health-check)
- [x] Этап 2 — Telegram-бот минимальный (webhook/polling, /start, deep link)
- [x] Этап 3 — Подключение клиента (3A ссылки — код и admin API полностью реализованы и проверены (3.1–3.6); 3B онбординг+анкета — welcome и анкета 3.9–3.15 реализованы; 3C настройки уведомлений — 3.16–3.24 реализованы)
- [x] Этап 4 — Ежедневное взаимодействие (планировщик/напоминания, дневник питания, вечернее напоминание)
- [x] Этап 4D — Ежедневный evening summary (ФТ-24): job 21:00, Report.type=daily, Message.evening_summary
- [x] Этап 5 — AI и рекомендации (абстракция AIEngine, анализ, генерация в мягком тоне, лимиты, rate limit; 5.11 OCR/vision отложён по решению)
- [x] Этап 6 — Неактивность и opt-out (ФТ-9..ФТ-12)
- [x] Этап 7 — Завершение курса (Report, Feedback, ветки оценок)
- [x] Этап 8 — Продление курса (ФТ-18)
- [x] Этап 9 — Панели управления (9.3 Telegram `/admin` для курса/приглашения; 9.4–9.9 и 9.12–9.16 по SA/stage9-dashboards.md; 9.2, 9.10 уже были готовы; web-UI — post-MVP)
- [x] Этап 10 — Ошибки и edge cases (ФТ-21, ФТ-22) — код и документация реализованы, см. SA/stage10-errors.md
- [x] Этап 11 — Non-functional (шифрование, хранение, мониторинг, AIModelLog) — завершён
- [x] Этап 12 — Пилот (seed, чек-листы CJM, метрики, go/no-go)
- [x] Этап 13 — Тестовое покрытие (13.1–13.9: инфраструктура, доставка в Telegram, AI-адаптер, дневник, admin API, CJM, job'ы scheduler, ИИ-уточнения + eval, порог покрытия)

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
> MVP: фиксированный `Europe/Kaliningrad` для всех клиентов студии. Ручной выбор пояса в wizard/`/settings` убран; поле `NotificationSettings.timezone` сохранено для будущей поддержки других регионов.
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
4D. Ежедневный evening summary (ФТ-24)
#	Шаг
4.20 [x]
Спецификация ФТ-24 + SA (`evening-summary.md`, обновления ERD/Domain/CJM/SA_SUMMARY)
ФТ-24
> Спека: `SA/evening-summary.md`, ФТ в `Functional_Requirements.md`, выжимка в `SA_SUMMARY.md`.
4.21 [x]
Миграции: Message.type `evening_summary`, Report.type `daily`, NotificationType `evening_summary` (+ бэкфилл enabledTypes)
ФТ-24
> Миграция `migrations/20260809140000-add-evening-summary.ts`; модели Message/Report/NotificationSettings обновлены.
4.22 [x]
AIEngine.generateEveningSummary + mock/openai + промпт дневной сводки
ФТ-24
> `packages/ai/src/{types,prompts,mock-engine,openai-compatible-engine,evening-summary}.ts`.
4.23 [x]
Job `evening-summary` в 21:00 TZ: выборка клиентов, анализ дневных записей, Report+Message, дедуп 1/день
ФТ-24
> `packages/scheduler/src/jobs/evening-summary-job.ts`, cron в `index.ts`.
4.24 [x]
HTTP force-endpoint + Postman (`scheduler-jobs`) + toggle в `/settings`
ФТ-24
> `POST /internal/jobs/evening-summary`; Postman: `postman/scheduler-jobs.postman_collection.json` + daily reports в `stage9-dashboards`; тип «Вечерняя сводка» в `/settings`.
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
Немедленная отправка рекомендаций после записи дневника (быстрая обратная связь; ранее — только critical)
ФТ-6
5.8 [x]
Вечерняя досылка medium/low, если ещё не ушли в Telegram (страховка к 5.7)
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
9.3 [x]
Генерация ссылки из UI — ✓ adminAPI.md §4.4 (UI post-MVP; MVP — Postman §8)
> API реализовано на 3.2/3.5. Для пилота вместо web-UI: команда `/admin` в боте
> (`packages/bot` — allowlist `ADMIN_ALERT_TELEGRAM_ID`): «Создать курс» (дни → авто-имя)
> и «Пригласить клиента» (выбор курса → имя → Client+Enrollment+deep link). Web-UI — post-MVP.
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
10.1 [x]
Централизованный retry для Telegram (3×5 мин)
ФТ-21
> Реализовано в `packages/shared/src/telegram/sender.ts`: `sendTelegramMessageWithRetry` обновляет одну запись `Message` и повторяет до 3 раз с паузой 5 мин. `sendTelegramMessage` — real-time отправка без блокирующего retry.
10.2 [x]
Статус delivery_failed на Message
ФТ-21
> Поле `deliveryStatus` в модели `Message` и миграции `20260709170000-create-messages-table.ts`; при исчерпании retry выставляется `delivery_failed`.
10.3 [x]
Уведомление admin при delivery_failed
ФТ-21
> Реализовано: если задан `ADMIN_ALERT_TELEGRAM_ID`, при исчерпании retry администратору отправляется Telegram-алерт с `clientId`, `messageId`, типом и ошибкой. Сервис `packages/shared/src/telegram/alerts.ts`.
10.4 [x]
Не падать при ошибке одного клиента
ФТ-21
> Scheduler job-ы обёрнуты в `try/catch` и обрабатывают клиентов по одному; grammY-бот имеет `bot.catch` для необработанных ошибок; асинхронный AI-анализ не ломает ответ пользователю.
10.5 [x]
Валидация ввода: «не понял, переформулируй»
ФТ-22
> Реализовано в `packages/bot/src/services/nutrition-diary.ts`: при неполном/нераспознанном описании бот просит переформулировать.
10.6 [x]
Макс. 3 попытки → статус needs_clarification
ФТ-22
> Реализовано в том же сервисе: счётчик `clarificationAttempts`, после 3 попыток запись остаётся в `needs_clarification`.
10.7 [x]
Admin-просмотр записей needs_clarification
ФТ-22
> Используется существующий endpoint `GET /admin/enrollments/:id/diary?status=needs_clarification` (roadmap 9.4). Ручная обработка (PATCH) — post-MVP.
10.8 [x]
Alert admin при массовых сбоях доставки
nonFR §6
> Реализован job `packages/scheduler/src/jobs/delivery-failure-alert-job.ts`: считает `delivery_failed` за окно `MASS_FAILURE_WINDOW_MINUTES` и алертит администратору при превышении `MASS_FAILURE_THRESHOLD`, не чаще `MASS_FAILURE_ALERT_INTERVAL_MINUTES`.
Этап 11. Non-functional (параллельно, но до пилота)
#	Шаг
11.1 [x]
Шифрование фото и анкет at rest
> Реализовано AES-256-GCM на уровне приложения: `packages/shared/src/encryption`. Поля `NutritionDiary.photoRef` и `Questionnaire.answers`/`analysisResult` шифруются автоматически через getter/setter. `ENCRYPTION_KEY` добавлена в `.env.example`; миграция `20260812100000` расширила `photo_ref` до TEXT. Legacy-данные читаются без изменений.
11.2 [x]
Политика хранения: enrollment + 12 месяцев
> Реализован job `packages/scheduler/src/jobs/data-retention-job.ts`: ежедневно в 02:00 находит клиентов, у которых последний enrollment завершился более `DATA_RETENTION_MONTHS` (default 12) назад, и полностью удаляет их данные. Для удаления используется общий сервис `packages/shared/src/services/data-deletion.ts`. Ручной запуск: `POST /internal/jobs/data-retention?force=true`.
11.3 [x]
Endpoint удаления данных по запросу клиента (152-ФЗ)
> Реализован `DELETE /admin/clients/:clientId` с опциональным `reason` в теле. Удаляет клиента и все связанные записи через `deleteClientData` из `packages/shared/src/services/data-deletion.ts`. Требует admin-auth.
11.4 [x]
Мониторинг uptime / алерты
> Health endpoint обогащён `uptimeSeconds`. Scheduler job `packages/scheduler/src/jobs/uptime-monitor-job.ts` каждые 5 минут проверяет `API_HEALTH_URL` и шлёт Telegram-алерт администратору при недоступности или `database: disconnected`. URL добавлен в `.env.example`.
11.5 [x]
Модель AIModelLog + процесс обновления промпта по низким Feedback
> Добавлена модель/таблица `AIModelLog` с полями version, updateReason, analystComment. Миграция `20260812110000`. Версия промптов `PROMPT_VERSION` в `packages/ai/src/prompts.ts`. При оценке 1–3 звезды в `feedback-handler.ts` создаётся запись `AIModelLog` для последующего ручного пересмотра промптов.
11.6 [x]
Нагрузочный тест на N клиентов (значение N — на пилоте)
> Добавлен скрипт `scripts/load-test.ts`: создаёт N клиентов с enrollment'ами и записывает в `NutritionDiary`, измеряя p95 и RPS. Параметры `LOAD_TEST_CLIENTS` и `LOAD_TEST_CONCURRENCY` (env). Запуск: `npx tsx scripts/load-test.ts`.
Этап 12. Пилот
#	Шаг
12.1 [x]
Seed: 1 студия, 1 курс, тестовые enrollment
> `scripts/seed-pilot.ts` (`npm run db:seed:pilot`): курс 30 дней + 5 сценариев (happy, questionnaire, expired_link, inactivity, user_stop). Спека: `SA/stage12-pilot.md`.
12.2 [x]
Чек-лист happy path по CJM (шаги 3–12)
> `SA/stage12-pilot.md` §4 — от admin-подключения до продления (ФТ-1…ФТ-18, ФТ-24).
12.3 [x]
Чек-лист альтернативных веток CJM
> `SA/stage12-pilot.md` §5 — просроченная ссылка, незавершённая анкета, feedback 1–3/4–5, неактивность, /stop, молчание.
12.4 [x]
Сбор метрик из vision.md §6
> `scripts/pilot-metrics.ts` (`npm run pilot:metrics`): пороги дневник/adherence/renewal ≥50%, Feedback ≥4, opt-out ≤20%, жалобы ≤2 (`PILOT_NAGGING_COMPLAINTS`).
12.5 [x]
Решение go/no-go на масштабирование
> Шаблон решения в `SA/stage12-pilot.md` §6; скрипт метрик даёт черновой GO/PENDING/NO-GO, финал фиксирует ответственный после цикла когорты.
Этап 13. Тестовое покрытие
#	Шаг
> Принципы этапа: порядок шагов — по убыванию риска (что сломается тише всего и навредит больше всего), а не по пакетам. Юнит-тесты и контрактные тесты детерминированы и живут в `npm test`; обращения к реальной модели — только в eval-наборах (`npm run eval`), вне блокирующего прогона.
13.1 [x]
Инфраструктура тестов: отчёт о покрытии, изоляция окружения, фабрики данных
nonFR
> Установлен `@vitest/coverage-v8`, добавлены `npm run test:coverage` / `test:watch` / `eval`. Базовая линия покрытия на момент старта этапа: **12.15% statements**.
> `test/setup.ts` (vitest `setupFiles`) делает прогон безопасным и детерминированным: подхватывает `.env.test`, подменяет `DATABASE_URL` на заведомо недоступный адрес (иначе тест уходит в боевую базу из корневого `.env`), ставит фиктивные `TELEGRAM_API`, `ENCRYPTION_KEY`, `ADMIN_API_TOKEN`, `BOT_USERNAME` и падает, если `TEST_DATABASE_URL` совпал с боевым `DATABASE_URL`.
> Фабрики тестовых данных — `@nutrition-bot/shared/testing` (`makeClient`, `makeEnrollment`, `makeDiaryEntry`, `makeMessage` и др.). Набор полей выводится из моделей через `InferAttributes`, поэтому новое поле в модели ломает сборку фабрики, а не остаётся тихо незаполненным. `update` у поддельной модели фиксирует вызов и применяет изменения к объекту.
> В `vitest.config.ts` workspace-пакеты резолвятся в исходники: до этого тесты проверяли содержимое `dist`, то есть последнюю сборку, а не текущий код.
> Тестовая БД (для 13.5): отдельный Supabase-проект, адрес в `.env.test` как `TEST_DATABASE_URL` (шаблон — в `.env.example`); помощник `requireTestDatabase()` падает с инструкцией, если он не задан.
> Файл `packages/ai/src/diary-processor.test.ts` переименован в `proposal-selection.test.ts` — он тестирует не тот модуль, который был назван.
13.2 [x]
Доставка в Telegram: ретраи 3×5 мин, delivery_failed, алерт при исчерпании
ФТ-21
> `packages/shared/src/telegram/sender.test.ts`, 9 тестов на `vi.useFakeTimers()`: пауза ровно 5 минут между попытками, одна запись `Message` на всю цепочку ретраев, `retryCount` 1→2→3, `delivery_failed` и алерт администратору только после третьей неудачи, сбой самого алерта не подменяет исходную ошибку, не-`Error` читаемо попадает в текст алерта. Покрытие `sender.ts`: 100% строк, 91.7% веток.
> Изменение поведения: из `sendTelegramMessage` (real-time путь бота, ретраев нет) убран личный алерт администратору — он срабатывал на первой же сетевой ошибке с текстом «Retry: 0/3», хотя ФТ-21 обещает 3 попытки. Единичные сбои теперь закрывает job массовых сбоев (10.8), сбой по-прежнему логируется через `logMessageDeliveryFailure` и помечается `delivery_failed`. Алерт при исчерпании 3 попыток в `sendTelegramMessageWithRetry` сохранён по ФТ-21.
13.3 [x]
Контрактные тесты адаптера AI на фикстурах ответов модели
ФТ-6, ФТ-24
> `packages/ai/src/openai-compatible-engine.test.ts`, 20 тестов. SDK `openai` замокан классом-заглушкой, реальная модель не вызывается. Покрытие адаптера: 100% строк и функций, 79% веток (непокрытое — защитные `?.` на неполной форме ответа).
> Проверяется: битый JSON и JSON без `proposals` дают пустой список вместо падения; отказ провайдера в `analyzeDiary` пробрасывается, а в `generateRecommendationText` откатывается на черновик; вечерняя сводка первым запросом идёт с `thinking: disabled`, при отказе повторяется без него, а при двойном отказе ошибка пробрасывается; битый JSON и валидный-но-пустой JSON уводят на эвристику с `reason: invalid_json` / `empty_summary`; слишком короткий `summaryText` пересобирается из блоков; `finish_reason: 'length'` попадает в metadata. Отдельно закреплено, что контекст предыдущего курса и признак фото доходят до промпта.
> Исправлен баг: в `generateRecommendationText` откат на `draftText` был написан через `?? proposal.draftText`, а `''.trim()` — это `''`, а не `null`. Модель с пустым ответом (реальный случай, когда бюджет токенов ушёл на thinking) приводила к пустой рекомендации в БД и ошибке доставки в Telegram. Теперь проверка на falsy плюс `logger.warn`.
> Найдено, не чинили: `buildHistorySummary` считает «записи за сегодня» по UTC-суткам, тогда как остальная система живёт в `Europe/Kaliningrad`. Для приёмов пищи с 00:00 до 02:00 по местному времени счётчик в промпте уедет на день назад. Решить в 13.4.
13.4 [x]
processDiaryEntry на фейковом AIEngine
ФТ-6, ФТ-7
> Лимит 2–3 рекомендации в день, изоляция ошибок AI от подтверждения записи, вечерняя сводка не уходит дважды. Заодно решить расхождение из 13.3: `buildHistorySummary` считает сутки по UTC, а `countRecommendationsToday` — по `Europe/Kaliningrad`.
> `packages/ai/src/diary-processor.test.ts` (15 тестов): AIEngine заменён фейком, модели `@nutrition-bot/shared` замоканы. Покрытие `diary-processor.ts` — 100% строк, 92.9% веток (непокрытое — защитный `client.firstName ?? null`: в модели и в БД поле NOT NULL, ветка недостижима). Проверяется: ранние выходы (нет записи / нет telegramId / курс не активен), окно лимита по локальным суткам Калининграда, при исчерпанном лимите модель не вызывается вообще, один совет на запись с выбором по приоритету, состав `DiaryAnalysisInput` (история курса, предыдущий курс, анкета, контекст клиента).
> `packages/ai/src/evening-summary.test.ts` (12 тестов): защита от повторной отправки — `too_early` до 21:00, `notifications_disabled`, `already_sent` по `Message.type='evening_summary'` за локальные сутки, `force` обходит проверку, повторный вызов обновляет существующий `Report` вместо второй строки. Хелперы времени взяты настоящие. Покрытие `evening-summary.ts` — 100% строк, 92% веток.
> `packages/bot/src/services/nutrition-diary.test.ts` (2 теста): падение или зависание `processDiaryEntry` не мешает подтверждению записи — вызов действительно fire-and-forget, ошибка уходит в лог.
> Расхождение суток закрыто: `buildHistorySummary` вынесен в `packages/ai/src/history-summary.ts` (был продублирован в mock-движке и в реальном адаптере) и считает «сегодня» по `clientContext.timezone` через `formatZonedDate`, а не по UTC; покрытие модуля — 100%, `packages/ai/src/history-summary.test.ts` (5 тестов). Тест на границу: приём пищи в 01:30 по Калининграду теперь попадает в текущий день, а вчерашние 22:00 — нет.
> Исправлено в продакшн-коде: `countRecommendationsToday` теперь фильтрует `deliveryStatus: 'sent'`. Строка `Message` создаётся до отправки, поэтому недоставленное сообщение сжигало слот из трёх — вопреки собственному комментарию функции.
> Исправлено: сбой доставки рекомендации больше не прерывает `processDiaryEntry` — раньше исключение из `sendTelegramMessage` выбрасывалось наружу и вечерняя сводка в этот вызов не проверялась вообще. Теперь сбой логируется, обработка идёт дальше, недоставленное подбирает job в 20:00 (5.8). `Recommendation.status` остаётся `'sent'` (= «выпущена»): других значений CHECK-констрейнт не допускает, а job ретрая ищет именно `status='sent'` без связанного `Message`; факт доставки живёт в `Message.deliveryStatus`.
13.5 [x]
Интеграционные тесты admin/internal API на тестовой БД
ФТ-19, ФТ-1
> Сервер поднят на голом `node:http`: тест стартует его на случайном порту и ходит `fetch`. Закрывает валидацию, admin-auth, формат ошибки `{ error: { code, message, details } }`, 409 `ACTIVE_LINK_EXISTS`, 422 `ENROLLMENT_NOT_ACTIVE`. Данные откатываются между кейсами.
> `packages/api/src/api.integration.test.ts` (26 тестов, всё настоящее — ни одного мока): `createApiServer` слушает порт 0, запросы идут через `fetch`, БД — тестовый Supabase. Группы: admin-auth и маршрутизация (health без токена, 401 без заголовка и с чужим токеном, 404 в общем формате, `expired-links` не перехватывается паттерном `:enrollmentId`); валидация (обязательные поля, несуществующая дата `2026-02-30`, `durationDays: 0`, битый JSON, `page=0`, `limit=1000` → clamp до 100, неизвестное значение фильтра); курсы и клиенты (`endDate = startDate + durationDays`, строка `NotificationSettings` создаётся, 404 `COURSE_NOT_FOUND` и `CLIENT_NOT_FOUND`); жизненный цикл ссылки (срок 7 дней и префикс `enr_`, 409 `ACTIVE_LINK_EXISTS`, `force` отзывает прежнюю, 422 `LINK_STILL_ACTIVE`, 404 `ENROLLMENT_NOT_FOUND`, 422 `ENROLLMENT_NOT_ACTIVE` с подсказкой про новый enrollment, отзыв и повторный отзыв → 422 `LINK_NOT_ACTIVE`, regenerate истёкшей переводит прежнюю в `expired`).
> Прогон вынесен в отдельную команду `npm run test:integration` (`vitest.integration.config.ts`, `fileParallelism: false`): набор требует живую БД и чистит её целиком, поэтому в блокирующем `npm test` ему не место — `vitest.config.ts` исключает `*.integration.test.ts`. Логика та же, что с eval-наборами: `npm test` остаётся детерминированным и не зависит от внешних сервисов.
> Схема тестовой базы накатывается сама: `setupTestDatabase()` в `@nutrition-bot/shared/testing` вызывает umzug (`migrateTestDatabase`), а тот применяет только неисполненные миграции — ручной `npm run db:migrate` на тестовую БД не нужен. `truncateTestDatabase()` в `beforeEach` берёт список таблиц из `pg_tables`, а не из константы: иначе новая миграция тихо оставляла бы свои данные между кейсами (`SequelizeMeta` сохраняется). Один кейс проверяет сам откат — список курсов пуст, хотя предыдущий тест их создавал.
> Ожидания правились по фактическому контракту, не наоборот: `onboardingStatus` у нового enrollment — `pending` (не `not_started`), а настройки уведомлений в `GET /admin/clients/:id` лежат в поле `notifications` и отдают дефолты даже без строки в БД, поэтому наличие самой строки проверяется через модель.
> Идентификаторы в тестах — валидные UUID: `findByPk('missing')` уронил бы драйвер на `invalid input syntax for type uuid` и вернул 500 вместо 404, так что «несуществующий id» должен быть формата UUID.
> Замечание на будущее: internal API (`POST /internal/enrollment-links/activate` из adminAPI.md) в коде отсутствует — активацию ссылки бот делает напрямую через сервисы. Покрывать нечего; если эндпоинт появится, тесты сюда же.
13.6 [x]
Сценарные тесты бота по CJM
ФТ-2, ФТ-3, ФТ-5
> Вызов хендлеров с поддельным `ctx`: активация ссылки → анкета → настройки → первая запись дневника → рекомендация.
> `packages/bot/src/cjm.integration.test.ts` (22 теста): поддельный `ctx` собирает те же вызовы, что и `bot.ts` (middleware контекста → `adminTextMiddleware` → хендлер), но состояние живёт в тестовой БД — переходы `onboardingStatus` проверяются по строкам, а не по вызовам моков. Наружу не уходит ничего: `sendTelegramMessage` замокан, движок — `MockAIEngine` (в `beforeAll` принудительно `AI_PROVIDER=mock` + `resetAIEngine()`), сеть не используется.
> Главный сценарий одним тестом: активация ссылки (`used`, `usedByTelegramId`, привязка `telegramId`, попытка `success` в журнале) → `in_progress` и первый вопрос → 10 вопросов анкеты (3 текстовых, 7 через inline-кнопки, ответ на «Как к вам обращаться?» уходит в `Client.firstName`) → `settings_pending` → визард настроек (время → частота → типы) → `completed` → запись дневника с временем из ключевого слова и калорийностью → строка `Recommendation` на эту запись.
> `processDiaryEntry` обёрнут делегирующим моком: обработка настоящая, но промис складывается в очередь, и тест дожидается её через `drainAiQueue()`. Без этого fire-and-forget из 13.4 продолжал бы писать в БД, пока следующий кейс её очищает.
> Ветки: ссылка использованная / истёкшая (переходит в `expired`) / отозванная (внешне неотличима от несуществующей) / неизвестный код — с проверкой журнала попыток (ФТ-1); продление курса не запускает анкету заново (ФТ-18); текст вместо кнопок не двигает прогресс; «Готово» без выбора в мультивыборе; кнопка от уже пройденного вопроса; «Другое» с free text сохраняется как `{ values, freeText }`; визард не закрывается с пустым набором типов; время вне списка слотов отклоняется; до завершения настроек запись в дневник не создаётся; уточнения от первой попытки до третьей («Записал как есть»).
> Найдено и исправлено в продакшн-коде: в `nutrition-diary.ts` два регулярных выражения не срабатывали никогда — в JS `\b` считает словом только ASCII, поэтому граница рядом с кириллицей ложна. Из-за этого «в 14:30 борщ» получал текущее время вместо указанного, а «350 ккал» никогда не попадало в `approxCalories` (обе функции выглядели рабочими и молча возвращали fallback). Заменено на явные границы: `(?:^|\s)в\s+(\d{1,2})[:.](\d{2})?(?!\d)` и `(?:ккал|калори[йи]|кал)(?![а-яё])`.
> На этот разбор добавлены быстрые юнит-тесты в `packages/bot/src/services/nutrition-diary.test.ts` (7 кейсов: явное время, время в середине фразы, ключевое слово, «ккал» и «калорий», «калача» не считается калориями, недопустимое время не портит описание) — регрессия должна ловиться в `npm test`, а не только в медленном сценарном наборе.
> Стоимость прогона: ~165 c на удалённой тестовой БД — каждый шаг сценария это несколько запросов (middleware перечитывает клиента, enrollment и настройки). `testTimeout` в `vitest.integration.config.ts` поднят до 60 c, у главного сценария свой лимит 180 c.
> Замечание для 13.9: сценарный набор запускается отдельной командой, в coverage от `npm test` он не входит — порог нужно ставить по `npm test`, иначе цифра будет считаться по коду, который блокирующий прогон не трогает.
13.7 [x]
Job'ы scheduler с фейковыми таймерами
ФТ-4, ФТ-8, ФТ-24
> Расписания и часовые пояса, идемпотентность повторного запуска. У `delivery-failure-alert-job` модульная переменная `lastAlertSentAt` — состояние течёт между кейсами, нужен сброс или вынос дедупликации из модуля.
> Покрыты все 12 job'ов: 11 новых файлов, 80 тестов (`npm test` 138 → 218). Каждый на `vi.useFakeTimers()` + `vi.setSystemTime()`, модели `@nutrition-bot/shared` замоканы через `importOriginal` — хелперы времени берутся настоящие, наружу не уходит ни один запрос. Покрытие `packages/scheduler/src/jobs` — 94.7% строк (было 6%), проект целиком — 33.5% statements.
> Слоты и пояса (ФТ-4/ФТ-8/ФТ-24): у каждого времязависимого job'а закреплено, что слот считается по локальному времени клиента, а не по UTC сервера — отдельными кейсами «09:00 UTC ≠ 09:00 у клиента» и «20:00 UTC — уже 22:00, слот пропущен». `daily-reminder` — все четыре частоты (`daily`, паритет `every_other_day` от `startDate`, пн/ср/пт для `three_per_week`, `custom_days` молчит как post-MVP). `evening-summary` — порог «не раньше 21:00», а не «ровно в 21:00»; зафиксирована и обратная сторона этого порога: после локальной полуночи слот закрывается и сводка за прошедший день в этот запуск уже не уйдёт.
> Идемпотентность: границы локальных суток проверяются по фактическим аргументам `Op.between` (сутки Калининграда начинаются в 22:00 UTC предыдущего дня), а повторный запуск в том же слоте прогоняется дважды — второй раз job видит собственное сообщение/запись и молчит (`evening-reminder`, `pending-diary`, `recommendation-delivery`, `data-retention`). У каждого job'а есть кейс «сбой на одном клиенте не мешает следующему» (ФТ-21, roadmap 10.4).
> `delivery-failure-alert-job`: `lastAlertSentAt` вынесен из модуля в явный `DeliveryFailureAlertState` — параметр с состоянием по умолчанию, так что cron вызывает job как раньше, а тест передаёт своё состояние. Test-only экспорта вида `resetState()` не появилось. Заодно закреплено, что сбой самого алерта не занимает слот интервала: `lastAlertSentAt` остаётся `null` и следующий запуск пробует снова.
> Инфраструктура: в `test/setup.ts` зафиксирован `TZ=UTC`. Job'ы получают локальное время через `toZonedTime`, а это конструирование даты в поясе процесса — без фиксации результат зависел бы от машины разработчика и от DST-переходов в её поясе.
> Найдено и исправлено в продакшн-коде: `isEveryOtherDay` в `daily-reminder.ts` считал паритет дней через `parseISO(startDate)` + `toZonedTime`, то есть через пояс процесса. На сервере в `Europe/Moscow` или `Asia/Tokyo` разница дат уезжала на единицу и «через день» попадало ровно в противоположные дни — проверено прямым прогоном по четырём поясам. Теперь обе даты приводятся к календарному `yyyy-MM-dd` (`formatZonedDate`) и только потом сравниваются; добавлена и защита `daysDiff >= 0` — раньше курс, который ещё не начался, при разнице в −2 дня давал чётный остаток и напоминание уходило до `startDate`. Регрессия закреплена кейсом, который гоняет job под четырьмя системными поясами.
> Исправлено: `recommendation-delivery-job` проверял слот 20:00 внутри цикла, уже после `Recommendation.findAll` и `NotificationSettings.findOne` на каждую рекомендацию. Слот один для всех клиентов (фиксированный пояс студии), а cron бьёт каждые 30 минут — 47 запусков из 48 делали N+1 запросов впустую. Проверка поднята до выборки, тест требует ноль запросов вне слота.
> Убрано дублирование: локальный `getZonedDayRange` в `evening-reminder-job.ts` повторял одноимённый хелпер из `@nutrition-bot/shared` — заменён на общий, как `buildHistorySummary` в 13.4. `daily-reminder` и `recommendation-delivery` перешли на `formatZonedTime`/`formatZonedDate` вместо ручной пары `toZonedTime` + `format`.
> Тестовые утилиты: `makeTestLogger()` в `@nutrition-bot/shared/testing` вместо копии заглушки `Logger` в каждом файле.
> Замечание для 13.9: `packages/scheduler/src/http-server.ts` (force-эндпоинты job'ов) и `config.ts` — 0%. Это не логика job'ов, а транспорт; ставить порог по пакету целиком нельзя, ориентир — папка `jobs`.
13.8 [x]
ИИ-уточнения по неполной записи дневника + eval-набор
ФТ-22
> Реализован метод `AIEngine.checkDiaryClarity` с типами `ClarityCheckInput`/`ClarityCheckResult` (`needsClarification`, `missingFields`, `question`).
> `MockAIEngine` определяет неполную запись эвристикой: отсутствие продукта (`product`) или количества (`quantity`), с детерминированным вопросом.
> `OpenAICompatibleAIEngine` вызывает модель с JSON-форматом и промптом `CLARITY_CHECK_SYSTEM_PROMPT`; при сбое провайдера или битом JSON возвращает безопасный fallback (`needsClarification: false`), чтобы не спамить клиента уточнениями.
> `packages/bot/src/services/nutrition-diary.ts` заменил `isIncompleteDescription` на `engine.checkDiaryClarity`: первая неполная запись создаёт `NutritionDiary` со статусом `needs_clarification` и мягким вопросом от AI; при уточнении описания объединяются и снова проверяются; после 3 попыток запись остаётся `needs_clarification` для администратора.
> Eval-набор `packages/ai/src/clarity-check.eval.ts`: baseline для `MockAIEngine` (15 кейсов, 100% pass) и контрактные проверки `OpenAICompatibleAIEngine` с замоканным SDK. Запускается отдельно: `npm run eval`.
> Юнит-тесты `nutrition-diary.test.ts` обновлены: замокан `createAIEngine`, добавлены кейсы на уточнение, разрешение и сбой AI. `npm test` — 223 passed, `npm run eval` — 15 passed.
13.9 [x]
Зафиксировать порог покрытия в vitest.config.ts
nonFR
> После 13.2–13.7 выставить `coverage.thresholds` по достигнутому уровню, чтобы покрытие не проседало обратно.
> Порог считается по набору `npm test` (без `*.integration.test.ts` и eval) — сценарный прогон в coverage не входит. Проверка: `npm run test:coverage`.
> Фактическое покрытие на момент фиксации: statements 34.5%, branches 27.5%, functions 31.04%, lines 34.83%. В конфиг записан floor: 34 / 27 / 31 / 34 — регресс ломает прогон, шум v8 на десятые доли — нет.
> Отдельный порог на `packages/scheduler/src/jobs/**/*.ts` (94 / 88 / 100 / 96): `http-server.ts` и `config.ts` — транспорт с 0%, пакет целиком ставить нельзя.
> Модули 13.2–13.4 с ~100% строк зафиксированы отдельно (`sender.ts`, `diary-processor.ts`, `evening-summary.ts`, `history-summary.ts`), чтобы глобальные 34% нельзя было удержать, выкинув эти тесты.
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