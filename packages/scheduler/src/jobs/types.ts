// Опции ручного/принудительного запуска job'ов (для Postman и локального теста).

export interface SchedulerJobOptions {
  /** Игнорировать проверку локального времени (и частоту для daily). */
  force?: boolean;
  /** Ограничить отправку одним клиентом (удобно для ручного теста). */
  clientId?: string;
}

export interface SchedulerJobResult {
  job: string;
  force: boolean;
  considered: number;
  sent: number;
  skipped: number;
  errors: number;
}
