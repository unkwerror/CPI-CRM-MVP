import { loadConfig } from './config.js';
import { WorkerRuntime } from './worker.js';

const worker = new WorkerRuntime(loadConfig());
let stopping = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.info('Stopping CPI CRM worker', { signal });
  await worker.stop();
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

worker.run().catch(async (error: unknown) => {
  console.error('CPI CRM worker terminated', error);
  process.exitCode = 1;
  await worker.stop();
});
