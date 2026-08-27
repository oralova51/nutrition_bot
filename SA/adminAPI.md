# ADMIN API

## Виртуальный консультант по питанию

Спецификация REST Admin API и используемых методов Telegram Bot API.

**Закрывает:** roadmap 0.5, 3.1–3.6, 9.1–9.3 (MVP)  
**Связанные документы:** `Functional_Requirements.md` (ФТ-1, ФТ-19), `Domain_Analysis_v2.md`, `CJM.md`

---

## 1. Общие принципы Admin API

| Параметр | Значение |
|----------|----------|
| Base URL (dev) | `http://localhost:3000/api/v1` |
| Base URL (prod) | `https://api.{studio-domain}/v1` |
| Формат | JSON, UTF-8 |
| Версионирование | Префикс `/v1` |
| Auth (MVP) | `Authorization: Bearer <ADMIN_API_TOKEN>` (статический токен из env) |
| Auth (post-MVP) | JWT / OAuth2 (roadmap 9.1) |
| Даты | ISO 8601 UTC (`2026-07-07T12:00:00Z`) |
| ID | UUID v4 |

### Стандартные коды ответов

| Код | Когда |
|-----|-------|
| 200 | Успешный GET/PATCH/DELETE |
| 201 | Создан ресурс |
| 400 | Невалидные параметры |
| 401 | Нет или неверный токен |
| 404 | Ресурс не найден |
| 409 | Конфликт (например, активная ссылка уже существует) |
| 422 | Нарушено бизнес-правило |
| 500 | Внутренняя ошибка |

### Формат ошибки

```json
{
  "error": {
    "code": "ENROLLMENT_NOT_FOUND",
    "message": "ClientEnrollment with id '...' not found",
    "details": {}
  }
}
```

---

## 2. Правила enrollment-ссылок

Закрывает roadmap **3.3** (одноразовая vs многоразовая ссылка).

| Правило | Значение |
|---------|----------|
| Срок действия | 7 дней с `createdAt` |
| Одноразовость | **Одноразовая по активации**: после успешной привязки `telegramId` поле `usedAt` заполняется, повторное использование запрещено |
| До активации | Ссылку можно открывать несколько раз, пока не истёк срок и enrollment не привязан к Telegram |
| После истечения | Только `POST .../link/regenerate` |
| Формат кода | Префикс `enr_` + 16 символов base64url (итого ≤ 64 символов для Telegram) |

### Telegram deep link

По [документации Telegram](https://core.telegram.org/bots/features#deep-linking):

```
https://t.me/{BOT_USERNAME}?start={payload}
```

- Допустимые символы payload: `A-Z`, `a-z`, `0-9`, `_`, `-`
- Максимум **64 символа**
- Бот получает сообщение: `/start {payload}`

**Пример:**

```
https://t.me/nutrition_studio_bot?start=enr_a1b2c3d4e5f6g7h8
```

→ Update: `message.text = "/start enr_a1b2c3d4e5f6g7h8"`

---

## 3. Сущности (см. также Domain_Analysis_v2.md)

### EnrollmentLink

| Поле | Тип | Описание |
|------|-----|----------|
| id | UUID | PK |
| enrollmentId | UUID | FK → ClientEnrollment |
| code | string | Уникальный код (в БД без префикса `enr_`) |
| expiresAt | datetime | createdAt + 7 дней |
| usedAt | datetime \| null | Время успешной привязки |
| usedByTelegramId | bigint \| null | Telegram user id |
| status | enum | `active`, `used`, `expired`, `revoked` |
| createdAt | datetime | |
| revokedAt | datetime \| null | При regenerate/revoke |

### EnrollmentLinkAttempt (лог ФТ-1)

| Поле | Тип | Описание |
|------|-----|----------|
| id | UUID | PK |
| linkId | UUID | FK → EnrollmentLink |
| attemptedAt | datetime | |
| telegramId | bigint \| null | |
| result | enum | `success`, `expired`, `already_used`, `invalid_code`, `enrollment_cancelled` |

---

## 4. REST Admin API — эндпоинты MVP

### 4.1 Health

#### `GET /health`

Без auth. Roadmap 1.10.

**Response 200:**

```json
{
  "status": "ok",
  "version": "0.1.0",
  "database": "connected"
}
```

---

### 4.2 Курсы

#### `GET /admin/courses`

Список курсов студии.

**Response 200:**

```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Курс коррекции фигуры 30 дней",
      "durationDays": 30,
      "startDate": "2026-07-01",
      "endDate": "2026-08-01"
    }
  ]
}
```

#### `POST /admin/courses`

Создание курса (roadmap 12.1, seed пилота).

**Body:**

```json
{
  "name": "Курс коррекции фигуры 30 дней",
  "durationDays": 30,
  "startDate": "2026-07-01"
}
```

**Response 201:** объект курса.

---

### 4.3 Клиенты и enrollments

#### `POST /admin/clients`

Создание клиента и enrollment до подключения к Telegram.

**Body:**

```json
{
  "firstName": "Анна",
  "lastName": "Иванова",
  "email": "anna@example.com",
  "courseId": "uuid",
  "enrollmentStartDate": "2026-07-07"
}
```

**Response 201:**

```json
{
  "client": {
    "id": "uuid",
    "firstName": "Анна",
    "lastName": "Иванова",
    "email": "anna@example.com",
    "telegramId": null,
    "registeredAt": "2026-07-07T10:00:00Z"
  },
  "enrollment": {
    "id": "uuid",
    "courseId": "uuid",
    "status": "active",
    "startDate": "2026-07-07",
    "endDate": "2026-08-06",
    "onboardingStatus": "pending"
  }
}
```

`onboardingStatus`: `pending` | `in_progress` | `completed` | `settings_pending`

---

#### `GET /admin/clients`

Список клиентов (ФТ-19).

**Query params:**

| Param | Тип | Описание |
|-------|-----|----------|
| status | string | `active` \| `inactive` \| `all` (default: `all`) |
| enrollmentStatus | string | `active`, `paused`, `completed`, `cancelled` |
| onboardingStatus | string | `pending`, `in_progress`, `completed` |
| hasTelegram | boolean | Привязан ли Telegram |
| linkStatus | string | `no_link`, `active`, `expired`, `used` |
| page | number | default 1 |
| limit | number | default 20, max 100 |
| sort | string | `registeredAt`, `lastInteractionAt`, `enrollmentEndDate` |
| order | string | `asc`, `desc` |

**Логика `status`:**

- `active` — enrollment `active` + NotificationSettings `enabled` + есть `telegramId`
- `inactive` — нет telegramId, или notifications off (`inactivity` / `user_request`), или enrollment `paused` / `completed`

**Response 200:**

```json
{
  "data": [
    {
      "id": "uuid",
      "displayName": "Анна И.",
      "telegramId": null,
      "telegramUsername": null,
      "enrollment": {
        "id": "uuid",
        "courseName": "Курс 30 дней",
        "status": "active",
        "startDate": "2026-07-07",
        "endDate": "2026-08-06"
      },
      "onboarding": {
        "status": "in_progress",
        "currentQuestion": 3,
        "totalQuestions": 10,
        "lastAnswerAt": "2026-07-07T11:30:00Z"
      },
      "notifications": {
        "enabled": false,
        "disabledReason": null
      },
      "link": {
        "status": "active",
        "expiresAt": "2026-07-14T10:00:00Z",
        "url": "https://t.me/nutrition_studio_bot?start=enr_a1b2c3d4e5f6g7h8"
      },
      "lastInteractionAt": null,
      "registeredAt": "2026-07-07T10:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "totalPages": 3
  }
}
```

> В списке — инициалы (`displayName`); полное ФИ только в `GET /admin/clients/:clientId` (ФТ-19).

---

#### `GET /admin/clients/:clientId`

**Response 200:**

```json
{
  "id": "uuid",
  "firstName": "Анна",
  "lastName": "Иванова",
  "email": "anna@example.com",
  "telegramId": 123456789,
  "telegramUsername": "anna_i",
  "registeredAt": "2026-07-07T10:00:00Z",
  "lastInteractionAt": "2026-07-07T14:00:00Z",
  "enrollments": [
    {
      "id": "uuid",
      "courseId": "uuid",
      "courseName": "Курс 30 дней",
      "status": "active",
      "startDate": "2026-07-07",
      "endDate": "2026-08-06"
    }
  ],
  "currentEnrollmentId": "uuid",
  "onboarding": {
    "status": "completed",
    "completedAt": "2026-07-07T12:00:00Z"
  },
  "notifications": {
    "enabled": true,
    "reminderTime": "09:00",
    "frequency": "daily",
    "timezone": "Europe/Moscow"
  }
}
```

---

#### `GET /admin/enrollments/:enrollmentId`

Детали enrollment для экрана генерации ссылки.

**Response 200:**

```json
{
  "id": "uuid",
  "clientId": "uuid",
  "clientDisplayName": "Анна И.",
  "courseId": "uuid",
  "courseName": "Курс 30 дней",
  "status": "active",
  "startDate": "2026-07-07",
  "endDate": "2026-08-06",
  "telegramLinked": false,
  "activeLink": null,
  "linkHistory": [
    {
      "id": "uuid",
      "status": "expired",
      "createdAt": "2026-06-01T10:00:00Z",
      "expiresAt": "2026-06-08T10:00:00Z",
      "usedAt": null
    }
  ]
}
```

---

### 4.4 Генерация ссылок (ФТ-1)

#### `POST /admin/enrollments/:enrollmentId/link`

Roadmap 3.2. Создаёт новую ссылку, если нет активной.

**Body (optional):**

```json
{
  "force": false
}
```

- `force: true` — отозвать текущую active-ссылку и создать новую

**Response 201:**

```json
{
  "link": {
    "id": "uuid",
    "code": "enr_a1b2c3d4e5f6g7h8",
    "url": "https://t.me/nutrition_studio_bot?start=enr_a1b2c3d4e5f6g7h8",
    "enrollmentId": "uuid",
    "status": "active",
    "createdAt": "2026-07-07T10:00:00Z",
    "expiresAt": "2026-07-14T10:00:00Z",
    "usedAt": null
  }
}
```

**Errors:**

- `404` — enrollment не найден
- `422` `ENROLLMENT_NOT_ACTIVE` — status ≠ `active`
- `409` `ACTIVE_LINK_EXISTS` — есть active-ссылка и `force !== true`

---

#### `POST /admin/enrollments/:enrollmentId/link/regenerate`

Roadmap 3.5. Для истёкших или отозванных ссылок.

**Response 201:** как у `POST .../link`

**Errors:**

- `422` `LINK_STILL_ACTIVE` — текущая ссылка ещё valid и не used (используйте `force: true` на обычном endpoint)

---

#### `GET /admin/enrollments/:enrollmentId/link`

Текущая ссылка, история и попытки использования.

**Response 200:**

```json
{
  "active": {
    "id": "uuid",
    "url": "https://t.me/nutrition_studio_bot?start=enr_a1b2c3d4e5f6g7h8",
    "status": "active",
    "expiresAt": "2026-07-14T10:00:00Z"
  },
  "history": [],
  "attempts": [
    {
      "attemptedAt": "2026-07-07T15:00:00Z",
      "result": "success",
      "telegramId": 123456789
    }
  ]
}
```

---

#### `DELETE /admin/enrollments/:enrollmentId/link/:linkId`

Отзыв ссылки до использования. Status → `revoked`.

**Response 200:**

```json
{
  "status": "revoked",
  "revokedAt": "2026-07-07T16:00:00Z"
}
```

---

### 4.5 Enrollments с истёкшими ссылками

#### `GET /admin/enrollments/expired-links`

Клиенты, у которых ссылка истекла и Telegram не привязан (CJM, ФТ-19).

**Query:** `page`, `limit`

**Response 200:**

```json
{
  "data": [
    {
      "enrollmentId": "uuid",
      "clientDisplayName": "Марина К.",
      "linkExpiredAt": "2026-07-01T10:00:00Z",
      "daysSinceExpiry": 6
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 3
  }
}
```

---

## 5. Internal API (bot-сервис)

Эндпоинты, которые вызывает **bot-сервис** при обработке `/start` (не для admin UI).

Auth: заголовок `X-Internal-Token`.

#### `POST /internal/enrollment-links/activate`

**Body:**

```json
{
  "code": "enr_a1b2c3d4e5f6g7h8",
  "telegramId": 123456789,
  "telegramUsername": "anna_i",
  "languageCode": "ru"
}
```

**Response 200:**

```json
{
  "success": true,
  "enrollmentId": "uuid",
  "clientId": "uuid",
  "onboardingStatus": "pending"
}
```

**Response 422:**

```json
{
  "success": false,
  "error": {
    "code": "LINK_EXPIRED",
    "message": "Ссылка истекла. Попросите администратора отправить новую."
  }
}
```

Коды ошибок: `LINK_EXPIRED`, `ALREADY_USED`, `INVALID_CODE`, `ENROLLMENT_CANCELLED`.

### 5.1 Playground: проверка ИИ-уточнений (ФТ-22)

Локальный эндпоинт, чтобы прогнать `checkDiaryClarity` из Postman без Telegram и без записи в БД. Это тот же вызов, что делает бот перед сохранением текстовой записи дневника.

Auth: `Authorization: Bearer <ADMIN_API_TOKEN>` (как у admin-эндпоинтов).

#### `POST /internal/ai/clarity-check`

**Body:**

```json
{
  "description": "я съела яйца",
  "firstName": "Анна",
  "hasPhoto": false,
  "approxCalories": null
}
```

| Поле | Обязательное | Описание |
|------|--------------|----------|
| `description` | да | Текст «как клиент написал в чат» |
| `firstName` | нет | Имя для обращения в вопросе |
| `hasPhoto` | нет | `true`/`false`; в боте фото пока **не** проходят через этот check (OCR отложен) |
| `approxCalories` | нет | Положительное целое, если клиент указал ккал |

**Response 200:**

```json
{
  "needsClarification": true,
  "missingFields": ["quantity"],
  "question": "Сколько яиц примерно?",
  "botReply": "Сколько яиц примерно?",
  "provider": "openai-compatible"
}
```

| Поле | Смысл |
|------|--------|
| `needsClarification` | `true` — клиент получил бы уточнение; `false` — «Спасибо, записал!» и дальше анализ |
| `missingFields` | `product` \| `quantity` (реже `time` \| `calories`) |
| `question` | Формулировка модели; `null`, если уточнение не нужно |
| `botReply` | Итоговый текст в Telegram (если `question` пустой — запасная фраза «Кажется, я не понял. Можете переформулировать?») |
| `provider` | `mock` (эвристика) или `openai-compatible` (живая модель из `AI_PROVIDER`) |

**400** `INVALID_BODY` — пустой `description` или неверный тип опциональных полей.  
**401** `UNAUTHORIZED` — нет или неверный токен.

Коллекция: `postman/ai-clarity.postman_collection.json`.

---

## 6. Telegram Bot API — методы проекта

Admin API **не вызывает** Telegram напрямую. Ниже — методы [Bot API](https://core.telegram.org/bots/api), которые использует **bot-сервис**.

### 6.1 Инициализация и получение updates

| Метод | Назначение | Этап |
|-------|------------|------|
| [getMe](https://core.telegram.org/bots/api#getme) | Проверка токена при старте | 2.1 |
| [getUpdates](https://core.telegram.org/bots/api#getupdates) | Long polling (dev/MVP) | 2.1 |
| [setWebhook](https://core.telegram.org/bots/api#setwebhook) | Webhook (prod) | 2.1 |
| [getWebhookInfo](https://core.telegram.org/bots/api#getwebhookinfo) | Мониторинг webhook | 2.1 |
| [deleteWebhook](https://core.telegram.org/bots/api#deletewhook) | Переключение polling ↔ webhook | 2.1 |
| [setMyCommands](https://core.telegram.org/bots/api#setmycommands) | Публичное меню: `/settings`, `/site`, `/buy` | меню |

**Рекомендуемые `allowed_updates` для MVP:**

```json
["message", "callback_query", "my_chat_member"]
```

### 6.2 Входящие updates

| Update field | Обработка |
|--------------|-----------|
| `message` | Текст, фото, команды `/start`, `/settings`, `/site`, `/buy`, `/stop` |
| `message.text` | Deep link `/start enr_...`, ответы анкеты, дневник |
| `message.photo` | Фото еды (ФТ-5) |
| `message.from.id` | `telegramId` → Client |
| `message.from.language_code` | Подсказка для timezone (roadmap 3.24) |
| `callback_query` | Inline-кнопки: оценка 1–5, настройки, анкета |
| `my_chat_member` | Блокировка/разблокировка бота |

### 6.3 Исходящие сообщения

| Метод | Назначение | Этап |
|-------|------------|------|
| [sendMessage](https://core.telegram.org/bots/api#sendmessage) | Приветствие, анкета, напоминания, рекомендации, отчёт | 2–7 |
| [sendPhoto](https://core.telegram.org/bots/api#sendphoto) | Опционально: визуализация отчёта | 7 |
| [sendChatAction](https://core.telegram.org/bots/api#sendchataction) | `typing` — UX «бот печатает» | 4 |
| [editMessageText](https://core.telegram.org/bots/api#editmessagetext) | Редактирование inline-сообщений | 3, 7 |
| [deleteMessage](https://core.telegram.org/bots/api#deletemessage) | Удаление устаревших клавиатур | опционально |

**Параметры `sendMessage` для проекта:**

| Параметр | Использование |
|----------|---------------|
| `chat_id` | `telegramId` клиента |
| `text` | Текст сообщения |
| `parse_mode` | `HTML` (MVP) |
| `reply_markup` | `InlineKeyboardMarkup` / `ReplyKeyboardMarkup` |
| `reply_parameters` | Reply на сообщение клиента |

### 6.4 Inline-кнопки

| Метод | Назначение |
|-------|------------|
| [answerCallbackQuery](https://core.telegram.org/bots/api#answercallbackquery) | Подтверждение нажатия кнопки |

**Примеры `callback_data` (≤ 64 байт):**

- `q:4:opt:2` — анкета, вопрос 4, вариант 2
- `settings:time:09:00`
- `feedback:stars:4`
- `pause:week`

### 6.5 Медиа (дневник питания)

| Метод | Назначение | Этап |
|-------|------------|------|
| [getFile](https://core.telegram.org/bots/api#getfile) | Получить `file_path` фото | 4.13 |
| Download | `https://api.telegram.org/file/bot<token>/<file_path>` | 4.13 |

> Лимит загрузки: 20 MB (official API). Для больших файлов — Local Bot API.

### 6.6 Не используются в MVP

| Метод | Причина |
|-------|---------|
| `sendPoll`, `sendDice` | Не в сценариях |
| `sendInvoice`, payments | Нет оплаты в боте |
| `sendGame`, Mini Apps | Post-MVP |
| `setChatMenuButton` | Post-MVP |

---

## 7. Поток: Admin → Telegram → Bot

```
┌─────────────┐    POST /admin/enrollments/:id/link     ┌──────────────┐
│ Admin       │ ──────────────────────────────────────►│ Admin API    │
│ (Postman/UI)│                                        │              │
└─────────────┘                                        └──────┬───────┘
       │                                                    │
       │  url: t.me/bot?start=enr_xxx                       │ INSERT EnrollmentLink
       │                                                    ▼
       │  SMS / email / лично                      ┌──────────────┐
       └──────────────────────────────────────────►│   Клиент     │
                                                   └──────┬───────┘
                                                          │ открывает ссылку
                                                          ▼
                                                   ┌──────────────┐
                                                   │   Telegram   │
                                                   │ /start enr_xxx│
                                                   └──────┬───────┘
                                                          │ webhook / getUpdates
                                                          ▼
                                                   ┌──────────────┐
                                                   │  Bot Service │
                                                   │ activate link│
                                                   │ bind telegram│
                                                   │ → onboarding │
                                                   └──────────────┘
```

---

## 8. Postman-коллекция MVP (roadmap 3.6)

1. `GET /health`
2. `POST /admin/courses` — seed курса
3. `POST /admin/clients` — клиент + enrollment
4. `POST /admin/enrollments/:id/link` — получить ссылку
5. `GET /admin/clients?linkStatus=active` — проверить в списке
6. *(вручную)* открыть ссылку в Telegram
7. `GET /admin/clients/:id` — проверить `telegramId`
8. `POST /admin/enrollments/:id/link/regenerate` — после истечения

Дополнительно для ФТ-24 (вечерняя сводка): коллекция `postman/scheduler-jobs.postman_collection.json` —
`POST {{schedulerUrl}}/internal/jobs/evening-summary` с `{ "force": true, "clientId": "..." }`;
проверка отчёта — `GET /specialist/clients/:id/reports?type=daily` (`postman/stage9-dashboards.postman_collection.json`).
Детали: `SA/evening-summary.md`.

Дополнительно для ФТ-13/14 (завершение курса / итоговый отчёт): в той же коллекции —
`POST {{schedulerUrl}}/internal/jobs/course-completion` с `{ "force": true, "clientId": "..." }`
(симуляция конца курса до `endDate`); проверка — `GET /specialist/clients/:id/reports?type=final`.
Детали: `SA/course-completion.md`.

После `completed` ссылку на тот же enrollment создать нельзя (`422 ENROLLMENT_NOT_ACTIVE`). Для повторного курса (ФТ-18):
1. `POST /admin/clients/:clientId/enrollments` `{ courseId, startDate }`
2. при необходимости `POST /admin/enrollments/:newId/link` (если telegram ещё не привязан)

В Postman: папка «После завершения — повторный курс» (`scheduler-jobs`) и «Create enrollment for existing client» (`stage9-dashboards`).

Дополнительно для ФТ-22 (ИИ-уточнения по дневнику): коллекция `postman/ai-clarity.postman_collection.json` —
`POST {{baseUrl}}/internal/ai/clarity-check` с `{ "description": "..." }`. БД не трогает, бот не нужен. Смотри поле `botReply` — это текст, который увидел бы клиент.

---

## 9. Связь с функциональными требованиями

| FR | Admin API |
|----|-----------|
| ФТ-1 | `POST .../link`, `.../regenerate`, `GET .../link`, лог attempts |
| ФТ-19 | `GET /admin/clients`, фильтры, `GET .../expired-links` |
| ФТ-2 | поле `onboarding` в ответах clients |
| ФТ-10 | `status=inactive`, `disabledReason=inactivity` |
| ФТ-24 | Scheduler: `POST /internal/jobs/evening-summary`; Specialist: `GET .../reports?type=daily` |
| ФТ-13, ФТ-14 | Scheduler: `POST /internal/jobs/course-completion`; Specialist: `GET .../reports?type=final` |
| ФТ-22 | Playground: `POST /internal/ai/clarity-check` (Postman `ai-clarity`) |
| CJM (alt) | `GET /admin/enrollments/expired-links` |

---

## 10. Открытые вопросы (post-MVP)

| # | Вопрос | Рекомендация MVP |
|---|--------|------------------|
| 1 | Часовой пояс | `language_code` + default `Europe/Moscow`; ручной выбор в `/settings` |
| 2 | Auth admin | Static token; prod — JWT + RBAC |
| 3 | Webhook vs polling | Dev: polling; prod: webhook + `secret_token` |
