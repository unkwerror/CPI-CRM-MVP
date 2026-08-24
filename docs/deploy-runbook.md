# Как выкатить релиз на прод

Пошаговый порядок для сервера `62.113.105.225`, каталог `/opt/CPI-CRM-MVP`,
домен `crm.62-113-105-225.sslip.io`. Общее описание контура — в
[infra/server/README.md](../infra/server/README.md); здесь только процедура выката.

## Прежде чем начинать

Три вещи, на которых легко споткнуться именно на этом сервере:

1. **У сервера нет ключа к GitHub.** `git pull` в `/opt/CPI-CRM-MVP` падает с
   `Permission denied (publickey)`. Код приходится доставлять вручную — см. шаг 2.
2. **SSH банится за частые подключения.** После десятка коротких сессий подряд
   порт 22 начинает отдавать `Connection refused` минут на десять. Поэтому все
   команды на сервере выполняются одной длинной сессией, а не десятком коротких.
3. **Caddy на сервере публикует не только CRM.** Рядом живёт бот сбора артефактов
   (`artifacts.…` и `uploads-artifacts.…`), его блоки лежат в
   `infra/server/conf.d/` и в репозиторий не попадают. Дописывать их в `Caddyfile`
   нельзя: он приезжает из репозитория, и следующий выкат уронит бота вместе с
   приёмом вебхуков Telegram. Если после выката бот не отвечает, сначала проверьте
   `docker compose logs caddy` на список доменов.
4. **`participant-hygiene --apply` запускается при каждом деплое.** Для импортированных
   карточек по-прежнему требуется строгое русское ФИО. Временные профили из Telegram с
   пометкой `profile_needs_review` гигиена не архивирует: они видны в CRM до уточнения
   ФИО. Только неоднозначные или конфликтующие идентификаторы остаются в очереди
   «Заявки из бота» до ручной привязки.

## 1. Локально: проверить и запушить

```bash
cd ~/Documents/CPI-CRM-MVP
pnpm typecheck
pnpm test
pnpm build
git push origin main
```

Если `pnpm` жалуется на `ERR_PNPM_UNEXPECTED_STORE`, значит команда запущена не из
окружения редактора. Правильный store задаётся переменной:

```bash
export XDG_DATA_HOME=/home/www1rt/snap/code/247/.local/share
```

## 2. Доставить коммиты на сервер

Пока на сервере нет deploy-ключа, самый безопасный способ — git-бандл: он
переносит ровно те же коммиты с теми же хешами, история не расходится.
`<БАЗА>` — хеш коммита, который уже стоит на сервере (`git log --oneline -1` там).

```bash
git bundle create /tmp/cpi-crm.bundle <БАЗА>..main
scp /tmp/cpi-crm.bundle root@62.113.105.225:/tmp/
```

Разовая альтернатива, если бандлы надоели: сгенерировать на сервере ключ
(`ssh-keygen -t ed25519 -C cpi-crm-deploy`), добавить публичную часть в GitHub как
Deploy key репозитория `unkwerror/CPI-CRM-MVP`, и записать ключ GitHub в
`~/.ssh/known_hosts` (`ssh-keyscan -t ed25519 github.com`, отпечаток должен быть
`SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU`). После этого шаг 2 сводится
к `git pull --ff-only origin main` внутри шага 4.

## 3. Бэкап базы

Всегда до миграций, отдельной командой — чтобы точно знать, что снимок есть.

```bash
ssh root@62.113.105.225 'cd /opt/CPI-CRM-MVP && ./infra/server/backup.sh'
```

В выводе последней строкой будет путь вида
`/opt/CPI-CRM-MVP/infra/server/backups/20260807T123013Z`. Запомните его: внутри
`crm.dump`, `keycloak.dump` и `SHA256SUMS`. Файлов артефактов там нет: они лежат
в облачном бакете, выгрузить его целиком можно по SFTP из панели хранилища.

## 4. Выкат одной сессией

Всё в одном `ssh`, чтобы не поймать бан. Сборка образов на 2 CPU занимает
пять–десять минут, worker и ClamAV гасятся заранее ради памяти на хосте 4 ГБ.

```bash
ssh root@62.113.105.225 'set -e
  cd /opt/CPI-CRM-MVP
  git fetch /tmp/cpi-crm.bundle main:refs/remotes/bundle/main
  git merge --ff-only refs/remotes/bundle/main
  git log --oneline -1
  cd infra/server
  docker compose --env-file .env.server -f docker-compose.yml stop worker clamav
  ./deploy.sh
  docker compose --env-file .env.server -f docker-compose.yml ps
'
```

`deploy.sh` сам проверит `.env.server`, соберёт образы, прогонит одноразовые
сервисы `migrate`, `seed` и `participant-hygiene`, а затем дождётся healthchecks.
Контейнеры `migrate`, `seed` и `participant-hygiene` завершаются с кодом 0 и
остаются в статусе `Exited` — так и должно быть.

Если сборка упала на середине, поднимите обратно то, что гасили:

```bash
docker compose --env-file .env.server -f docker-compose.yml up -d clamav worker
```

## 5. Проверить

```bash
curl -fsS https://crm.62-113-105-225.sslip.io/api/health
ssh root@62.113.105.225 'cd /opt/CPI-CRM-MVP/infra/server &&
  docker compose --env-file .env.server -f docker-compose.yml logs --tail=100 api web'
```

Дальше руками в интерфейсе: открыть мероприятие, пройтись по вкладкам
«Участники / Артефакты / Возможные дубли / Выгрузки», скачать ZIP-пакет и
убедиться, что доски `/tasks`, `/review`, `/deals`, `/events` и календарь
`/calendar` открываются.

## Если что-то пошло не так

Откат кода — вернуть предыдущий коммит и пересобрать:

```bash
ssh root@62.113.105.225 'cd /opt/CPI-CRM-MVP && git reset --hard <БАЗА> &&
  cd infra/server && ./deploy.sh'
```

Откат базы — из снимка шага 3, только если миграция действительно всё сломала
(это потеряет данные, записанные после снимка):

```bash
ssh root@62.113.105.225 'cd /opt/CPI-CRM-MVP/infra/server &&
  docker compose --env-file .env.server -f docker-compose.yml stop api web worker &&
  docker exec -i cpi-crm-production-postgres-1 pg_restore -U cpi_owner -d cpi_crm --clean --if-exists
    < backups/<СНИМОК>/crm.dump'
```

## Полезные адреса и имена

| Что               | Значение                                                                        |
| ----------------- | ------------------------------------------------------------------------------- |
| Каталог CRM       | `/opt/CPI-CRM-MVP`                                                              |
| Каталог бота      | `/opt/CPI-TG-BOT` (не под git, залит rsync)                                     |
| Контейнер БД CRM  | `cpi-crm-production-postgres-1`, база `cpi_crm`, роль `cpi_owner`               |
| Контейнер БД бота | `cpi-artifacts-production-postgres-1`, база `artifacts`, роль `artifacts_owner` |
| Бэкапы            | `/opt/CPI-CRM-MVP/infra/server/backups/<UTC-метка>`                             |
