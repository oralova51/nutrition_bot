# Этап 9. Панели управления — руководство по ручной проверке

> Для кого: администратор, разработчик, тестировщик.  
> Цель: понять, что входит в этап 9, какие API-методы уже работают, какие нужно реализовать, и как проверить каждый из них вручную через Postman.

---

## 1. Что такое этап 9

Этап 9 — это панели управления для двух ролей:

- **9A. Администратор** (ФТ-19) — управляет клиентами, ссылками, смотрит статистику и обратную связь.
- **9B. Специалист** (ФТ-20) — смотрит прогресс и соблюдение рекомендаций своих клиентов.

В этом документе описаны все endpoints, которые нужны для этих панелей. Часть уже реализована в коде, часть пока только описана контрактом.

---

## 2. Статус реализации

| Подэтап | Описание | Статус | Endpoint |
|---------|----------|--------|----------|
| 9.1 | Auth для admin API | ✓ MVP (Bearer) | `Authorization: Bearer <ADMIN_API_TOKEN>` |
| 9.2 | Список клиентов: active / inactive | ✓ Реализовано | `GET /api/v1/admin/clients` |
| 9.3 | Генерация ссылки из UI | ✓ Реализовано | `POST /api/v1/admin/enrollments/:id/link` |
| 9.4 | Просмотр дневника (анонимизированно) | ✓ Реализовано | `GET /api/v1/admin/enrollments/:id/diary` |
| 9.5 | Статистика соблюдения рекомендаций | ✓ Реализовано | `GET /api/v1/admin/statistics/recommendations` |
| 9.6 | Inbox критической обратной связи (1–3 звезды) | ✓ Реализовано | `GET /api/v1/admin/feedback/critical` |
| 9.7 | Список клиентов с предложением продления | ✓ Реализовано | `GET /api/v1/admin/renewal-offers` |
| 9.8 | Экспорт CSV/Excel | ✓ Реализовано (CSV) | `GET /api/v1/admin/export/clients` |
| 9.9 | Статус недоставленных сообщений | ✓ Реализовано | `GET /api/v1/admin/messages/failed` |
| 9.10 | Ссылки с истёкшим сроком (CJM) | ✓ Реализовано | `GET /api/v1/admin/enrollments/expired-links` |
| 9.11 | Auth + привязка специалиста к клиентам | ⏳ Не реализовано | MVP: тот же Bearer, post-MVP — JWT/RBAC |
| 9.12 | Просмотр итогового Report своих клиентов | ✓ Реализовано | `GET /api/v1/specialist/clients/:id/reports` |
| 9.13 | % соблюдения рекомендаций | ✓ Реализовано | `GET /api/v1/specialist/clients/:id/compliance` |
| 9.14 | ТОП проблем в питании | ✓ Реализовано | `GET /api/v1/specialist/statistics/problems` |
| 9.15 | Статистика активности (заполнение дневника) | ✓ Реализовано | `GET /api/v1/specialist/statistics/activity` |
| 9.16 | Просмотр Feedback (read-only) | ✓ Реализовано | `GET /api/v1/specialist/clients/:id/feedback` |

✓ — код уже в репозитории и отвечает на запросы.  
⏳ — контракт описан в этом документе, но endpoint пока вернёт `404`.

---

## 3. Как запустить API локально

1. Убедиться, что в `.env` заданы:
   - `ADMIN_API_TOKEN` — токен для заголовка `Authorization: Bearer ...`
   - `BOT_USERNAME` — username бота без `@` (нужен для построения deep link)
   - `DATABASE_URL` — подключение к PostgreSQL (Supabase)
   - `PORT` — порт API (по умолчанию 3000)

2. Запустить API-сервис:
   ```bash
   npm run dev:api
   ```

3. Проверить, что сервер живой:
   ```bash
   curl http://localhost:3000/api/v1/health
   ```

Базовый URL для всех запросов: `http://localhost:3000/api/v1`.

---

## 4. Общие правила запросов

### 4.1 Авторизация

Все admin/specialist endpoints требуют заголовок:

```http
Authorization: Bearer <ADMIN_API_TOKEN>
```

MVP используется один токен для администратора и специалиста. В post-MVP для специалиста добавится отдельная роль.

### 4.2 Формат ответа

Успешные ответы — JSON с кодом `200` или `201`.

Ошибка всегда в формате:

```json
{
  "error": {
    "code": "ENROLLMENT_NOT_FOUND",
    "message": "Описание ошибки",
    "details": {}
  }
}
```

### 4.3 Пагинация

В списках используются параметры:

- `page` — номер страницы, начинается с 1 (по умолчанию 1)
- `limit` — сколько записей на странице, по умолчанию 20, максимум 100

Ответ всегда содержит блок:

```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "totalPages": 3
  }
}
```

### 4.4 Даты

Все даты передаются в формате ISO 8601 UTC, например `2026-08-06T12:00:00Z`. В теле запросов для создания курсов/enrollments используется формат `YYYY-MM-DD` (например, `2026-08-06`).

### 4.5 UUID

Все идентификаторы — UUID v4. Их нужно сохранять из ответов и подставлять в следующие запросы.

---

## 5. 9A. Админ-панель

### 5.1 9.2 — Список клиентов

**Endpoint:** `GET /api/v1/admin/clients`

**Назначение:** главный экран админки. Показывает клиентов с фильтрами и пагинацией. В списке — инициалы (для защиты персональных данных), полное ФИ — только в деталях.

**Query-параметры:**

| Параметр | Возможные значения | Описание |
|----------|-------------------|----------|
| `status` | `active`, `inactive`, `all` | Статус клиента по выведенному правилу |
| `enrollmentStatus` | `active`, `paused`, `completed`, `cancelled` | Статус текущего enrollment |
| `onboardingStatus` | `pending`, `in_progress`, `settings_pending`, `completed` | Статус онбординга |
| `hasTelegram` | `true`, `false` | Привязан ли Telegram |
| `linkStatus` | `no_link`, `active`, `expired`, `used` | Статус последней ссылки |
| `sort` | `registeredAt`, `lastInteractionAt`, `enrollmentEndDate` | Поле сортировки |
| `order` | `asc`, `desc` | Порядок |
| `page`, `limit` | числа | Пагинация |

**Правило `status`:**
- `active` = есть `telegramId` + уведомления включены + enrollment `active`
- `inactive` = всё остальное (нет Telegram, уведомления выключены, enrollment не active)

**Пример ответа:**

```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "displayName": "Анна И.",
      "telegramId": 123456789,
      "telegramUsername": "anna_i",
      "enrollment": {
        "id": "550e8400-e29b-41d4-a716-446655440001",
        "courseName": "Курс коррекции фигуры 30 дней",
        "status": "active",
        "startDate": "2026-07-07",
        "endDate": "2026-08-06"
      },
      "onboarding": {
        "status": "completed",
        "currentQuestion": null,
        "totalQuestions": null,
        "lastAnswerAt": null
      },
      "notifications": {
        "enabled": true,
        "disabledReason": null
      },
      "link": {
        "status": "used",
        "expiresAt": "2026-07-14T10:00:00Z",
        "url": "https://t.me/nutrition_studio_bot?start=enr_a1b2c3d4e5f6g7h8"
      },
      "lastInteractionAt": "2026-08-05T18:00:00Z",
      "registeredAt": "2026-07-07T10:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

**Как проверить:**
1. Создать клиента через `POST /admin/clients`.
2. Вызвать `GET /admin/clients` без фильтров — увидеть нового клиента.
3. Применить фильтр `?status=inactive` — увидеть клиента, у которого ещё нет Telegram.
4. Применить `?linkStatus=no_link` — увидеть клиента без ссылки.

---

### 5.2 9.3 — Генерация ссылки

**Endpoint:** `POST /api/v1/admin/enrollments/:enrollmentId/link`

**Назначение:** админ создаёт ссылку для клиента, чтобы тот мог подключиться в Telegram.

**Тело запроса (опционально):**

```json
{
  "force": false
}
```

- `force: true` — отозвать текущую активную ссылку и создать новую.

**Пример ответа (201):**

```json
{
  "link": {
    "id": "550e8400-e29b-41d4-a716-446655440002",
    "code": "enr_a1b2c3d4e5f6g7h8",
    "url": "https://t.me/nutrition_studio_bot?start=enr_a1b2c3d4e5f6g7h8",
    "enrollmentId": "550e8400-e29b-41d4-a716-446655440001",
    "status": "active",
    "createdAt": "2026-08-06T10:00:00Z",
    "expiresAt": "2026-08-13T10:00:00Z",
    "usedAt": null
  }
}
```

**Ошибки:**
- `404 ENROLLMENT_NOT_FOUND` — enrollment не найден.
- `422 ENROLLMENT_NOT_ACTIVE` — enrollment не активен.
- `409 ACTIVE_LINK_EXISTS` — уже есть активная ссылка, а `force` не передан.

**Как проверить:**
1. Создать клиента.
2. Вызвать `POST /admin/enrollments/:enrollmentId/link` — получить ссылку.
3. Повторить вызов без `force` — получить `409 ACTIVE_LINK_EXISTS`.
4. Повторить с `{"force": true}` — получить новую ссылку, старая станет `revoked`.

---

### 5.3 9.4 — Просмотр дневника (анонимизированно)

**Endpoint:** `GET /api/v1/admin/enrollments/:enrollmentId/diary`

**Статус:** ✓ реализовано.

**Назначение:** админ видит записи дневника питания без имени клиента. Используется для понимания общих паттернов, а не для контроля конкретного человека.

**Query-параметры:**

| Параметр | Описание |
|----------|----------|
| `from` | Дата начала `YYYY-MM-DD` |
| `to` | Дата конца `YYYY-MM-DD` |
| `status` | `filled`, `pending`, `needs_clarification` |
| `page`, `limit` | Пагинация |

**Пример ответа:**

```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440003",
      "mealAt": "2026-08-05T12:30:00Z",
      "description": "Каша овсяная с ягодами, кофе",
      "approxCalories": 350,
      "hasPhoto": true,
      "photoRef": null,
      "status": "filled"
    }
  ],
  "pagination": { ... }
}
```

> В ответе нет полей `clientId`, `firstName`, `lastName` — только содержимое записи. Это соответствует требованию «анонимизированно».

**Ошибки:**
- `404 ENROLLMENT_NOT_FOUND`

**Как проверить после реализации:**
1. Создать клиента и подключить его к Telegram (через бота/ссылку).
2. Отправить в бот текст еды или фото.
3. Вызвать `GET /admin/enrollments/:enrollmentId/diary` — увидеть записи без имени клиента.

---

### 5.4 9.5 — Статистика соблюдения рекомендаций

**Endpoint:** `GET /api/v1/admin/statistics/recommendations`

**Статус:** ✓ реализовано.

**Назначение:** показать, какой процент рекомендаций клиенты применяют, а какие отклоняют. Помогает оценить эффективность программы.

**Query-параметры:**

| Параметр | Описание |
|----------|----------|
| `courseId` | Фильтр по курсу (опционально) |
| `from`, `to` | Период `YYYY-MM-DD` |

**Пример ответа:**

```json
{
  "total": 120,
  "byStatus": {
    "sent": 10,
    "read": 30,
    "applied": 65,
    "dismissed": 15
  },
  "adherencePercent": 54,
  "byPriority": {
    "critical": { "total": 12, "applied": 10 },
    "high": { "total": 40, "applied": 25 },
    "medium": { "total": 50, "applied": 25 },
    "low": { "total": 18, "applied": 5 }
  }
}
```

`adherencePercent` — доля рекомендаций со статусом `applied` от общего числа отправленных рекомендаций.

**Как проверить после реализации:**
1. Убедиться, что в таблице `recommendations` есть записи с разными статусами.
2. Вызвать endpoint — проверить, что числа считаются корректно.
3. Проверить, что сумма `byStatus` равна `total`.

---

### 5.5 9.6 — Inbox критической обратной связи (1–3 звезды)

**Endpoint:** `GET /api/v1/admin/feedback/critical`

**Статус:** ✓ реализовано.

**Назначение:** оперативно показать администратору негативный feedback (оценка 1–3), чтобы он мог связаться с клиентом. Ответы с 4–5 звёздами здесь не показываются.

**Query-параметры:**

| Параметр | Описание |
|----------|----------|
| `unresolvedOnly` | `true` — только feedback без ответа администратора (опционально) |
| `page`, `limit` | Пагинация |

**Пример ответа:**

```json
{
  "data": [
    {
      "feedbackId": "550e8400-e29b-41d4-a716-446655440004",
      "clientDisplayName": "Марина К.",
      "clientId": "550e8400-e29b-41d4-a716-446655440000",
      "enrollmentId": "550e8400-e29b-41d4-a716-446655440001",
      "rating": 2,
      "comment": "Рекомендации слишком общие, не учитывают мой график",
      "source": "recommendation",
      "createdAt": "2026-08-05T09:00:00Z",
      "isResolved": false
    }
  ],
  "pagination": { ... }
}
```

**Как проверить после реализации:**
1. Создать feedback с рейтингом 2 и 5 через бот или напрямую в БД.
2. Вызвать endpoint — убедиться, что виден только feedback с 2.
3. Проверить `?unresolvedOnly=true` — скрываются разрешённые записи.

---

### 5.6 9.7 — Список клиентов с предложением продления

**Endpoint:** `GET /api/v1/admin/renewal-offers`

**Статус:** ✓ реализовано.

**Назначение:** показать все предложения продлить курс, их статус и конверсию. Источник данных — таблица `renewal_offers`.

**Query-параметры:**

| Параметр | Описание |
|----------|----------|
| `status` | `sent`, `clicked`, `converted`, `dismissed` |
| `page`, `limit` | Пагинация |

**Пример ответа:**

```json
{
  "data": [
    {
      "offerId": "550e8400-e29b-41d4-a716-446655440005",
      "clientDisplayName": "Анна И.",
      "clientId": "550e8400-e29b-41d4-a716-446655440000",
      "enrollmentId": "550e8400-e29b-41d4-a716-446655440001",
      "status": "converted",
      "basePrice": 15000,
      "discountPercent": 15,
      "finalPrice": 12750,
      "offeredAt": "2026-08-06T10:00:00Z",
      "clickedAt": "2026-08-06T11:00:00Z"
    }
  ],
  "pagination": { ... },
  "summary": {
    "sent": 10,
    "clicked": 4,
    "converted": 3,
    "dismissed": 3,
    "conversionPercent": 30
  }
}
```

Цены передаются в копейках (15000 = 150 ₽). Здесь для примера использованы условные значения; реальные цены зависят от настройки студии.

**Как проверить после реализации:**
1. Завершить курс клиенту (чтобы создалось предложение продления, этап 8).
2. Вызвать endpoint — убедиться, что предложение есть.
3. Проверить фильтры по статусам.

---

### 5.7 9.8 — Экспорт CSV/Excel

**Endpoint:** `GET /api/v1/admin/export/clients`

**Статус:** ✓ реализовано (CSV). XLSX — post-MVP.

**Назначение:** выгрузить список клиентов в файл для Excel или Google Таблиц. В MVP — CSV, так как не требует дополнительных библиотек.

**Query-параметры:**

| Параметр | Описание |
|----------|----------|
| `format` | `csv` (по умолчанию), `xlsx` — post-MVP |
| `status` | `active`, `inactive`, `all` |
| `enrollmentStatus` | фильтр по enrollment |
| `onboardingStatus` | фильтр по онбордингу |

**Ответ:** файл с заголовком `Content-Type: text/csv; charset=utf-8` и `Content-Disposition: attachment; filename="clients-2026-08-06.csv"`.

**Пример строк CSV:**

```csv
clientId,displayName,enrollmentStatus,onboardingStatus,notificationsEnabled,linkStatus,lastInteractionAt,registeredAt
550e8400-e29b-41d4-a716-446655440000,"Анна И.",active,completed,true,used,2026-08-05T18:00:00Z,2026-07-07T10:00:00Z
```

**Как проверить после реализации:**
1. Вызвать `GET /admin/export/clients?format=csv`.
2. Сохранить файл, открыть в Excel/Google Таблицах.
3. Проверить, что кодировка UTF-8 и разделитель — запятая.

---

### 5.8 9.9 — Статус недоставленных сообщений

**Endpoint:** `GET /api/v1/admin/messages/failed`

**Статус:** ✓ реализовано.

**Назначение:** показать сообщения, которые не удалось доставить в Telegram (`deliveryStatus = delivery_failed`). Используется для мониторинга сбоев и ручного дообращения к клиенту.

**Query-параметры:**

| Параметр | Описание |
|----------|----------|
| `exhaustedRetries` | `true` — только те, что исчерпали все retry (по умолчанию 3) |
| `page`, `limit` | Пагинация |

**Пример ответа:**

```json
{
  "data": [
    {
      "messageId": "550e8400-e29b-41d4-a716-446655440006",
      "clientDisplayName": "Анна И.",
      "clientId": "550e8400-e29b-41d4-a716-446655440000",
      "type": "recommendation",
      "content": "Попробуйте добавить белок на завтрак",
      "deliveryStatus": "delivery_failed",
      "retryCount": 3,
      "createdAt": "2026-08-05T10:00:00Z"
    }
  ],
  "pagination": { ... }
}
```

**Как проверить после реализации:**
1. Создать в БД сообщение со статусом `delivery_failed` и `retryCount = 3`.
2. Вызвать endpoint — убедиться, что оно попало в список.
3. Проверить `?exhaustedRetries=true` — показываются только исчерпавшие retry.

---

### 5.9 9.10 — Ссылки с истёкшим сроком

**Endpoint:** `GET /api/v1/admin/enrollments/expired-links`

**Статус:** ✓ реализовано.

**Назначение:** показать клиентов, у которых ссылка истекла, а Telegram ещё не привязан. Админ видит, кому нужно сгенерировать новую ссылку (CJM, альтернативная ветка).

**Query-параметры:** `page`, `limit`.

**Пример ответа:**

```json
{
  "data": [
    {
      "enrollmentId": "550e8400-e29b-41d4-a716-446655440001",
      "clientDisplayName": "Марина К.",
      "linkExpiredAt": "2026-07-01T10:00:00Z",
      "daysSinceExpiry": 6
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1
  }
}
```

**Как проверить:**
1. Создать клиента и сгенерировать ссылку.
2. Дождаться истечения 7 дней либо вручную поменять `expiresAt` в БД на прошедшую дату и статус на `expired`.
3. Убедиться, что у клиента `telegramId = null`.
4. Вызвать endpoint — клиент должен появиться в списке.

---

## 6. 9B. Панель специалиста

Все specialist endpoints используют тот же `Authorization: Bearer <ADMIN_API_TOKEN>`, пока не реализована отдельная ролевая модель (9.11). Post-MVP специалист получит JWT с ролью `specialist` и увидит только своих клиентов.

### 6.1 9.12 — Просмотр итогового Report

**Endpoint:** `GET /api/v1/specialist/clients/:clientId/reports`

**Статус:** ✓ реализовано.

**Назначение:** специалист видит итоговые отчёты по клиенту за разные периоды (weekly, monthly, final).

**Query-параметры:**

| Параметр | Описание |
|----------|----------|
| `type` | `weekly`, `monthly`, `final` |
| `page`, `limit` | Пагинация |

**Пример ответа:**

```json
{
  "data": [
    {
      "reportId": "550e8400-e29b-41d4-a716-446655440007",
      "enrollmentId": "550e8400-e29b-41d4-a716-446655440001",
      "type": "final",
      "periodStart": "2026-07-07",
      "periodEnd": "2026-08-06",
      "adherencePercent": 72,
      "diaryStats": {
        "totalRecords": 28,
        "filledEntries": 24,
        "pendingEntries": 4,
        "avgCalories": 1650
      },
      "problemAreas": [
        { "area": "Перекусы вечером", "count": 5 },
        { "area": "Недостаток белка", "count": 3 }
      ],
      "dynamics": {
        "adherenceTrend": "stable"
      },
      "aiSummary": "Клиентка стабильно заполняет дневник, основная проблема — вечерние перекусы."
    }
  ],
  "pagination": { ... }
}
```

**Ошибки:**
- `404 CLIENT_NOT_FOUND`

**Как проверить после реализации:**
1. Завершить курс клиенту, чтобы создался final report (этап 7).
2. Вызвать endpoint — отчёт должен вернуться.

---

### 6.2 9.13 — % соблюдения рекомендаций

**Endpoint:** `GET /api/v1/specialist/clients/:clientId/compliance`

**Статус:** ✓ реализовано.

**Назначение:** показать, какой процент рекомендаций клиент применил за текущий enrollment.

**Пример ответа:**

```json
{
  "clientId": "550e8400-e29b-41d4-a716-446655440000",
  "enrollmentId": "550e8400-e29b-41d4-a716-446655440001",
  "totalRecommendations": 45,
  "applied": 28,
  "read": 10,
  "dismissed": 7,
  "adherencePercent": 62
}
```

**Как проверить после реализации:**
1. Создать несколько рекомендаций с разными статусами для одного клиента.
2. Вызвать endpoint — процент должен считаться как `applied / total * 100`.

---

### 6.3 9.14 — ТОП проблем в питании

**Endpoint:** `GET /api/v1/specialist/statistics/problems`

**Статус:** ✓ реализовано.

**Назначение:** агрегировать проблемы из отчётов (поле `problemAreas`) по всем клиентам специалиста. Помогает понять, на чём сфокусировать групповые рекомендации.

**Query-параметры:**

| Параметр | Описание |
|----------|----------|
| `from`, `to` | Период `YYYY-MM-DD` |
| `limit` | Сколько проблем в топе (по умолчанию 10) |

**Пример ответа:**

```json
{
  "period": { "from": "2026-07-01", "to": "2026-08-06" },
  "topProblems": [
    { "area": "Перекусы вечером", "count": 18, "percentOfClients": 60 },
    { "area": "Недостаток белка", "count": 12, "percentOfClients": 40 },
    { "area": "Мало овощей", "count": 8, "percentOfClients": 27 }
  ],
  "totalClients": 30
}
```

**Как проверить после реализации:**
1. Создать отчёты с разными `problemAreas` для нескольких клиентов.
2. Вызвать endpoint — убедиться, что проблемы отсортированы по убыванию count.

---

### 6.4 9.15 — Статистика активности

**Endpoint:** `GET /api/v1/specialist/statistics/activity`

**Статус:** ✓ реализовано.

**Назначение:** показать, как часто клиенты заполняют дневник. Используется для выявления клиентов, которые отваливаются.

**Query-параметры:**

| Параметр | Описание |
|----------|----------|
| `from`, `to` | Период `YYYY-MM-DD` |
| `minFillRate` | Минимальный процент заполнения, чтобы попасть в список (например, `50`) |

**Пример ответа:**

```json
{
  "period": { "from": "2026-07-01", "to": "2026-08-06" },
  "clients": [
    {
      "clientId": "550e8400-e29b-41d4-a716-446655440000",
      "clientDisplayName": "Анна И.",
      "enrollmentId": "550e8400-e29b-41d4-a716-446655440001",
      "totalDays": 30,
      "filledDays": 24,
      "fillRatePercent": 80,
      "lastEntryAt": "2026-08-05T18:00:00Z"
    }
  ],
  "averageFillRate": 65
}
```

**Как проверить после реализации:**
1. Создать записи дневника за разные даты.
2. Вызвать endpoint — проверить, что `fillRatePercent` считается правильно.
3. Проверить `?minFillRate=80` — видны только активные клиенты.

---

### 6.5 9.16 — Просмотр Feedback (read-only)

**Endpoint:** `GET /api/v1/specialist/clients/:clientId/feedback`

**Статус:** ✓ реализовано.

**Назначение:** специалист читает feedback клиента о рекомендациях или курсе, но не может его редактировать.

**Query-параметры:** `page`, `limit`.

**Пример ответа:**

```json
{
  "data": [
    {
      "feedbackId": "550e8400-e29b-41d4-a716-446655440008",
      "rating": 5,
      "comment": "Совет по завтраку очень помог",
      "source": "recommendation",
      "isApplied": true,
      "createdAt": "2026-08-04T10:00:00Z"
    }
  ],
  "pagination": { ... }
}
```

**Как проверить после реализации:**
1. Создать feedback для клиента.
2. Вызвать endpoint — feedback должен вернуться.
3. Проверить, что `POST/PUT/PATCH/DELETE` на этот путь не существует (read-only).

---

## 7. Чек-лист ручной проверки этапа 9

### Реализованные endpoints (можно проверить сейчас)

- [ ] `GET /api/v1/health` — сервер отвечает `status: ok`.
- [ ] `POST /api/v1/admin/courses` — создаётся курс.
- [ ] `POST /api/v1/admin/clients` — создаётся клиент + enrollment.
- [ ] `GET /api/v1/admin/clients` — список без фильтров работает.
- [ ] `GET /api/v1/admin/clients?status=inactive` — фильтр по статусу работает.
- [ ] `GET /api/v1/admin/clients?linkStatus=no_link` — фильтр по ссылке работает.
- [ ] `GET /api/v1/admin/clients/:clientId` — детали клиента показывают полное ФИ.
- [ ] `POST /api/v1/admin/enrollments/:enrollmentId/link` — генерируется ссылка.
- [ ] `POST /api/v1/admin/enrollments/:enrollmentId/link` без `force` — повторный вызов даёт `409`.
- [ ] `POST /api/v1/admin/enrollments/:enrollmentId/link` с `force:true` — старая ссылка отзывается, создаётся новая.
- [ ] `GET /api/v1/admin/enrollments/:enrollmentId/link` — показывает активную ссылку и историю.
- [ ] `DELETE /api/v1/admin/enrollments/:enrollmentId/link/:linkId` — активная ссылка отзывается.
- [ ] `GET /api/v1/admin/enrollments/expired-links` — клиенты с просроченными ссылками попадают в список.
- [ ] Без заголовка `Authorization` — все admin endpoints возвращают `401`.
- [ ] С неверным токеном — все admin endpoints возвращают `401`.

### Реализованные endpoints (проверить после подготовки тестовых данных)

- [ ] `GET /api/v1/admin/enrollments/:enrollmentId/diary` — возвращает дневник без имени клиента.
- [ ] `GET /api/v1/admin/statistics/recommendations` — считает соблюдение рекомендаций.
- [ ] `GET /api/v1/admin/feedback/critical` — возвращает feedback 1–3 звёзд.
- [ ] `GET /api/v1/admin/renewal-offers` — возвращает предложения продления.
- [ ] `GET /api/v1/admin/export/clients?format=csv` — выгружает CSV.
- [ ] `GET /api/v1/admin/messages/failed` — возвращает недоставленные сообщения.
- [ ] `GET /api/v1/specialist/clients/:clientId/reports` — возвращает отчёты.
- [ ] `GET /api/v1/specialist/clients/:clientId/compliance` — считает % соблюдения.
- [ ] `GET /api/v1/specialist/statistics/problems` — возвращает топ проблем.
- [ ] `GET /api/v1/specialist/statistics/activity` — возвращает статистику активности.
- [ ] `GET /api/v1/specialist/clients/:clientId/feedback` — возвращает feedback read-only.

---

## 8. Подготовка тестовых данных

### Минимальный сценарий

1. Создать курс:
   ```json
   POST /api/v1/admin/courses
   {
     "name": "Тестовый курс 30 дней",
     "durationDays": 30,
     "startDate": "2026-08-01"
   }
   ```

2. Создать клиента:
   ```json
   POST /api/v1/admin/clients
   {
     "firstName": "Анна",
     "lastName": "Иванова",
     "email": "anna.test@example.com",
     "courseId": "<course-id>",
     "enrollmentStartDate": "2026-08-01"
   }
   ```

3. Сохранить `clientId` и `enrollmentId` из ответа.

4. Сгенерировать ссылку:
   ```json
   POST /api/v1/admin/enrollments/<enrollment-id>/link
   ```

5. Скопировать ссылку `url` и открыть её в Telegram (или сымитировать через internal endpoint `/api/v1/internal/enrollment-links/activate`).

6. После подключения клиента к Telegram проверить:
   - `GET /api/v1/admin/clients?hasTelegram=true` — клиент виден.
   - `GET /api/v1/admin/enrollments/<enrollment-id>` — `telegramLinked: true`.

---

## 9. Связь с другими документами

- `adminAPI.md` — базовый контракт admin API (health, курсы, клиенты, ссылки).
- `Functional_Requirements.md` — ФТ-19 и ФТ-20.
- `CJM.md` — альтернативная ветка с просроченной ссылкой, которую закрывает endpoint 9.10.
- `roadmap.md` — этап 9 в индексе этапов.
