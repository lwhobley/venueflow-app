# Vendor Management & Subprocessor Policy

**Document Owner**: Security & Legal  
**Effective Date**: August 2026  
**Review Cycle**: Annual  

---

## 1. Purpose & Scope

This policy governs the selection, risk evaluation, ongoing monitoring, and annual security assessment of all third-party vendors and cloud subprocessors that store, process, or transmit customer data or support Venue Wrangler's production infrastructure.

---

## 2. Approved Production Subprocessors

| Subprocessor | Purpose / Service | Data Processed | Compliance Certifications |
|--------------|-------------------|----------------|---------------------------|
| **Google Cloud Platform (GCP)** | Cloud Run container hosting, load balancing, logging, and secret management. | Application compute, encrypted environment variables, request logs. | SOC 1/2/3, ISO 27001, FedRAMP, HIPAA |
| **Supabase (PostgreSQL)** | Managed PostgreSQL database hosting, connection pooling, and storage. | Customer tenant data, user profiles, shift schedules, reservations. | SOC 2 Type II, HIPAA, ISO 27001 |
| **Amazon Web Services (AWS)** | S3 object storage for chat media attachments and nightly database backups. | User-uploaded images, encrypted logical database backup dumps. | SOC 1/2/3, ISO 27001, FedRAMP |
| **Stripe** | Subscription billing, invoicing, credit card processing. | Customer billing details, subscription status, tokenized payment IDs (zero raw PAN on Venue Wrangler servers). | PCI-DSS Level 1, SOC 1/2 |
| **Sentry** | Error logging and application performance monitoring. | Application stack traces, redacted error metadata (PII scrubbing active). | SOC 2 Type II, ISO 27001, HIPAA |
| **Resend / SendGrid** | Transactional emails (verification codes, password resets, onboarding). | User email addresses, staff names, invitation codes. | SOC 2 Type II, ISO 27001 |
| **Apple / Google (Expo)** | Push notifications and mobile app distribution. | Device push notification tokens. | SOC 2 / ISO 27001 |

---

## 3. Vendor Assessment & Onboarding Criteria

Prior to onboarding any new vendor handling sensitive customer data or infrastructure:
1. **Security Review**: Vendor must provide a valid **SOC 2 Type II Report** or **ISO 27001 Certificate** issued within the last 12 months.
2. **Data Protection Agreement (DPA)**: Standard contractual clauses and confidentiality terms must be executed.
3. **Encryption & Redaction**: Vendor must support encryption in transit (TLS 1.2+) and at rest (AES-256).
4. **Least Privilege Integration**: API integrations must use narrowly scoped API keys or service accounts.

---

## 4. Annual Vendor Review Process

* **Schedule**: All vendors in Section 2 undergo an annual security review.
* **Requirements**:
  * Request and review updated SOC 2 Type II reports / bridge letters.
  * Audit integration scopes and rotate API credentials/webhook secrets.
  * Review any vendor security incidents or data breaches disclosed during the prior 12 months.
