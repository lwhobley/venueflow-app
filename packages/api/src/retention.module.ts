import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './modules/audit/audit.module';
import { AttestationService } from './modules/attestation/attestation.service';

/** Minimal application graph for the external retention Cloud Run job. */
@Module({
  imports: [PrismaModule, AuditModule],
  providers: [AttestationService],
})
export class RetentionModule {}
