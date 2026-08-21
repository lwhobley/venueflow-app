# Venue Wrangler SOC 2 Controls Matrix

This document maps AICPA Trust Services Criteria to specific technical and organizational controls implemented across the Venue Wrangler platform.

---

## 1. Common Criteria (Security)

### CC1: Control Environment
| Criterion | Control Activity | Implementation / Evidence |
|-----------|------------------|---------------------------|
| **CC1.1** | Commitment to integrity and ethical values | Code of Conduct and Information Security Policy acknowledged by all personnel annually. |
| **CC1.2** | Oversight responsibilities of leadership | Security officer assigned; quarterly executive reviews of risk registers and security KPIs. |
| **CC1.3** | Organizational structure and assignment of authority | Role-based permissions in GitHub, GCP IAM, Supabase, and Stripe; least privilege strictly enforced. |
| **CC1.4** | Human resources practices | Background checks conducted for all new hires; offboarding checklist revokes all system access within 24 hours. |

### CC2: Communication and Information
| Criterion | Control Activity | Implementation / Evidence |
|-----------|------------------|---------------------------|
| **CC2.1** | Internal and external security communications | Security responsibilities communicated via onboarding training and security alerts channel. |
| **CC2.2** | Incident reporting procedures | Defined Incident Response Plan (`docs/soc2/incident-response-plan.md`) with public security contact (`support@venuewrangler.com`). |

### CC3: Risk Assessment
| Criterion | Control Activity | Implementation / Evidence |
|-----------|------------------|---------------------------|
| **CC3.1** | Risk assessment process | Annual organizational risk assessments and threat modeling for new architectural changes. |
| **CC3.2** | Identification of potential fraud risks | Anti-fraud rate limiting on auth routes; POS secret rotation with cryptographic one-way hashing. |

### CC4: Monitoring Activities
| Criterion | Control Activity | Implementation / Evidence |
|-----------|------------------|---------------------------|
| **CC4.1** | Ongoing evaluations of internal controls | Automated CI/CD security scanning, dependency vulnerability gates (`.github/workflows/dependency-audit.yml`), and CodeQL analysis (`.github/workflows/codeql.yml`). |
| **CC4.2** | Communication of deficiencies | GCP Cloud Monitoring alert policies (`projects/venuewrangler/alertPolicies/7994759751285739344`) and Sentry error tracking. |

### CC5: Control Activities
| Criterion | Control Activity | Implementation / Evidence |
|-----------|------------------|---------------------------|
| **CC5.1** | Selection and development of control activities | Defense-in-depth architecture: NestJS validation pipes, helmet HTTP headers, strict CORS, and database RLS. |
| **CC5.2** | Controls over technology infrastructure | Cloud Run containerized revisions; automated TLS 1.3 / HSTS termination. |

### CC6: Logical and Physical Access Controls
| Criterion | Control Activity | Implementation / Evidence |
|-----------|------------------|---------------------------|
| **CC6.1** | Logical access security | JWT session-based authentication, PBKDF2 password hashing (600,000 iterations), brute-force throttling (`assertWithinSharedRateLimit`). |
| **CC6.2** | User registration and credential management | Single-use email verification tokens, secure password reset one-time codes, session revocation on password change. |
| **CC6.3** | Role-Based Access Control (RBAC) | Explicit role hierarchy (`admin`, `owner`, `manager`, `server`, `staff`) enforced by `RolesGuard` and `VenueScopeInterceptor`. |
| **CC6.4** | Physical access restrictions | Physical hosting delegated to Google Cloud Platform and Supabase (AWS us-east-1) SOC 2 Type II certified data centers. |
| **CC6.5** | Data transmission and endpoint protection | TLS 1.3 in transit with HSTS; PII redaction filter (`sanitizeAuditMetadata`) preventing secret leakage in audit logs. |
| **CC6.6** | Multi-tenant isolation | Tenant isolation Prisma extension (`packages/api/src/prisma/tenant-scope.ts`) enforcing `where: { venueId }` on all tenant queries with Postgres RLS fail-closed backstop. |
| **CC6.7** | Threat detection and prevention | Rate limiting per IP and venue; automatic account lockout after 8 consecutive failed sign-in attempts. |

### CC7: System Operations
| Criterion | Control Activity | Implementation / Evidence |
|-----------|------------------|---------------------------|
| **CC7.1** | Vulnerability management | Weekly automated dependency scans; high/critical vulnerability gate blocking PR merges. |
| **CC7.2** | Infrastructure and security monitoring | Cloud Run log-based metrics, centralized `AuditLog` table capturing auth and administrative events. |
| **CC7.3** | Incident response management | Formal Incident Response Plan (`docs/soc2/incident-response-plan.md`) with defined severity matrix and customer notification SLAs (<72h). |

### CC8: Change Management
| Criterion | Control Activity | Implementation / Evidence |
|-----------|------------------|---------------------------|
| **CC8.1** | Authorized system changes | Mandatory pull request reviews, branch protection on `main`, automated CI testing (API unit & integration tests, mobile CI) before deployment. |
| **CC8.2** | Deployment and rollback procedures | Google Cloud Run immutable revision deployments with zero-downtime rollback runbook (`docs/production-operations.md`). |

### CC9: Risk Mitigation
| Criterion | Control Activity | Implementation / Evidence |
|-----------|------------------|---------------------------|
| **CC9.1** | Business risk mitigation | Business Continuity and Disaster Recovery Plan (`docs/soc2/business-continuity-disaster-recovery.md`). |
| **CC9.2** | Vendor and third-party risk management | Formal vendor review policy (`docs/soc2/vendor-management-policy.md`) covering all subprocessors. |

---

## 2. Availability Criteria

| Criterion | Control Activity | Implementation / Evidence |
|-----------|------------------|---------------------------|
| **A1.1** | Capacity management | Cloud Run auto-scaling (up to 8 instances), managed PostgreSQL connection pooling budget (5 connections per container, 40 total, 20 reserved for admin). |
| **A1.2** | Data backup and restoration | Supabase Pro automated Point-in-Time Recovery (PITR); secondary nightly encrypted logical backups to AWS S3 (`.github/workflows/database-backup.yml`) with 30-day lifecycle retention. |
| **A1.3** | Disaster recovery testing | Semi-annual restore drills from backup artifacts to isolated staging environment. |

---

## 3. Confidentiality Criteria

| Criterion | Control Activity | Implementation / Evidence |
|-----------|------------------|---------------------------|
| **C1.1** | Data classification and identification | Formal data classification (Public, Internal, Confidential, Restricted) defined in `docs/soc2/data-retention-disposal-policy.md`. |
| **C1.2** | Secure disposal of confidential information | Tenant data deletion workflows, POS secret cryptographic hashing (SHA-256 digests stored, plaintext never persisted), and S3 SSE-S3 encrypted storage. |
