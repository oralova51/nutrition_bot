# ФТ-13/14: Завершение курса и итоговый отчёт

> Спецификация ручного теста. Связь: `Functional_Requirements.md` (ФТ-13, ФТ-14), roadmap этап 7.

## 1. Цель

Когда у клиента заканчивается `ClientEnrollment.endDate`, система:

1. Генерирует `Report` с `type=final` за весь период enrollment
2. Отправляет администратору в Telegram короткую выжимку о клиенте и краткий отчёт о питании (`ADMIN_ALERT_TELEGRAM_ID`, best-effort)
3. Отправляет форматированный итоговый отчёт в Telegram (`Message.type=report`, `category=transactional`)
4. Запрашивает оценку 1–5 (ФТ-15)
5. Предлагает продление со скидкой (ФТ-18)

Это **не** ФТ-24 (ежедневная вечерняя сводка).

## 2. Условия отбора (cron / без clientId)

| Параметр | Значение |
|----------|----------|
| Cron | `1 0 * * *` (00:01 UTC) |
| Enrollment | `status=active`, `onboardingStatus=completed`, `endDate <= сегодня` |
| Client | `telegramId` не пуст |

## 3. Содержимое отчёта

- Период, дни курса, число записей дневника
- Средняя калорийность
- % соблюдения рекомендаций
- ТОП-5 продуктов (AI: еда и напитки без простой воды; единицы вроде «грамм» не входят) и ТОП-5 проблем
- `aiSummary` — мягкое резюме (в MVP **шаблонное** на агрегатах; внешний LLM для финального резюме — post-MVP, roadmap 7.8)

## 3.1. Сводка администратору

Сразу после генерации `Report` система отправляет личное сообщение на `ADMIN_ALERT_TELEGRAM_ID` (тот же канал, что алерты доставки и `/admin`).

Содержимое — короче клиентского отчёта:

- ФИ, Telegram (`@username` / id), название курса, период
- Анкета: цель, возраст, вес, что мешает, режим питания, активность, здоровье
- Питание: заполняемость дневника, средняя калорийность, % соблюдения, топ продуктов и проблем

Если `ADMIN_ALERT_TELEGRAM_ID` не задан или Telegram недоступен — ошибка только в лог; клиент всё равно получает отчёт, оценку и предложение продления.

Для повторного курса (ФТ-18) анкета на новом enrollment не создаётся: берутся ответы последней завершённой анкеты клиента.

## 4. Ручной запуск (тест / симуляция)

Scheduler HTTP API (порт `SCHEDULER_PORT`, по умолчанию `3002`):

```http
POST /internal/jobs/course-completion
Authorization: Bearer <ADMIN_API_TOKEN>
Content-Type: application/json

{ "force": true, "clientId": "<uuid>" }
```

Поведение `force`:

- **`force=true` + `clientId`** — симуляция конца курса: завершает активный enrollment клиента **даже если `endDate` ещё в будущем**
- **`force=true` без `clientId`** — как cron: только enrollment'ы с `endDate <= сегодня`
- Без `force` — `400 FORCE_REQUIRED`

`ADMIN_API_TOKEN` — тот же, что для admin API. В Postman переменная `adminToken` = **только токен**, без слова `Bearer`.

Ответ:

```json
{
  "job": "course-completion",
  "force": true,
  "considered": 1,
  "sent": 1,
  "skipped": 0,
  "errors": 0
}
```

После успеха в Telegram клиент получает три сообщения подряд: итоговый отчёт → оценка звёздами → предложение продления.
Администратор (если задан `ADMIN_ALERT_TELEGRAM_ID`) получает отдельную короткую сводку: клиент + анкета + питание.

Повторный запуск по тому же клиенту: `considered=0` / `sent=0` (enrollment уже `completed`). Чтобы прогнать снова — нужен новый active enrollment (или сброс статуса + удаление `Report.type=final` в тестовой БД).

### Повторный / продлённый курс (ФТ-18)

Ссылка привязана к конкретному `ClientEnrollment`. После `completed` на этот enrollment нельзя вызвать `POST .../link` — будет `422 ENROLLMENT_NOT_ACTIVE` (это ожидаемо, не баг).

Порядок для повторного курса:

1. `POST /admin/clients/:clientId/enrollments` с `{ "courseId", "startDate" }` — новый enrollment (`status=active`, `onboardingStatus=completed`).
2. Опционально: `POST /admin/enrollments/:newEnrollmentId/link` — только если telegram ещё не привязан. Если клиент уже в боте, ссылка не нужна: бот найдёт его по `telegramId` и active enrollment.
3. При активации ссылки на продлённый enrollment анкета **не** запускается повторно — клиент сразу может вести дневник.

В Postman: папка «После завершения — повторный курс» в `postman/scheduler-jobs.postman_collection.json` и запрос «Create enrollment for existing client» в `postman/stage9-dashboards.postman_collection.json`.

Проверка отчёта в API: `GET /specialist/clients/:id/reports?type=final`.

## 5. Postman

Коллекция: `postman/scheduler-jobs.postman_collection.json`

- «Course completion (force, все с наступившим endDate)»
- «Course completion (force, один clientId — симуляция конца курса)»
- «После завершения — повторный курс» (новый enrollment + опциональная ссылка)

## 6. Чек-лист ручной проверки

- [ ] У тестового клиента есть active enrollment, онбординг completed, есть записи дневника
- [ ] `npm run dev:scheduler` + `npm run dev:bot` запущены
- [ ] Postman: `force=true` + `clientId` → `200`, `sent: 1`
- [ ] В Telegram пришёл итоговый отчёт с агрегатами и резюме
- [ ] Администратору (чат `ADMIN_ALERT_TELEGRAM_ID`) пришла короткая сводка о клиенте и питании
- [ ] Пришли запрос оценки и предложение продления
- [ ] `GET .../reports?type=final` возвращает созданный Report
- [ ] Повторный вызов job → `sent: 0`
