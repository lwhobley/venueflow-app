import { SetMetadata } from '@nestjs/common';

export const AUDITED_METADATA_KEY = 'AUDITED_METADATA_KEY';

export interface AuditedOptions {
  action: string;
  entityType?: string;
  summary?: string;
}

/**
 * Marks a controller route handler for automatic audit logging upon completion.
 */
export const Audited = (action: string, options?: Omit<AuditedOptions, 'action'>) =>
  SetMetadata(AUDITED_METADATA_KEY, { action, ...options });
