// Нагрузочный тест: N клиентов одновременно создают запись в дневнике питания.
// Параметры: LOAD_TEST_CLIENTS (default 100), LOAD_TEST_CONCURRENCY (default 10).
// Требует DATABASE_URL. Не отправляет реальные сообщения в Telegram — только пишет в БД.
// Запуск: npx tsx scripts/load-test.ts

import {
  Client,
  ClientEnrollment,
  Course,
  NutritionDiary,
  closeDatabaseConnection,
  getSequelize,
  initModels,
} from '@nutrition-bot/shared';

const DEFAULT_CLIENTS = 100;
const DEFAULT_CONCURRENCY = 10;

function resolveClients(): number {
  const raw = process.env.LOAD_TEST_CLIENTS;
  if (!raw) return DEFAULT_CLIENTS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) || parsed < 1 ? DEFAULT_CLIENTS : parsed;
}

function resolveConcurrency(): number {
  const raw = process.env.LOAD_TEST_CONCURRENCY;
  if (!raw) return DEFAULT_CONCURRENCY;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) || parsed < 1 ? DEFAULT_CONCURRENCY : parsed;
}

function generatePhone(index: number): string {
  // Номера вида 70000000000 + index — достаточно уникальны для локального теста.
  return String(70000000000 + index);
}

interface LoadTestResult {
  durationMs: number;
}

async function createClientWithDiary(courseId: string, index: number): Promise<LoadTestResult> {
  const start = performance.now();
  const client = await Client.create({
    firstName: 'Load',
    lastName: `Test ${index}`,
    phone: generatePhone(index),
  });
  const enrollment = await ClientEnrollment.create({
    clientId: client.id,
    courseId,
    startDate: '2026-01-01',
    endDate: '2026-01-31',
  });
  await NutritionDiary.create({
    clientEnrollmentId: enrollment.id,
    clientId: client.id,
    description: 'Тестовая запись дневника для нагрузочного теста',
    status: 'filled',
  });
  return { durationMs: Math.round(performance.now() - start) };
}

function percentile(sorted: number[], p: number): number {
  const index = Math.ceil((sorted.length - 1) * p);
  return sorted[index] ?? 0;
}

async function main(): Promise<void> {
  const clients = resolveClients();
  const concurrency = resolveConcurrency();

  initModels(getSequelize());

  const course = await Course.create({
    name: 'Нагрузочный тест',
    durationDays: 30,
    startDate: '2026-01-01',
    endDate: '2026-01-31',
  });

  console.log(`Нагрузочный тест: ${clients} клиентов, concurrency=${concurrency}`);
  const startedAt = Date.now();
  const results: LoadTestResult[] = [];

  for (let i = 0; i < clients; i += concurrency) {
    const batchSize = Math.min(concurrency, clients - i);
    const batch = Array.from({ length: batchSize }, (_, offset) =>
      createClientWithDiary(course.id, i + offset),
    );
    const batchResults = await Promise.all(batch);
    results.push(...batchResults);
  }

  const totalMs = Date.now() - startedAt;
  const durations = results.map((r) => r.durationMs).sort((a, b) => a - b);

  console.log({
    clients,
    concurrency,
    totalMs,
    rps: Number((clients / (totalMs / 1000)).toFixed(2)),
    minMs: durations[0] ?? 0,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    maxMs: durations[durations.length - 1] ?? 0,
  });

  await closeDatabaseConnection();
}

void main().catch((err: unknown) => {
  console.error('Load test failed:', err);
  process.exit(1);
});
