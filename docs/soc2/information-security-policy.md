# Information Security Policy (ISP)

**Document Owner**: Security & Engineering Leadership  
**Effective Date**: August 2026  
**Review Cycle**: Annual  

---

## 1. Purpose & Scope

The purpose of this Information Security Policy is to establish the baseline organizational, technical, and operational safeguards required to protect Venue Wrangler systems, customer data, and employee information from unauthorized access, modification, destruction, or disclosure.

This policy applies to:
* All Venue Wrangler infrastructure, source code repositories, databases, and third-party SaaS services.
* All full-time employees, part-time contractors, and third-party vendors accessing company systems.

---

## 2. Core Security Principles

1. **Least Privilege**: Access to production environments, administrative tools, and sensitive data is granted strictly on a need-to-know, role-appropriate basis.
2. **Defense in Depth**: Security controls are applied across multiple layers—network, application, database, and operational procedures.
3. **Fail Closed**: In the event of system errors or authorization ambiguities, access is denied by default.
4. **Continuous Compliance**: Controls are verified continuously via automated scanning, logging, and third-party audits.

---

## 3. Workstation & Device Security

* **Full-Disk Encryption**: All employee and contractor laptops must have full-disk encryption enabled (FileVault on macOS, BitLocker on Windows, LUKS on Linux).
* **Password Managers**: Use of an approved password manager (e.g., 1Password, Bitwarden) is mandatory for generating and storing strong, unique credentials.
* **Screen Lock**: Workstations must be configured to automatically lock after 5 minutes of inactivity.
* **Anti-Malware & OS Updates**: Operating systems and software must have automatic security updates enabled.

---

## 4. Software Development Lifecycle (SDLC) Security

* **Version Control & Branch Protection**: All source code is hosted on GitHub. Direct pushes to `main` are prohibited. Branch protection rules require:
  * At least one approving pull request review from an authorized engineer.
  * Successful completion of automated CI checks (linter, unit tests, integration tests, dependency security audits, and CodeQL analysis).
* **Vulnerability Management**: 
  * Automated dependency scanning runs on every PR and weekly via scheduled GitHub Actions.
  * Critical and High vulnerabilities must be triaged and patched within 14 days of disclosure.
* **Separation of Environments**: Production and Development/Testing environments are completely isolated. Production database credentials are never accessible from local developer machines without encrypted, logged ephemeral bastion access.

---

## 5. Network & Cryptographic Safeguards

* **Encryption in Transit**: All public API traffic and web communications require TLS 1.3 with strong cipher suites and HTTP Strict Transport Security (HSTS) preloading.
* **Encryption at Rest**: All databases, storage volumes, and backups utilize AES-256 encryption.
* **Secrets Management**: Plaintext credentials, private keys, and API tokens must never be committed to source code repositories. Environment configurations in production utilize GCP Secret Manager or encrypted environment variables.

---

## 6. Policy Review & Enforcement

This policy is reviewed annually by engineering leadership. Non-compliance by personnel may result in disciplinary action up to and including termination of employment or contractual agreements.
