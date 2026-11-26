# SyllabusSOS++ Production & Hackathon Deployment Guide

This document details the configuration, security, persistence, deployment steps, and rollback procedures for **SyllabusSOS++**.

---

## 1. Architecture Overview & Decision Guide

SyllabusSOS++ is built with vanilla ES modules on Node.js 22+ with **zero third-party npm runtime dependencies**, leveraging built-in standard libraries (`node:http`, `node:sqlite`, `node:crypto`).

### Option A: Persistent Node.js Host + Persistent Volume + SQLite (Recommended for Hackathons)
- **Target Providers**: Render Web Service, Railway, Fly.io, DigitalOcean App Platform / Droplet, or Ubuntu VPS.
- **Why It Is Recommended**:
  1. **Durable Persistence**: Keeps SQLite database on a persistent mounted disk/volume (e.g. `/var/data/syllabussos.db`).
  2. **Zero Moving Parts**: No external database driver, connection pooler, or ORM dependency required.
  3. **Same-Origin Simplicity**: Serves static pages (`public/`, `views/`) and JSON APIs (`/api/*`) from the exact same domain, avoiding CORS preflight overhead and cross-site cookie restrictions.
  4. **Background Settlement**: Runs the built-in 5-minute `autoSettle()` scheduler inside the running process for automatic 72-hour session releases and expired booking cleanup.
- **Concurrency Rule**: Run **one application instance/process** (`replicas: 1`). SQLite WAL mode allows concurrent readers and serialized writers within a single host, but cannot span multiple ephemeral containers on network shares.

### Option B: Netlify Frontend + Serverless Functions + Managed PostgreSQL (Scale Production)
- **Target Providers**: Netlify (Frontend CDN + Serverless Functions) + Managed PostgreSQL (Neon, Supabase, AWS RDS).
- **Critical Durability Notice**:
  > Netlify Functions run in ephemeral AWS Lambda microVMs where `/tmp` is temporary, instance-local scratch storage. Files written to `/tmp` **disappear** when an execution environment recycles and are **not shared** across parallel lambda instances. Therefore, local SQLite in `/tmp` must **never** be used as the production source of truth for accounts, credits, or bookings.
- **Production Architecture**:
  1. Frontend static files published to Netlify CDN from `public/`.
  2. Serverless functions in `netlify/functions/api.js` proxying requests through a shared framework-neutral API dispatcher.
  3. Persistence migrated to a managed PostgreSQL cluster with schema migrations and transactions.
  4. Automatic settlement triggered via Netlify Scheduled Functions (Cron) invoking `POST /api/admin/settle` with `X-Settlement-Key`.

---

## 2. Environment Variables Specification

Set these variables in your hosting provider's encrypted environment settings dashboard. **Never commit `.env` or paste real secrets into public chats or version control.**

| Variable | Environment | Example / Format | Purpose |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | All | `production` or `development` | Enables strict CSP, HSTS, secure cookies, and error obfuscation. |
| `APP_SECRET` | Production | 48+ char base64url string | Session HMAC signing key and internal settlement trigger authorization. |
| `PUBLIC_URL` | Production | `https://syllabussos.yourdomain.com` | Canonical public URL used for redirects, allowed Host validation, and links. |
| `ALLOWED_HOSTS` | Production | `syllabussos.yourdomain.com` | Exact comma-separated hostnames accepted by the HTTP server (no scheme/path). |
| `CORS_ORIGINS` | Multi-host | `https://syllabussos.yourdomain.com` | Explicit trusted browser origins allowed to call API. Wildcard `*` is forbidden. |
| `TRUST_PROXY` | Proxy/Container | `true` or `false` | Set `true` only when running behind a trusted reverse proxy (Render, Nginx, Cloudflare). |
| `DATABASE_PATH` | Option A | `/data/syllabussos.db` | Path to persistent SQLite database on mounted volume. |
| `DEMO_MODE` | Demo | `true` | When `true`, wallet credits are explicitly marked as demo credits with no monetary value. |
| `PAYMENTS_MODE` | Demo | `test` or `off` | Controls wallet top-up behavior. Set `test` for demo credits, `off` for production. |
| `PLATFORM_FEE_PERCENT` | All | `10` | Percentage fee retained on completed tutoring sessions (default 10%). |
| `RADAR_MIN_RESPONSES` | All | `5` | Minimum aggregate responses before teacher difficulty radar surfaces topics. |
| `SESSION_DAYS` | All | `7` | Session lifetime in days (default 7 days). |
| `ADMIN_EMAIL` | Bootstrap | `admin@yourcampus.edu` | Initial administrator email (used during `npm run seed` or first start). |
| `ADMIN_PASSWORD` | Bootstrap | Temporary strong password | Initial admin password. Remove from environment after first bootstrap. |

---

## 3. Deployment Instructions: Option A (Persistent Node.js Host)

### Render / Railway / Fly.io Configuration

1. **Repository**: Push clean repository (excluding `.env` and `data/*.db`).
2. **Runtime**: Node.js 22.x or later.
3. **Build Command**:
   ```bash
   npm run check-env && npm test
   ```
4. **Start Command**:
   ```bash
   npm start
   ```
5. **Persistent Disk / Volume**:
   - Mount a persistent volume at `/data` (e.g. 1GB disk).
   - Set environment variable: `DATABASE_PATH=/data/syllabussos.db`.
6. **Health Check Path**:
   - HTTP GET `/` (returns HTTP 200).
7. **Instance Count**:
   - Set instance count to **1** to ensure single-process SQLite WAL locking integrity.

---

## 4. Deployment Instructions: Option B (Netlify Deploy)

If deploying the static frontend and serverless API to Netlify:

1. **Publish Directory**: `public`
2. **Functions Directory**: `netlify/functions`
3. **Build Command**:
   ```bash
   npm run check-package
   ```
4. **Deploy Configuration (`netlify.toml`)**:
   - All `/api/*` requests route automatically to `/.netlify/functions/api`.
   - Security headers (CSP, HSTS, X-Content-Type-Options) are applied at CDN edge.
5. **Scheduled Settlement**:
   - To trigger auto-settlement every hour on Netlify, configure a scheduled function or external cron to send:
     ```http
     POST https://your-site.netlify.app/api/admin/settle
     X-Requested-With: sos
     X-Settlement-Key: <YOUR_APP_SECRET>
     ```

---

## 5. Security & Verification Checklist

Before publishing your deployment, verify the following gates:

1. **Automated Test Suite**:
   ```bash
   npm test
   ```
   *Expected*: All 37 automated tests pass (0 failures).
2. **Static Security Audit**:
   ```bash
   npm run audit
   ```
   *Expected*: All 22 checks pass (no inline scripts, no innerHTML, strict CSP, scrypt password hashing).
3. **Secret Leak Scanner**:
   ```bash
   npm run scan-secrets
   ```
   *Expected*: 0 secrets found across working files.
4. **Package Hygiene Gate**:
   ```bash
   npm run check-package
   ```
   *Expected*: Confirms `.env`, `.db`, `.key`, and `.pem` are excluded from the distribution bundle.

---

## 6. Database Migrations, Backup & Recovery

### Automated Schema Migrations
- Schema creation and incremental column additions run idempotently at server boot in `server/db.js`.
- Newly introduced columns (`phone`, `college_name`, `college_place`, `degree`, `semester`, `student_id`, `designation`, `faculty_id`, `cabin`, `tutor_type`) migrate automatically on first connection without data loss.

### Hot SQLite Backup
To take a zero-downtime, transactionally consistent snapshot of the live database:
```bash
# Using Node sqlite or sqlite3 CLI
sqlite3 data/syllabussos.db ".backup 'data/backup-$(date +%Y%m%d-%H%M%S).db'"
```

### Restore Procedure
1. Stop the application server (`SIGTERM` or stop service).
2. Archive the current corrupted/outdated database:
   ```bash
   mv data/syllabussos.db data/syllabussos.corrupt.db
   ```
3. Copy the verified backup file into place:
   ```bash
   cp data/backup-YYYYMMDD-HHMMSS.db data/syllabussos.db
   ```
4. Restart the application server (`npm start`).
5. Run `npm run check-env` to verify database connectivity.

---

## 7. Rollback Procedures

### Application Rollback
1. In your hosting dashboard (e.g. Render, Railway, Netlify), locate the **Deploys** or **Releases** tab.
2. Select the previous green build commit/tag.
3. Click **Rollback / Redeploy**.
4. The previous static assets and server code will be restored immediately without modifying the mounted SQLite persistent volume.

### Emergency Kill Switch
- If unexpected activity occurs, set `PAYMENTS_MODE=off` in your environment variables and redeploy to instantly freeze all credit creation and escrow transfers while preserving student access and syllabus materials.

---

## 8. Honest Representation & Claims
- **Demo Credits**: All credits inside this platform are educational demo credits and carry **no cash value**. Real money bank withdrawals and payment gateway integrations are not active.
- **Study Missions**: Study missions and practice checks are generated by deterministic, rule-based algorithms based on syllabus concepts and quiz scores, not ungrounded black-box generative AI models.
