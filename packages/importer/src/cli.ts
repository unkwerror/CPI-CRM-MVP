#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { assertControlsPassed, auditImportPlan } from './audit.js';
import { DEFAULT_TIMEZONE, DEFAULT_WORKBOOK_FILENAME } from './constants.js';
import { commitImportPlan } from './postgres.js';
import { renderJsonReport, renderMarkdownReport } from './report.js';
import type { CommitOptions } from './types.js';
import { readWorkbookImportPlan } from './workbook.js';

const workspaceRoot = resolve(process.cwd(), '../..');
const envFile = resolve(workspaceRoot, process.env.ENV_FILE ?? '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

interface CliArguments {
  readonly help: boolean;
  readonly mode: 'DRY_RUN' | 'COMMIT';
  readonly workbookPath?: string;
  readonly databaseUrl?: string;
  readonly organizationId?: string;
  readonly userId?: string;
  readonly sourceFileObjectId?: string;
  readonly timezone: string;
  readonly jsonReportPath?: string;
  readonly markdownReportPath?: string;
  readonly reportDirectory?: string;
}

const HELP = `Использование:
  pnpm --filter @cpi-crm/importer run import -- --dry-run [options]
  pnpm --filter @cpi-crm/importer run import -- --commit [options]

Режимы:
  --dry-run                       Проверить книгу, PostgreSQL не открывается
  --commit                        Выполнить одну транзакцию PostgreSQL

Параметры:
  --file <path>                   XLSX (по умолчанию исходная книга в корне репозитория)
  --database-url <url>            Или DATABASE_URL; нужен для --commit
  --organization-id <uuid>        Или CPI_IMPORT_ORGANIZATION_ID
  --user-id <uuid>                Или CPI_IMPORT_USER_ID
  --source-file-object-id <uuid>  Необязательно; иначе создаётся local-import FileObject
  --timezone <iana>               По умолчанию Asia/Novosibirsk
  --report-dir <path>             Каталог двух отчётов
  --json-report <path>            Явный путь JSON-отчёта
  --markdown-report <path>        Явный путь Markdown-отчёта
  --help
`;

function parseValue(
  argv: readonly string[],
  index: number,
  name: string,
): { readonly value: string; readonly nextIndex: number } {
  const argument = argv[index];
  if (argument?.startsWith(`${name}=`)) {
    const value = argument.slice(name.length + 1);
    if (value.length === 0) throw new Error(`${name} requires a value`);
    return { value, nextIndex: index };
  }
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return { value, nextIndex: index + 1 };
}

function parseArguments(argv: readonly string[]): CliArguments {
  let dryRun = false;
  let commit = false;
  let help = false;
  let workbookPath: string | undefined;
  let databaseUrl: string | undefined;
  let organizationId: string | undefined;
  let userId: string | undefined;
  let sourceFileObjectId: string | undefined;
  let timezone = DEFAULT_TIMEZONE;
  let jsonReportPath: string | undefined;
  let markdownReportPath: string | undefined;
  let reportDirectory: string | undefined;

  const args = argv[0] === 'import' ? argv.slice(1) : argv;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') continue;
    if (argument === '--dry-run') dryRun = true;
    else if (argument === '--commit') commit = true;
    else if (argument === '--help' || argument === '-h') help = true;
    else {
      const names = [
        '--file',
        '--database-url',
        '--organization-id',
        '--user-id',
        '--source-file-object-id',
        '--timezone',
        '--json-report',
        '--markdown-report',
        '--report-dir',
      ];
      const name = names.find(
        (candidate) => argument === candidate || argument?.startsWith(`${candidate}=`),
      );
      if (name === undefined) throw new Error(`Unknown argument: ${argument ?? ''}`);
      const parsed = parseValue(args, index, name);
      index = parsed.nextIndex;
      if (name === '--file') workbookPath = parsed.value;
      else if (name === '--database-url') databaseUrl = parsed.value;
      else if (name === '--organization-id') organizationId = parsed.value;
      else if (name === '--user-id') userId = parsed.value;
      else if (name === '--source-file-object-id') sourceFileObjectId = parsed.value;
      else if (name === '--timezone') timezone = parsed.value;
      else if (name === '--json-report') jsonReportPath = parsed.value;
      else if (name === '--markdown-report') markdownReportPath = parsed.value;
      else if (name === '--report-dir') reportDirectory = parsed.value;
    }
  }
  if (dryRun && commit) throw new Error('Choose only one of --dry-run and --commit');

  return {
    help,
    // The safe default is a read-only audit.
    mode: commit ? 'COMMIT' : 'DRY_RUN',
    ...(workbookPath === undefined ? {} : { workbookPath }),
    ...(databaseUrl === undefined ? {} : { databaseUrl }),
    ...(organizationId === undefined ? {} : { organizationId }),
    ...(userId === undefined ? {} : { userId }),
    ...(sourceFileObjectId === undefined ? {} : { sourceFileObjectId }),
    timezone,
    ...(jsonReportPath === undefined ? {} : { jsonReportPath }),
    ...(markdownReportPath === undefined ? {} : { markdownReportPath }),
    ...(reportDirectory === undefined ? {} : { reportDirectory }),
  };
}

async function firstExisting(paths: readonly string[]): Promise<string> {
  for (const path of paths) {
    try {
      await access(path);
      return path;
    } catch {
      // Try the next deterministic local location.
    }
  }
  throw new Error(`Workbook not found; pass --file <path>`);
}

async function resolveWorkbookPath(explicit?: string): Promise<string> {
  if (explicit !== undefined) return resolve(workspaceRoot, explicit);
  return firstExisting([
    resolve(workspaceRoot, DEFAULT_WORKBOOK_FILENAME),
    resolve(process.cwd(), DEFAULT_WORKBOOK_FILENAME),
  ]);
}

async function writeReport(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, { encoding: 'utf8', flag: 'w', mode: 0o600 });
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  const workbookPath = await resolveWorkbookPath(args.workbookPath ?? process.env.IMPORT_WORKBOOK);
  const plan = await readWorkbookImportPlan(workbookPath);
  let report = auditImportPlan(plan, args.mode);

  if (args.mode === 'COMMIT') {
    assertControlsPassed(report);
    const databaseUrl = args.databaseUrl ?? process.env.DATABASE_URL;
    const organizationId = args.organizationId ?? process.env.CPI_IMPORT_ORGANIZATION_ID;
    const initiatedByUserId = args.userId ?? process.env.CPI_IMPORT_USER_ID;
    if (
      databaseUrl === undefined ||
      organizationId === undefined ||
      initiatedByUserId === undefined
    ) {
      throw new Error(
        '--commit requires database URL, organization ID and user ID (flags or environment)',
      );
    }
    const commitOptions: CommitOptions = {
      databaseUrl,
      organizationId,
      initiatedByUserId,
      timezone: args.timezone,
      ...(args.sourceFileObjectId === undefined
        ? {}
        : { sourceFileObjectId: args.sourceFileObjectId }),
    };
    const commit = await commitImportPlan(plan, commitOptions);
    report = auditImportPlan(plan, 'COMMIT', commit);
  }

  const reportDirectory = resolve(args.reportDirectory ?? process.cwd());
  const jsonPath = resolve(args.jsonReportPath ?? resolve(reportDirectory, 'import-report.json'));
  const markdownPath = resolve(
    args.markdownReportPath ?? resolve(reportDirectory, 'import-report.md'),
  );
  await Promise.all([
    writeReport(jsonPath, renderJsonReport(report)),
    writeReport(markdownPath, renderMarkdownReport(report)),
  ]);

  process.stdout.write(
    `${JSON.stringify({
      mode: report.mode,
      controlsPassed: report.controlsPassed,
      sha256: report.source.sha256,
      sourceRows: report.totals.sourceRows,
      personObservations: report.totals.personObservations,
      jsonReport: jsonPath,
      markdownReport: markdownPath,
      batchId: report.commit?.batchId ?? null,
      runId: report.commit?.runId ?? null,
    })}\n`,
  );
  if (!report.controlsPassed) process.exitCode = 2;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown importer error';
  process.stderr.write(`Import failed: ${message}\n`);
  process.exitCode = 1;
});
