# Business Continuity & Disaster Recovery (BC/DR) Plan

**Document Owner**: Infrastructure Lead  
**Effective Date**: August 2026  
**Review Cycle**: Annual  

---

## 1. Objectives & Metrics

Venue Wrangler is engineered to ensure continuous business operations and rapid recovery in the event of major infrastructure disruptions, cloud provider outages, or catastrophic data corruption.

### Service Recovery Targets
* **Recovery Time Objective (RTO)**: **< 4 hours** (Maximum acceptable duration to restore service following a total region/database failure).
* **Recovery Point Objective (RPO)**: **< 1 hour** (Maximum acceptable data loss window; typically < 5 minutes via WAL streaming / PITR).

---

## 2. Infrastructure Architecture & Redundancy

* **API Compute Layer**: Google Cloud Run (`venue-wrangler-api` in `us-east1`) with automated multi-zone container replication, autoscaling (up to 8 instances), and instant zero-downtime revision rollbacks.
* **Database Layer**: Managed PostgreSQL on Supabase Pro with multi-AZ failover and continuous Write-Ahead Log (WAL) archiving for Point-In-Time Recovery (PITR).
* **Media & File Storage**: Amazon Web Services (AWS S3) in `us-east-1` with cross-zone durability (99.999999999% durability SLA) and SSE-S3 encryption.
* **DNS & Web Routing**: Cloudflare Anycast edge network with automated SSL and DDoS mitigation.

---

## 3. Database Backup & Recovery Strategy

### 3.1 Point-in-Time Recovery (PITR)
* Continuous WAL archiving allows restoration of the database to any specific second within the last 7 days.

### 3.2 Nightly Logical S3 Backups
* Automated GitHub Action (`.github/workflows/database-backup.yml`) runs nightly logical dumps (`pg_dump`) to an isolated, encrypted AWS S3 bucket.
* Lifecycle policy strictly enforces a **30-day retention** window with object immutability.

### 3.3 Backup Restoration Drill Protocol
* **Cadence**: Conducted semi-annually (every 6 months).
* **Procedure**:
  1. Pull latest nightly backup snapshot from S3.
  2. Restore database into an isolated staging Postgres container/cluster.
  3. Execute Prisma schema migration checks and automated integration test suite (`npm run test:integration`).
  4. Record drill timestamp, duration, RTO achievement, and sign-off in SOC 2 evidence logs.

---

## 4. Disaster Recovery Scenarios & Playbooks

### Scenario A: Cloud Run Service Disruption or Bad Release
1. List available immutable revisions:
   ```bash
   gcloud run revisions list --service=venue-wrangler-api --region=us-east1 --project=venuewrangler
   ```
2. Shift 100% of traffic to the last verified revision:
   ```bash
   gcloud run services update-traffic venue-wrangler-api --to-revisions=LAST_KNOWN_GOOD_REV=100 --region=us-east1 --project=venuewrangler
   ```
3. Verify `/api/health` and mobile login flows.

### Scenario B: Primary Database Outage or Data Corruption
1. Pause API traffic or enable maintenance mode.
2. In Supabase Dashboard, trigger Point-in-Time Recovery (PITR) to a timestamp immediately prior to the incident, or restore the latest S3 logical backup into a replica instance.
3. Update `DATABASE_URL` in GCP Secret Manager.
4. Deploy a new Cloud Run revision pointing to the restored database.
5. Run Prisma migrations: `npm run prisma:migrate:deploy`.
6. Verify smoke tests and restore public traffic.
