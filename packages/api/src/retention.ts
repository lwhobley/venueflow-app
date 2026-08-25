import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { RetentionModule } from './retention.module';
import { AuditService } from './modules/audit/audit.service';
import { AttestationService } from './modules/attestation/attestation.service';
import { initSentry, captureException, flushSentry } from './observability/sentry';

export async function runRetention(): Promise<void> {
  // This entrypoint runs standalone via NestFactory.createApplicationContext,
  // not through main.ts, so nothing else in the process calls initSentry() —
  // captureException() below would otherwise be a silent no-op.
  initSentry();
  const app = await NestFactory.createApplicationContext(RetentionModule);
  try {
    const audit = app.get(AuditService);
    const attestation = app.get(AttestationService);
    // Run sequentially so a backlog in multiple tables cannot multiply database
    // write pressure. Each service performs its own bounded batches.
    const auditLogs = await audit.cleanupOldAuditLogs();
    const wageRecords = await audit.cleanupExpiredRetainedTimeEntries();
    const challenges = await attestation.cleanupExpiredChallenges();
    Logger.log(
      `Retention completed: auditLogs=${auditLogs} wageRecords=${wageRecords} challenges=${challenges}`,
      'RetentionJob',
    );
  } finally {
    await app.close();
  }
}

export async function reportRetentionFailure(error: unknown): Promise<void> {
  Logger.error(error instanceof Error ? error.stack ?? error.message : String(error), 'RetentionJob');
  captureException(error, { job: 'retention' });
  await flushSentry();
  process.exitCode = 1;
}

// Guarded so importing this module (e.g. from a test) doesn't try to spin up
// a real Nest application context as a side effect — only running it directly
// (`node dist/retention.js`, which is exactly what the Cloud Run job does) does.
if (require.main === module) {
  void runRetention().catch(reportRetentionFailure);
}
