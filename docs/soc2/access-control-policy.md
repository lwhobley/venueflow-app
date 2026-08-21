# Access Control & Authentication Policy

**Document Owner**: Security & Engineering Leadership  
**Effective Date**: August 2026  
**Review Cycle**: Annual  

---

## 1. Purpose & Scope

This policy governs identity verification, authentication mechanisms, password standards, session management, and role-based access controls across Venue Wrangler's customer-facing application and internal production infrastructure.

---

## 2. Customer Application Access Controls

### 2.1 Role-Based Access Control (RBAC) Hierarchy
Venue Wrangler enforces strict authorization tiers for venue members:

| Role | Permissions & Scope |
|------|---------------------|
| **Admin** | Full system administration, billing, venue settings, staff management, payroll, and audit logs. |
| **Owner** | Venue owner authority, billing administration, manager assignments, and operational reporting. |
| **Manager** | Operational management: scheduling, shift approval, time-clock oversight, prep boards, and logbook entries. |
| **Server / Staff** | Self-service operations: schedule viewing, shift swap requests, time clock punching, and chat communication. |

### 2.2 Password Standards
* **Minimum Length**: Newly created or changed passwords must be at least 8 characters.
* **Hashing Algorithm**: PBKDF2 with SHA-256 digest, 32-byte salt, and 600,000 iterations (OWASP recommended minimum).
* **Brute-Force Protection**: 
  * Rate-limited to 12 attempts per 15-minute window per IP and email.
  * Account locked after 8 consecutive failed sign-in attempts.

### 2.3 Session Management & Token Lifecycles
* **Session Duration**: JSON Web Tokens (JWT) and database session rows expire after 30 days.
* **Immediate Revocation**: 
  * Explicit logout deletes the active device session from PostgreSQL immediately.
  * Password change automatically revokes all other concurrent sessions for that account.
  * Staff termination or role revocation instantly terminates active profile permissions.

---

## 3. Internal Infrastructure Access Controls

### 3.1 Production Cloud Environments (GCP, Supabase, AWS, Cloudflare)
* **MFA Requirement**: Multi-Factor Authentication (TOTP or FIDO2/WebAuthn hardware security keys) is strictly mandatory on all cloud provider and identity provider accounts.
* **Principle of Least Privilege**: Access to Google Cloud Platform, Supabase production dashboard, and Stripe live dashboard is restricted to authorized engineering personnel.
* **Access Reviews**: Production access lists are audited on a quarterly basis.
* **Immediate Deprovisioning**: Upon employee or contractor departure, all access (GitHub, GCP, Supabase, Google Workspace, Slack) is revoked within 24 hours of notification.

---

## 4. Audit Trail & Monitoring

All authentication events (successful login, failed login, account creation, password reset request, password reset completion, session revocation) are immutably recorded in the `AuditLog` table with IP address, user-agent, and sanitized metadata.
