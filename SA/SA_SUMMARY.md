# SA SUMMARY

> Компактная выжимка из папки `SA` для экономии токенов. Используй этот файл вместо чтения всех документов SA целиком.
> Полный документ читай **только** если нужны детали, отсутствующие здесь. Источник указан в скобках рядом с разделом.
> При изменении любого файла в `SA/` — обнови соответствующий раздел этой выжимки.

**Карта источников:** `vision.md` (продукт/метрики) · `UserResearch.md` (персоны) · `Domain_Analysis_v2.md` (сущности, бизнес-правила) · `ERD.md` (схема БД, поля, ограничения) · `Functional_Requirements.md` (ФТ-1..ФТ-23) · `nonFR.md` (нефункц. требования) · `CJM.md` (сценарий) · `anketa.md` (вопросы онбординга) · `adminAPI.md` (REST + Telegram Bot API) · `stage9-dashboards.md` (панели управления: админ и специалист, API-контракты + Postman).

---

## 1. Продукт (vision.md)

Telegram-бот «Виртуальный консультант по питанию» для клиентов фитнес-студии. Мягко, ненавязчиво помогает соблюдать питание: собирает дневник питания, анализирует через AI, шлёт персональные рекомендации, финальный отчёт и предложение продлить курс.

- **ЦА (UserResearch.md):** Анна (боится осуждения, не любит считать калории) и Марина (мало времени). Общий вывод: минимум ручного ввода, приблизительные ответы — норма, фото как основной способ ввода, короткая анкета.
- **Тон:** без критики, признать обстоятельства → предложить альтернативу.
- **MVP-границы:** пилот на одной студии, один полный цикл курса.
- **Метрики:** доля ежедневных записей, % соблюдения рекомендаций, % продлений, средняя оценка Feedback ≥ 4/5, доля досрочных отключений.

---

## 2. Роли и внешние системы (Domain §1)

- **Client** — конечный пользователь (Telegram).
- **Administrator** — управляет клиентами, генерирует ссылки, видит статистику и негативный feedback.
- **Specialist** — видит соблюдение рекомендаций и прогресс для корректировки тренировок.
- **AI Engine** — анализ питания, генерация рекомендаций.
- **External:** Telegram (канал доставки), опц. Open API калорийности.

---

## 3. Модель данных (ERD.md, Domain §2)

**Ключевое решение:** «периодные» сущности принадлежат `ClientEnrollment`, а не `Client` (при продлении курса enrollment'ов несколько). FK `clientEnrollmentId` — NOT NULL; `clientId` — денормализованная копия, обязана совпадать с `clientEnrollment.clientId`.

### Сущности и ключевые поля

- **Client:** `id, firstName, lastName, telegramId?(bigint), telegramUsername?, email?, phone?(unique), registeredAt, lastInteractionAt?`
- **Course:** `id, name, durationDays, startDate, endDate`
- **GoalTemplate:** `id, courseId, type(weight_loss|muscle_gain|metabolism|health), description`
- **ClientEnrollment:** `id, clientId, courseId, startDate, endDate, status(active|paused|completed|cancelled), onboardingStatus(pending|in_progress|settings_pending|completed)`
- **Goal** (перс. экземпляр, 1:1 к enrollment): `id, clientEnrollmentId, goalTemplateId, targetMetrics, baselineMetrics, timeHorizon`
- **EnrollmentLink:** `id, enrollmentId, code(в БД без префикса enr_), createdAt, expiresAt(+7д), usedAt?, usedByTelegramId?, revokedAt?, status(active|used|expired|revoked)`
- **EnrollmentLinkAttempt** (лог ФТ-1): `id, linkId, attemptedAt, telegramId?, result(success|expired|already_used|invalid_code|enrollment_cancelled)`
- **NutritionDiary:** `id, clientEnrollmentId(NOT NULL), clientId(denorm), mealAt, description, approxCalories?, hasPhoto, photoRef?(encrypted), status(filled|pending|needs_clarification), createdAt`
- **Habit:** `id, clientId, description, status(active|inactive), frequency(daily|weekdays|custom)`
- **NotificationSettings** (1:1 к Client): `id, clientId(unique), reminderTime(HH:mm), frequency(daily|every_other_day|three_per_week|custom_days), enabledTypes(diary|recommendations|weekly_report), timezone(IANA, def Europe/Moscow), enabled, disabledReason?(user_request|inactivity)`
- **Questionnaire:** `id, clientEnrollmentId, clientId(denorm), answers(json), currentQuestion, status(in_progress|completed), lastAnswerAt?, lastReminderAt?, completedAt?, analysisResult?(json)`
- **Recommendation:** `id, clientId, nutritionDiaryId?, questionnaireId?(ровно один из двух), type(product|habit|regimen|calories), priority(critical|high|medium|low), content?(текст рекомендации), status(sent|read|applied|dismissed), createdAt`
- **Message:** `id, clientId, recommendationId?, type(recommendation|reminder|questionnaire_reminder|evening_reminder|report|info), category(transactional|optional), content, channel(telegram|whatsapp|max), deliveryStatus(sent|delivered|read|delivery_failed), retryCount(0..3), createdAt`
- **Reminder:** `id, clientId, type(fill_diary|check_recommendation), schedule, status(active|inactive|done)`
- **Feedback:** `id, clientId, recommendationId, rating(1..5), comment?(обязателен при 1-3), isApplied?, isResolved(default false), createdAt`
- **Report:** `id, clientEnrollmentId(NOT NULL), clientId(denorm), periodStart, periodEnd, type(weekly|monthly|final), diaryStats(json), adherencePercent, problemAreas(json), dynamics(json), createdAt`
- **RenewalOffer:** `id, clientId, enrollmentId(NOT NULL), status(sent|clicked|converted|dismissed), checkoutUrl, basePrice(int копейки), discountPercent(0–100), finalPrice(int копейки), offeredAt, clickedAt?` — предложение продления курса (roadmap 8)
- **Progress:** `id, clientEnrollmentId(NOT NULL), clientId(denorm), goalId, measuredAt, metrics(json), achievementPercent, comment?`
- **AIModelLog** (без связей): `id, version, updatedAt, updateReason, analystComment`

### Связи (кратко)

`Client 1→M ClientEnrollment M←1 Course`; `Course 1→M GoalTemplate 1→M Goal`; `ClientEnrollment 1→1 Goal`; `ClientEnrollment 1→M {EnrollmentLink, NutritionDiary, Report, Progress, Questionnaire}`; `EnrollmentLink 1→M Attempt`; `Client 1→1 NotificationSettings`; `Client 1→M {Habit, Recommendation, Message, Reminder, Feedback}`; `NutritionDiary/Questionnaire 1→M Recommendation`; `Recommendation 1→M {Feedback, Message}`; `Goal 1→M Progress`.

### MVP-подмножество (roadmap 0.3)

Обязательно: `Client, Course, ClientEnrollment, EnrollmentLink, NotificationSettings, Questionnaire, NutritionDiary, Message, Recommendation, Report, Feedback` (+ `EnrollmentLinkAttempt` желателен по ФТ-1).
Позже: `GoalTemplate, Goal, Progress, Habit, Reminder, AIModelLog`.

---

## 4. Критические бизнес-правила (Domain §6, ERD §5)

1. Recommendation — только на основе `NutritionDiary` **или** `Questionnaire` (ровно один FK, CHECK).
2. Progress — только для `ClientEnrollment.status='active'`.
3. NotificationSettings инициализируются при создании Client.
4. Feedback — не позднее 24 ч после Recommendation.
5. Message в Telegram отправляется асинхронно.
6. AI Engine переобучается на Feedback с низкой оценкой → запись в AIModelLog.
7. Напоминание об анкете — только при `status=in_progress` и молчании > N часов (def 24 ч).
8. EnrollmentLink одноразова **по активации**: после привязки telegramId → `used`; до активации открывается многократно в пределах 7 дней.
9. Не более одной `EnrollmentLink` со `status='active'` на enrollment (partial unique index `WHERE status='active'`).
10. `Message.category='transactional'` (итоговый отчёт, запрос feedback) **не блокируется** отключением уведомлений (ФТ-12).

---

## 5. Функциональные требования (Functional_Requirements.md)

**Фаза 1 — Онбординг:** ФТ-1 генерация/управление ссылками (Critical) · ФТ-2 онбординг + анкета с сохранением прогресса и мягким напоминанием (Critical) · ФТ-3 настройка уведомлений после анкеты (Critical).
**Фаза 2 — Сбор данных:** ФТ-4 ежедневное напоминание о дневнике (Critical) · ФТ-5 приём текста/фото питания, ретрай доставки 5 мин ×3 (Critical).
**Фаза 3 — Анализ:** ФТ-6 анализ паттернов после каждого ввода (Critical) · ФТ-7 мягкие рекомендации, макс 2-3/день (Critical) · ФТ-8 вечернее (20:00) напоминание о незаполненном дневнике (High).
**Фаза 4 — Активность:** ФТ-9 предупреждение при 48 ч молчания (High) · ФТ-10 автоотключение при 72+ ч (High) · ФТ-11 восстановление при любом сообщении (High) · ФТ-12 добровольное /stop /pause с причиной user_request (High).
**Фаза 5 — Завершение:** ФТ-13 определение конца курса (Critical) · ФТ-14 итоговый отчёт (Critical) · ФТ-15 запрос оценки 1-5 (High) · ФТ-16 при 1-3 звёздах — комментарий + уведомление админу (High) · ФТ-17 при 4-5 — благодарность + отзыв на 2Gis/Яндекс за бонус (High).
**Фаза 6 — Продление:** ФТ-18 предложение продлить со скидкой 15% (High).
**Фаза 7 — Панели:** ФТ-19 админ-панель (клиенты, ссылки, статистика, CSV/Excel) (High) · ФТ-20 панель специалиста (прогресс, соблюдение) (High).
**Фаза 8 — Ошибки:** ФТ-21 обработка ошибок доставки Telegram, статус delivery_failed (Critical) · ФТ-22 валидация некорректного ввода, макс 3 попытки → needs_clarification (High) · ФТ-23 архивирование данных после курса, удаление только по запросу/GDPR (High).

---

## 6. Нефункциональные требования (nonFR.md)

- **Производительность:** ответ бота p95 < 5 c; AI-анализ асинхронный, не блокирует подтверждение.
- **Доступность:** 24/7, SLA 99.5%/мес; напоминания по часовому поясу клиента.
- **Данные/безопасность:** хранение = срок участия + 12 мес; соответствие 152-ФЗ (или локальному закону); фото и анкеты — шифрование.
- **Масштабируемость:** N активных клиентов/студия без деградации (N уточняется на пилоте); уйти от ручного подключения как единственного канала.
- **Расширяемость каналов:** готовность к WhatsApp/Max без смены модели (`Message.channel` — enum).
- **Мониторинг:** логирование сбоев доставки и ошибок AI; алерт админу при массовых сбоях.
- **Внешние сервисы:** учитывать rate limits и стоимость AI API (влияет на частоту вызовов в ФТ-6).

---

## 7. Анкета онбординга (anketa.md)

10 вопросов: 1) имя (текст) 2) возраст (число) 3) вес кг (число) 4) главная цель (один вариант) 5) что мешает (мультивыбор) 6) режим питания (один) 7) активность (один) 8) вода (один) 9) сон (один) 10) особенности здоровья (мультивыбор + «другое»). Прогресс сохраняется после каждого ответа; при молчании > N ч — «Вы остановились на вопросе {X}».

---

## 8. Admin/Internal/Telegram API (adminAPI.md) — единственный готовый контракт

- **Общее:** Base `/api/v1`; JSON UTF-8; Auth MVP `Authorization: Bearer <ADMIN_API_TOKEN>` (статич. токен из env); даты ISO 8601 UTC; ID UUID v4. Коды: 200/201/400/401/404/409/422/500. Ошибка: `{ error: { code, message, details } }`.
- **Ссылки:** срок 7 дней; одноразова по активации; формат кода `enr_` + 16 символов base64url (≤ 64). Deep link: `https://t.me/{BOT}?start={payload}` → бот получает `/start {payload}`.
- **Admin эндпоинты MVP:** `GET /health`; `GET/POST /admin/courses`; `POST/GET /admin/clients`, `GET /admin/clients/:id`; `POST /admin/clients/:clientId/enrollments` (roadmap 8.4 — продление, 422 ACTIVE_ENROLLMENT_EXISTS); `GET /admin/enrollments/:id`; `POST /admin/enrollments/:id/link` (409 ACTIVE_LINK_EXISTS, 422 ENROLLMENT_NOT_ACTIVE, `force:true` отзывает active); `POST .../link/regenerate` (для истёкших/отозванных); `GET .../link`; `DELETE .../link/:linkId` (revoke); `GET /admin/enrollments/expired-links`. Список клиентов — фильтры status/enrollmentStatus/onboardingStatus/hasTelegram/linkStatus + пагинация; в списке только инициалы, полное ФИ — в деталях.
- **Internal API (bot→api):** auth `X-Internal-Token`; `POST /internal/enrollment-links/activate` `{code, telegramId, telegramUsername?, languageCode?}` → 200 `{success, enrollmentId, clientId, onboardingStatus}` / 422 (LINK_EXPIRED|ALREADY_USED|INVALID_CODE|ENROLLMENT_CANCELLED).
- **Telegram Bot API (bot-сервис, не admin):** getMe/getUpdates/setWebhook (dev=polling, prod=webhook+secret_token); `allowed_updates=["message","callback_query","my_chat_member"]`; sendMessage (parse_mode HTML), sendPhoto, sendChatAction(typing), editMessageText, answerCallbackQuery; getFile для фото (лимит 20 MB). `callback_data` ≤ 64 байт, примеры: `q:4:opt:2`, `settings:time:09:00`, `feedback:stars:4`, `pause:week`.

---

## 9. Панели управления (stage9-dashboards.md)

- **Админ (ФТ-19):** `GET /admin/enrollments/:id/diary` (анонимно); `GET /admin/statistics/recommendations` (соблюдение по статусам и приоритетам); `GET /admin/feedback/critical` (рейтинг ≤ 3, фильтр `unresolvedOnly`, поле `isResolved`); `GET /admin/renewal-offers` (сводка по статусам и конверсия); `GET /admin/export/clients?format=csv` (CSV c BOM, UTF-8); `GET /admin/messages/failed` (недоставленные, фильтр `exhaustedRetries`).
- **Специалист (ФТ-20):** `GET /specialist/clients/:id/reports` (итоговые отчёты); `GET /specialist/clients/:id/compliance` (процент применённых рекомендаций за текущий enrollment); `GET /specialist/statistics/problems` (топ проблем из `Report.problemAreas`); `GET /specialist/statistics/activity` (заполнение дневника, фильтр `minFillRate`); `GET /specialist/clients/:id/feedback` (read-only). MVP: тот же Bearer-токен, post-MVP — JWT/RBAC.

---

## 10. Открытые вопросы / допущения

- **Часовой пояс:** MVP — `language_code` + default `Europe/Moscow`, ручной выбор в `/settings`.
- **NotificationSettings** привязаны к Client (1:1); при параллельных enrollment потребуется пересмотр.
- **Reminder vs Message:** Reminder — правило расписания, Message — факт доставки; связь в MVP не обязательна.
- **Auth admin:** MVP static token; prod — JWT + RBAC.
- **Конфликт с персонами:** обязательная анкета 5+ вопросов и требование цифр в ФТ-5 противоречат барьерам Анны/Марины → смягчать (приблизительные ответы, фото). Учитывать при реализации онбординга.
