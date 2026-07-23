# Развёртывание ЦПИ CRM на одном сервере

Этот контур предназначен для Ubuntu-сервера с 2 CPU, 4 ГБ RAM и публичными портами 80/443. Локальный `infra/docker-compose.yml` не изменяется.

Публичны только два адреса:

- `https://crm.62-113-105-225.sslip.io` — CRM;
- `https://id.62-113-105-225.sslip.io` — Keycloak.
- `https://files.62-113-105-225.sslip.io` — только подписанные S3-запросы загрузки/скачивания.

PostgreSQL, консоль MinIO, ClamAV, API и worker доступны только во внутренних Docker-сетях. API и worker работают под отдельными непривилегированными учётными записями PostgreSQL и MinIO; owner/root используются только одноразовыми сервисами миграции и инициализации. Caddy автоматически получает и обновляет TLS-сертификаты. S3 API проксируется отдельно, потому что браузеру нужны публичные presigned URL; MinIO принимает CORS только от CRM-домена, а сами объекты остаются приватными и открываются только по короткоживущей подписи. Публичный режим API всегда запускается с `AUTH_REQUIRED=true`.

## Первый запуск

На сервере должны быть Docker Engine с Compose v2, `openssl` и открытые входящие TCP-порты 22, 80, 443, а также UDP 443 для HTTP/3. Закройте снаружи 3000, 3001, 5432, 8080, 9000, 9001 и 3310.

```bash
cd /opt/CPI-CRM-MVP/infra/server
cp .env.server.example .env.server
chmod 600 .env.server
```

Заполните `.env.server`. Для URL-safe паролей PostgreSQL, Keycloak client и MinIO удобно использовать `openssl rand -hex 32`. Ключ сессии создаётся отдельно: `openssl rand -base64 32`; его декодированная длина должна быть ровно 32 байта. Не используйте пароль SSH в `.env.server`.

Книга XLSX по умолчанию берётся из корня репозитория. Если она лежит в другом месте, измените `IMPORT_WORKBOOK_HOST`; файл монтируется в API только для чтения и не попадает в Docker image.

Запуск приложения и, при необходимости, идемпотентный импорт книги:

```bash
./deploy.sh --check
./deploy.sh
./deploy.sh --import
```

`deploy.sh` проверяет конфигурацию, последовательно собирает образы, запускает миграции и начальные данные, затем ждёт healthchecks. Флаг `--import` дополнительно запускает одноразовый importer. Повторный импорт той же книги не создаёт новые канонические записи.

Проверка:

```bash
docker compose --env-file .env.server -f docker-compose.yml ps
curl -fsS https://crm.62-113-105-225.sslip.io/api/health
curl -fsS https://id.62-113-105-225.sslip.io/realms/cpi-crm/.well-known/openid-configuration >/dev/null
```

## Первый пользователь

Первый CRM-пользователь создаётся автоматически из `CRM_ADMIN_USERNAME`, `CRM_ADMIN_PASSWORD` и `CRM_ADMIN_EMAIL` и получает realm role `admin`. Откройте CRM, войдите этими данными и смените временный пароль по требованию Keycloak.

Административная консоль доступна по `https://id.62-113-105-225.sslip.io/admin/`; для неё используются отдельные `KEYCLOAK_ADMIN_USERNAME` и `KEYCLOAK_ADMIN_PASSWORD`. После проверки входа смените bootstrap-пароль администратора.

Realm импортируется только при создании пустой базы Keycloak. Если позднее меняется `OIDC_CLIENT_SECRET`, синхронно обновите secret клиента `cpi-crm` в Keycloak; одной правки `.env.server` для уже существующего realm недостаточно.

Аналогично, init-скрипты создают `APP_DB_USER` и `S3_APP_USER` только при первой инициализации. При ротации их паролей сначала обновите роль PostgreSQL (`ALTER ROLE ... PASSWORD ...`) и пользователя MinIO (`mc admin user add ...`) через административные учётные данные, затем синхронно измените `.env.server` и перезапустите сервисы.

## Обновление и наблюдение

```bash
docker compose --env-file .env.server -f docker-compose.yml stop worker clamav
./deploy.sh
docker compose --env-file .env.server -f docker-compose.yml logs -f --tail=200 api web worker caddy
```

Остановка worker и ClamAV перед сборкой освобождает память на хосте 4 ГБ; `deploy.sh` поднимет их снова. Если сборка завершилась ошибкой, верните их командой `docker compose --env-file .env.server -f docker-compose.yml up -d clamav worker`.

Схема БД мигрируется одноразовым сервисом `migrate`, а `seed` безопасно актуализирует организацию и системного импортёра. Эти контейнеры завершаются с кодом 0 и могут отображаться как `Exited`.

Резервная копия включает обе базы PostgreSQL — CRM и Keycloak — а также оба приватных MinIO bucket. Ручной запуск:

```bash
./backup.sh
```

По умолчанию локальные снимки старше 14 дней удаляются; срок меняется через `BACKUP_RETENTION_DAYS`. Установите ежедневный systemd timer:

```bash
cp systemd/cpi-crm-backup.service systemd/cpi-crm-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now cpi-crm-backup.timer
systemctl list-timers cpi-crm-backup.timer
```

Пути в unit-файле предполагают каталог `/opt/CPI-CRM-MVP`; при другом расположении поправьте `WorkingDirectory` и `ExecStart`. Каталоги `backups/` и `.env.server` не должны попадать в систему контроля версий. Локальный backup на том же диске не защищает от отказа сервера: регулярно копируйте завершённые каталоги вместе с `SHA256SUMS` в зашифрованное внешнее хранилище и проверяйте тестовое восстановление.

## Память на сервере 4 ГБ

Самый тяжёлый сервис — ClamAV: обычно ему нужно около 1,2 ГБ, а при атомарной перезагрузке сигнатур кратковременно до 2,4 ГБ. Поэтому контейнеру разрешено до 2,5 ГБ, и для хоста 4 ГБ обязательны настроенные 2 ГБ swap. На первом старте ClamAV загружает базы сигнатур и может выходить в ready несколько минут. Не запускайте параллельно другие тяжёлые сборки. Если ClamAV остановлен, карточки участников, мероприятия и экспорт продолжат работать, но новые файлы не станут доступными до возобновления проверки.
