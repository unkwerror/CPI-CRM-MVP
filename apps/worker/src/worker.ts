import { S3Client } from '@aws-sdk/client-s3';
import { Pool } from 'pg';

import { reevaluateArtifactVersion } from './artifact-countability.js';
import { CampaignAttachmentStore } from './campaign-attachments.js';
import { CampaignEmailSender } from './campaign-email-sender.js';
import { CampaignSender } from './campaign-sender.js';
import type { WorkerConfig } from './config.js';
import { inTransaction } from './db.js';
import { FileRelocator } from './file-relocation.js';
import { FileScanner } from './file-scanner.js';
import { recalculateVersionAuthors } from './lifecycle.js';
import { OutboxProcessor, type OutboxEvent } from './outbox.js';
import { runDueLifecycleTransitions, runNightlyReconciliation } from './reconciliation.js';

export class WorkerRuntime {
  readonly #pool: Pool;
  readonly #scanner: FileScanner;
  readonly #relocator: FileRelocator;
  readonly #outbox: OutboxProcessor;
  readonly #campaigns: CampaignSender;
  readonly #campaignEmails: CampaignEmailSender;
  readonly #abort = new AbortController();
  readonly #tasks = new Set<Promise<unknown>>();
  #dueTimer?: NodeJS.Timeout;
  #reconciliationTimer?: NodeJS.Timeout;
  #campaignTimer?: NodeJS.Timeout;
  #activePoll: Promise<number> | undefined;
  #stopped = false;

  public constructor(private readonly config: WorkerConfig) {
    this.#pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
    const s3 = new S3Client({
      endpoint: config.storage.endpoint,
      region: config.storage.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.storage.accessKey,
        secretAccessKey: config.storage.secretKey,
      },
    });
    this.#scanner = new FileScanner(this.#pool, s3, {
      bucket: config.storage.bucket,
      prefix: config.storage.prefix,
      clamAv: config.clamAv,
    });
    this.#relocator = new FileRelocator(this.#pool, s3, {
      bucket: config.storage.bucket,
      prefix: config.storage.prefix,
    });
    this.#outbox = new OutboxProcessor(
      this.#pool,
      {
        workerId: config.workerId,
        batchSize: config.outboxBatchSize,
        leaseMs: config.leaseMs,
        maxAttempts: config.maxAttempts,
        retryBaseMs: config.retryBaseMs,
        retryMaxMs: config.retryMaxMs,
      },
      (event) => this.dispatch(event),
      async (event, error) => {
        if (event.eventType === 'file_scan_requested') {
          await this.#scanner.quarantineAfterTerminalFailure(event.aggregateId, error);
        }
      },
    );
    const attachments = new CampaignAttachmentStore(this.#pool, s3, config.storage.bucket);
    this.#campaigns = new CampaignSender(this.#pool, attachments, {
      telegramBotToken: config.campaigns.telegramBotToken,
      telegramApiUrl: config.campaigns.telegramApiUrl,
      batchSize: config.campaigns.batchSize,
    });
    this.#campaignEmails = new CampaignEmailSender(this.#pool, attachments, {
      apiKey: config.campaigns.unisenderApiKey,
      apiUrl: config.campaigns.unisenderApiUrl,
      fromEmail: config.campaigns.fromEmail,
      fromName: config.campaigns.fromName,
      replyTo: config.campaigns.replyTo,
      botLink: config.campaigns.telegramBotLink,
      dailyLimit: config.campaigns.emailDailyLimit,
      batchSize: config.campaigns.batchSize,
    });
  }

  public async run(): Promise<void> {
    await this.#pool.query('SELECT 1');
    console.info('CPI CRM worker started', { workerId: this.config.workerId });

    this.track(this.runDue());
    this.track(this.runReconciliation());
    this.#dueTimer = setInterval(() => this.track(this.runDue()), this.config.dueIntervalMs);
    this.#reconciliationTimer = setInterval(
      () => this.track(this.runReconciliation()),
      this.config.reconciliationIntervalMs,
    );
    this.#campaignTimer = setInterval(
      () => this.track(this.runCampaigns()),
      this.config.campaigns.intervalMs,
    );

    while (!this.#abort.signal.aborted) {
      let claimed = 0;
      try {
        const poll = this.#outbox.processOnce();
        this.#activePoll = poll;
        claimed = await poll;
      } catch (error) {
        console.error('Outbox polling failed', { error: errorMessage(error) });
      } finally {
        this.#activePoll = undefined;
      }
      if (claimed < this.config.outboxBatchSize) {
        await abortableDelay(this.config.pollIntervalMs, this.#abort.signal);
      }
    }
  }

  public async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#abort.abort();
    if (this.#dueTimer) clearInterval(this.#dueTimer);
    if (this.#reconciliationTimer) clearInterval(this.#reconciliationTimer);
    if (this.#campaignTimer) clearInterval(this.#campaignTimer);
    if (this.#activePoll) await Promise.allSettled([this.#activePoll]);
    await Promise.allSettled([...this.#tasks]);
    await this.#pool.end();
    console.info('CPI CRM worker stopped', { workerId: this.config.workerId });
  }

  private async dispatch(event: OutboxEvent): Promise<void> {
    switch (event.eventType) {
      case 'file_scan_requested':
        await this.#scanner.process(event.aggregateId);
        return;
      case 'file_relocation_requested': {
        const artifactVersionId = event.payload.artifactVersionId;
        const campaignId = event.payload.campaignId;
        if (typeof artifactVersionId === 'string')
          await this.#relocator.relocateArtifactFile(event.aggregateId, artifactVersionId);
        else if (typeof campaignId === 'string')
          await this.#relocator.relocateCampaignAttachment(event.aggregateId, campaignId);
        return;
      }
      case 'artifact_version_submitted_pending_scan':
        await inTransaction(this.#pool, (client) =>
          reevaluateArtifactVersion(client, event.aggregateId).then(() => undefined),
        );
        return;
      case 'artifact_version_became_countable':
        await inTransaction(this.#pool, (client) =>
          recalculateVersionAuthors(client, event.aggregateId, 'ARTIFACT_BECAME_COUNTABLE').then(
            () => undefined,
          ),
        );
        return;
      case 'person_lifecycle_changed':
        // Durable domain notification reached the local delivery boundary. A later
        // Redis/BullMQ or integration publisher can replace this sink without
        // changing the source-of-truth and lease semantics.
        return;
      default:
        throw new Error(`Unsupported outbox event type: ${event.eventType}`);
    }
  }

  private async runDue(): Promise<void> {
    try {
      const transitions = await runDueLifecycleTransitions(
        this.#pool,
        this.config.reconciliationBatchSize,
      );
      console.info('Due lifecycle pass completed', { transitions });
    } catch (error) {
      console.error('Due lifecycle pass failed', { error: errorMessage(error) });
    }
  }

  private async runCampaigns(): Promise<void> {
    try {
      const telegram = await this.#campaigns.processOnce();
      const email = await this.#campaignEmails.processOnce();
      if (telegram > 0 || email > 0)
        console.info('Campaign messages delivered', { telegram, email });
    } catch (error) {
      console.error('Campaign delivery pass failed', { error: errorMessage(error) });
    }
  }

  private async runReconciliation(): Promise<void> {
    try {
      const result = await runNightlyReconciliation(
        this.#pool,
        this.config.reconciliationBatchSize,
      );
      console.info('Lifecycle reconciliation completed', result);
    } catch (error) {
      console.error('Lifecycle reconciliation failed', { error: errorMessage(error) });
    }
  }

  private track(task: Promise<unknown>): void {
    this.#tasks.add(task);
    void task.finally(() => this.#tasks.delete(task));
  }
}

// Пауза между опросами берётся на каждом витке цикла, поэтому слушатель отмены
// обязательно снимается: иначе за сутки на сигнале копятся десятки тысяч
// подписок и процесс упирается в предел кучи.
export function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
