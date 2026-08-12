# Этап 12 — Пилот

> Seed, чек-листы CJM, метрики vision §6, go/no-go. Связь: `roadmap.md` этап 12, `CJM.md`, `vision.md` §6–7.

## 1. Границы пилота

| Параметр | Значение |
|----------|----------|
| Студия | 1 (MVP-контекст; отдельной сущности Studio в ERD нет) |
| Курс | 30 дней |
| Рекомендуемый размер когорты | **10** реальных клиентов |
| Seed для локальной/стейдж проверки | 5 тестовых enrollment (`npm run db:seed:pilot`) |

## 2. Seed (12.1)

```bash
npm run db:seed:pilot
# пересоздать seed: PILOT_SEED_FORCE=1 npm run db:seed:pilot
```

Создаёт курс «Пилот: коррекция фигуры 30 дней» и клиентов:

| key | Сценарий | Назначение |
|-----|----------|------------|
| `happy` | Active enrollment + active deep link | CJM 3–4, старт happy path |
| `questionnaire` | Анкета `in_progress` (вопрос 3/10), telegram привязан | Alt: незавершённая анкета (ФТ-2) |
| `expired_link` | Ссылка `expired`, telegram не привязан | Alt: просроченная ссылка (ФТ-1/19) |
| `inactivity` | Уведомления off, `disabledReason=inactivity` | Alt: ФТ-10 / восстановление ФТ-11 |
| `user_stop` | Уведомления off, `disabledReason=user_request` | Alt: ФТ-12 `/stop` |

Скрипт печатает JSON с `courseId`, `clientId`, `enrollmentId`, deep link для `happy`.

**Реальная когорта пилота** (10 человек) создаётся через admin API (`POST /admin/clients` + `POST .../link`), не через seed.

---

## 3. Метрики и пороги (12.4, vision §6)

Сбор:

```bash
npm run pilot:metrics
# жалобы на навязчивость (ручной счётчик):
PILOT_NAGGING_COMPLAINTS=1 npm run pilot:metrics
```

| Метрика | Как считается | Порог |
|---------|---------------|-------|
| Доля клиентов с регулярным дневником | % клиентов с `onboarding=completed` и `status∈{active,completed}`, у которых fillRate ≥ 50% прошедших дней enrollment | **≥ 50%** |
| Соблюдение рекомендаций | `applied / total` по `Recommendation` | **≥ 50%** |
| Продления | `RenewalOffer.status=converted` / число `ClientEnrollment.status=completed` | **≥ 50%** |
| Средняя оценка курса | avg `Feedback.rating` где `source=course_final` | **≥ 4.0** |
| Досрочные отключения | клиенты с `NotificationSettings.enabled=false` и `disabledReason∈{user_request,inactivity}` / клиенты с `telegramId` | **≤ 20%** |
| Жалобы на навязчивость | ручной счётчик `PILOT_NAGGING_COMPLAINTS` (обращения к админу / комментарии про «спам», «надоело») | **≤ 2** за цикл |

Если по метрике ещё нет данных (нет completed enrollments, нет feedback и т.п.) — скрипт ставит `pass: null` и вердикт `PENDING`.

Seed-клиенты (`7900120*` / фамилия `Пилот-*`) **исключаются** из расчёта, чтобы тестовые сценарии не портили вердикт.

Контрольная группа «без бота» из vision (сравнение adherence/renewal) в MVP **не автоматизирована**: при go/no-go админ сравнивает вручную с офлайн-статистикой студии, если она есть.

---

## 4. Чек-лист happy path (12.2) — CJM шаги 3–12

Предусловия: `npm run db:migrate`, задан `ENCRYPTION_KEY` (этап 11), сервисы `api` / `bot` / `scheduler`, seed или реальный клиент с active ссылкой.

### CJM 3 — Админ готовит подключение (ФТ-1)

- [ ] `POST /admin/courses` (или seed) — курс 30 дней
- [ ] `POST /admin/clients` — клиент + enrollment
- [ ] `POST /admin/enrollments/:id/link` — deep link
- [ ] `GET /admin/clients/:id` — linkStatus=active, hasTelegram=false

### CJM 4–5 — Вступление в бот и доступ (ФТ-1, ФТ-2)

- [ ] Клиент открывает deep link → `/start enr_…`
- [ ] Telegram привязан, welcome / старт онбординга
- [ ] Ссылка `status=used`; повторный переход не ломает enrollment

### CJM 6 — Анкета (ФТ-2)

- [ ] Ответы сохраняются после каждого вопроса
- [ ] Можно пройти все 10 вопросов
- [ ] После анкеты — настройка уведомлений (ФТ-3), `onboardingStatus=completed`

### CJM 7 — Напоминания о дневнике (ФТ-4)

- [ ] В `reminderTime` клиента приходит напоминание (или `POST /internal/jobs/daily-reminder` с `force=true`)
- [ ] `Message.type=reminder` в БД / доставка в Telegram

### CJM 8 — Ввод данных (ФТ-5)

- [ ] Текст рациона сохраняется в `NutritionDiary` (`status=filled`)
- [ ] Клиент получает подтверждение (AI-анализ не блокирует ответ)

### CJM 9 — Рекомендации (ФТ-7)

- [ ] Мягкая рекомендация в Telegram
- [ ] `Recommendation` + `Message.type=recommendation`
- [ ] Не более 2–3 рекомендаций в день

### CJM 9a — Evening summary (ФТ-24)

- [ ] `POST /internal/jobs/evening-summary` `{ "force": true, "clientId" }` → сводка
- [ ] `Report.type=daily`, `Message.type=evening_summary`

### CJM 10 — Итоговый отчёт (ФТ-13/14)

- [ ] `POST /internal/jobs/course-completion` `{ "force": true, "clientId" }`
- [ ] `Report.type=final`, enrollment → `completed`
- [ ] В Telegram пришёл итоговый отчёт

### CJM 11 — Оценка курса (ФТ-15)

- [ ] Запрос оценки 1–5
- [ ] `Feedback` с `source=course_final`

### CJM 12 — Предложение продления (ФТ-18)

- [ ] Сообщение со скидкой 15%
- [ ] `RenewalOffer.status=sent` (далее clicked/converted/dismissed по действию клиента)

Шаг CJM 13 (офлайн-продление / уход) — вне автоматизации бота; для converted: новый enrollment через `POST /admin/clients/:id/enrollments`.

---

## 5. Чек-лист альтернативных веток (12.3)

### Просроченная ссылка (7 дней)

- [ ] Seed `expired_link` или дождаться expiresAt
- [ ] `GET /admin/enrollments/expired-links` видит клиента
- [ ] `POST .../link/regenerate` → новая active ссылка
- [ ] Активация новой ссылки успешна

### Незавершённая анкета

- [ ] Seed `questionnaire` или остановить анкету на середине
- [ ] Через N ч (def 24) — мягкое напоминание «остановились на вопросе X» (или форс job/ручная проверка сервиса)
- [ ] Возврат клиента продолжает с того же вопроса
- [ ] Admin: `onboardingStatus=in_progress` в `GET /admin/clients`

### Оценка 1–3 (ФТ-16)

- [ ] После course-completion выбрать 1–3 ★
- [ ] Бот запрашивает комментарий
- [ ] Админ получает уведомление / запись в `GET /admin/feedback/critical`

### Оценка 4–5 (ФТ-17)

- [ ] Выбрать 4–5 ★
- [ ] Благодарность + ссылки 2Gis/Яндекс (бонус прессотерапия)

### Неактивность 48 ч / 72+ ч (ФТ-9..11)

- [ ] Seed `inactivity` или симуляция молчания
- [ ] Предупреждение → автоотключение (`disabledReason=inactivity`)
- [ ] Любое сообщение клиента → восстановление уведомлений (ФТ-11)

### Добровольный /stop|/pause (ФТ-12)

- [ ] Seed `user_stop` или команда `/stop`
- [ ] `disabledReason=user_request` (отличается от inactivity)
- [ ] Transactional сообщения (итоговый отчёт, feedback) не блокируются

### Молчание без /stop (частый исход)

- [ ] Клиент не отвечает на предупреждения → автоотключение по ФТ-10
- [ ] В метриках учитывается в early opt-out

---

## 6. Go / No-Go (12.5)

Заполняется **после** полного цикла курса реальной когорты (~10 клиентов, 30 дней).

### Шаблон решения

| Поле | Значение |
|------|----------|
| Дата решения | |
| Курс / период | |
| Размер когорты (факт) | / 10 |
| `npm run pilot:metrics` → decision | GO / PENDING / NO-GO |
| diary_daily_share | факт ___% (порог ≥ 50%) |
| recommendation_adherence | факт ___% (порог ≥ 50%) |
| renewal_rate | факт ___% (порог ≥ 50%) |
| avg_course_feedback | факт ___ (порог ≥ 4.0) |
| early_opt_out | факт ___% (порог ≤ 20%) |
| nagging_complaints | факт ___ (порог ≤ 2) |
| Жалобы / инциденты (кратко) | |
| Сравнение с офлайн-группой (если есть) | |
| **Решение** | ☐ GO — масштабировать · ☐ NO-GO — доработать · ☐ условный GO (что исправить до масштаба) |
| Ответственный | |
| Следующие шаги | |

**Критерий GO (vision §7):** все пороги §3 не хуже целевых **и** жалоб на навязчивость ≤ 2.

Скрипт метрик даёт черновой вердикт; финальное решение фиксируется в этой таблице (подпись ответственного).

---

## 7. Быстрый порядок прогона

1. `npm run db:migrate`
2. `npm run db:seed:pilot`
3. Поднять `dev:api`, `dev:bot`, `dev:scheduler`
4. Пройти §4 по клиенту `happy` (+ force jobs из Postman `scheduler-jobs`)
5. Пройти §5 по seed-сценариям
6. Для реальной когорты — admin API на 10 клиентов, 30 дней курса
7. В конце цикла: `PILOT_NAGGING_COMPLAINTS=N npm run pilot:metrics` → заполнить §6
