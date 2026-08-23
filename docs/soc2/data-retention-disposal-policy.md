# Data Classification, Retention & Disposal Policy

**Document Owner**: Security & Engineering  
**Effective Date**: August 2026  
**Review Cycle**: Annual  

---

## 1. Purpose & Scope

This policy defines the data classification tiers, retention periods, and secure cryptographic sanitization and disposal procedures for customer records, employee information, and audit trails processed by Venue Wrangler.

---

## 2. Data Classification Matrix

| Classification Tier | Description | Examples | Protection Controls |
|---------------------|-------------|----------|---------------------|
| **Restricted (Confidential)** | Highly sensitive business or security assets whose disclosure causes severe operational or financial harm. | Passwords (salted/hashed), POS connection secrets, Stripe customer IDs, JWT signing secrets, database credentials. | One-way hashing (PBKDF2/SHA-256), encrypted secrets manager, never logged, excluded from API responses. |
| **Confidential (PII & Business Data)** | Sensitive customer operational and personal data. | Staff names, phone numbers, email addresses, shift schedules, time-clock entries, payroll exports, reservations, guest notes. | Multi-tenant isolation enforced, TLS in transit, AES-256 at rest, role-based access control. |
| **Internal** | Non-public company documentation and aggregated operational telemetry. | System architectures, internal Slack communications, aggregated analytics. | Authentication required, internal access only. |
| **Public** | Information intended for public distribution. | Marketing website content, public help documentation, Terms of Service, Privacy Policy. | Publicly accessible over HTTPS. |

---

## 3. Data Retention Lifecycle

| Data Category | Retention Window | Storage Medium | Deletion Method |
|---------------|------------------|----------------|-----------------|
| **Active Tenant Operational Data** | Duration of active subscription | Supabase PostgreSQL | Hard delete cascade upon tenant offboarding request. |
| **Nightly Database Backups** | **30 Days** | Encrypted AWS S3 Bucket | Automated S3 Lifecycle Rule (`Expire after 30 days`). |
| **Security & System Audit Logs** | **365 Days** (1 Year) | PostgreSQL `AuditLog` table | Automated hard deletion by the externally scheduled retention job. No immutable archive is currently claimed. |
| **Application Error Traces (Sentry)** | **30 Days** | Sentry Cloud | Automated Sentry retention expiration. |
| **Device Attestation Challenges** | **15 Minutes** | PostgreSQL `AttestationChallenge` | Ephemeral single-use expiration. |

---

## 4. Account Deletion & "Right to be Forgotten" Protocol

When a customer cancels their subscription or requests account deletion under GDPR/CCPA:
1. **Verification**: Request must originate from the authenticated Venue Owner or verified account email.
2. **Cascade Deletion**: A final owner can explicitly confirm tenant offboarding in the app; the API deletes all venue-owned models (profiles, shifts, time entries, floor plans, reservations) transactionally. Non-owner account deletion removes only that user's account and profile.
3. **Media Purge**: On tenant offboarding, the venue's images and documents are written to a durable deletion outbox in the same transaction. The API attempts deletion immediately and retries failed AWS S3 deletes hourly, escalating a job for manual review after repeated failures rather than retrying indefinitely. Non-owner account deletion does not purge venue media: files uploaded into a venue are that venue's operational records and are removed when the venue is deleted.
4. **Anonymization**: Timeclock or audit records retained for legal/tax purposes replace personal names and emails with synthetic identifiers (`deleted_user_[profile_id]`).
5. **Wage-record retention**: Before a venue is deleted, its timeclock rows are copied to `RetainedTimeEntry`, which holds no foreign key to the venue and therefore survives the cascade. This preserves the FLSA-required three-year payroll history for *all* staff at that venue, not only the account being deleted.
5. **Confirmation**: Written confirmation of data destruction is provided to the customer within 30 days.

---

## 5. Media & Workstation Sanitization

* **Cloud Storage**: Cloud disks (Cloud Run container ephemeral storage, Supabase volumes) are encrypted with provider-managed cryptographic erasure upon deletion.
* **Employee Devices**: When laptops or storage drives reach end-of-life or are returned upon employee separation, drives undergo cryptographic zeroing (NIST SP 800-88 Rev. 1 compliant sanitize command).
