import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { RetentionModule } from './retention.module';
import { AuditService } from './modules/audit/audit.service';
import { AttestationService } from './modules/attestation/attestation.service';

async function runRetention(): Promise<void> {
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

void runRetention().catch((error: unknown) => {
  Logger.error(error instanceof Error ? error.stack ?? error.message : String(error), 'RetentionJob');
  process.exitCode = 1;
});
