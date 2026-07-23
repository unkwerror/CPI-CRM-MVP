# CPI CRM worker

Worker считает PostgreSQL единственным источником истины. Он забирает transactional
outbox через `FOR UPDATE SKIP LOCKED`, восстанавливает просроченные leases, проверяет
файлы через ClamAV `INSTREAM`, пересчитывает учитываемость версий и lifecycle авторов.

## Локальный запуск

После запуска сервисов из `infra/docker-compose.yml`:

```bash
pnpm --filter @cpi-crm/worker dev
```

Основные переменные окружения (значения по умолчанию подходят compose-файлу):

- `DATABASE_URL`
- `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`
- `S3_QUARANTINE_BUCKET`, `S3_PRIVATE_BUCKET`
- `CLAMAV_HOST`, `CLAMAV_PORT`, `CLAMAV_TIMEOUT_MS`
- `WORKER_POLL_INTERVAL_MS`, `WORKER_OUTBOX_BATCH_SIZE`, `WORKER_MAX_ATTEMPTS`
- `WORKER_LEASE_MS`, `WORKER_DUE_INTERVAL_MS`, `WORKER_RECONCILIATION_INTERVAL_MS`

На старте выполняются восстановление потерянных scan-событий, сверка отправленных
версий и полный lifecycle reconciliation. Затем due-переходы проверяются не реже
раза в час, а полная сверка повторяется раз в сутки.
