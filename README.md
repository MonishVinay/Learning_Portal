# Scholar

A responsive Teacher–Student workspace built with Next.js App Router, TypeScript, Tailwind CSS, Prisma, external PostgreSQL, and private Cloudflare R2. No AI services. No exam-taking platform. Empty states reflect real data; no demo records are seeded.

## Run locally

1. Install Node.js 22 LTS or newer. Create a PostgreSQL database and private R2 bucket.
2. Copy `.env.example` to `.env`; fill every required value. Generate `AUTH_SECRET` with the command in that file. Set `APP_URL=http://localhost:3000`.
3. Run `npm ci`, `npm run db:deploy`, and `npm run dev`.
4. Sign in as `teacher` with the **exact** value of `TEACHER_INITIAL_PASSWORD` (initial requested value: `teacher @123`, including the space). Set a new password when prompted. Add student accounts in **Students**; each student must change their temporary password too.

The bootstrap command creates the teacher only if missing. It never changes an existing password, resets tables, or inserts demo data. Remove `TEACHER_INITIAL_PASSWORD` from the running service after first creation if desired. To reset a forgotten teacher password, use a database administrator to replace only that user's bcrypt hash and revoke their sessions; do not reset the database.

## Deploy: GitHub → Render

1. Push this entire folder, including `package-lock.json` and `prisma/migrations`, to a private GitHub repository. Do **not** commit `.env`.
2. Provision persistent external PostgreSQL (Render PostgreSQL, Neon, Supabase, etc.). Use its TLS connection URL as `DATABASE_URL`; use a migration-capable connection (not a transaction pooler) for deployments. Choose a database plan that does not expire or delete data when idle.
3. In Cloudflare, create a **private** R2 bucket. Leave public access off. Create an API token limited to object read/write for that bucket. Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET`.
4. Create a Render **Blueprint** from this repository using `render.yaml` (Starter web plan supports the pre-deploy command), or create a Node web service with:
   - Build: `npm ci --include=dev && npm run build`
   - Pre-deploy: `npm run db:deploy`
   - Start: `npm run start:render`
   - Health check: `/api/health`
5. Set `APP_URL` to the exact HTTPS Render URL or custom domain, without a trailing path. Set a random `AUTH_SECRET` (32+ characters), `TEACHER_INITIAL_PASSWORD` to `teacher @123`, `TEACHER_NAME`, the database URL, and the R2 variables above. The Blueprint generates `AUTH_SECRET` and `CRON_SECRET`. Never change `AUTH_SECRET` routinely: doing so signs out existing sessions.
6. Configure R2 CORS for the exact app origin (below). Deploy, sign in, change the teacher password, create a student, and test one file upload/download. Use a separate non-production database and bucket for staging.

Free Render web services do not support a pre-deploy command. If using a free web service manually, use build `npm ci --include=dev && npm run build` and start `npm run db:deploy && npm run start:render`; safe migrations/bootstrap run before accepting traffic. A paid service with pre-deploy migrations is recommended. No persistent disk is required. All permanent records live in PostgreSQL; file bytes live in R2. Server restarts and redeployments preserve both, provided the external resources remain intact.

### R2 CORS

Replace origins with your actual HTTPS app origin; include localhost only for development. In R2 bucket settings → CORS policy:

```json
[
  {
    "AllowedOrigins": ["https://YOUR-SERVICE.onrender.com", "http://localhost:3000"],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["Content-Type", "If-None-Match", "x-amz-*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

The browser uploads directly using ten-minute signed PUTs. Uploads are stored under random immutable keys. A conditional PUT prevents overwriting the object on retry. The server verifies object size, MIME type and magic bytes before the file can be attached. Only authenticated owners may finalize pending uploads; role and recipient checks protect every download. Read URLs expire after two minutes; like all signed URLs, anyone holding one can use it until expiry. Inline previews support PDF/JPG/PNG; Word files download. Files are not antivirus scanned; use trusted accounts and add external malware scanning before onboarding untrusted uploaders. Maximum file size defaults to 20 MB (`MAX_UPLOAD_MB`); up to 12 new attachments per operation and 100 upload requests per user per hour.

Interrupted PUTs can be retried by selecting the same file again in the same tab; upload IDs are retained in session storage. Verified attachments and unsaved form fields are stored in per-user local drafts. Submission requests carry an idempotency key; database locks and unique constraints prevent duplicate versions. Original answer files and earlier versions are never overwritten. Existing assignment attachments/recipients cannot be removed through edits. Use a private device or clear browser site data on shared devices to remove local drafts. Credentials are never saved in drafts.

## Daily operations

- **Assignments:** create, schedule, edit, reuse templates, duplicate, repeat daily/weekly, and assign to one or more students. Students upload multiple answers and resubmit a new immutable version. Teachers review any version, approve, request corrections or grade. Complete ZIP contains assignment originals and all answer versions, with a history manifest.
- **Exams:** manually record external exam marks and weak topics, save drafts, publish/unpublish, upload existing reports, and generate multi-page PDF report cards. Weighted totals, grades and performance charts use saved results.
- **Daily briefs:** one afternoon plan and one editable evening reflection per student/local date. Every goal gets a completion outcome. Past dates are supported and labeled late; original plans lock after reflection. Teachers comment on the record. Default timezone is Asia/Kolkata.
- **Progress:** real assignment/brief statistics, seven-day activity, subject scores, XP, achievement badges, optional streaks, revision reminders and a reload-resilient optional timer. XP is calculated from approved/graded latest submissions (+25), completed reflections (+10), and mastered topics (+15); it never duplicates on resubmission.
- **Archive:** server-side search across the full assignment/result history, including submission versions, file downloads and complete ZIPs. Search returns up to 100 matching records per category; refine the search for older records. Normal workspace panels show the most recent 500 records; notifications show the last 100.
- **Accounts:** secure HttpOnly sessions, exact-origin CSRF checks, role/recipient authorization, bcrypt password hashing, database-backed login throttling, forced first-login password change, password resets, session revocation, account disable/enable and user timezones.

### Recurring tasks and reminders

Run `npm run jobs` every 15 minutes from a Render Cron Job or external scheduler with the same database environment. Alternatively set a 32+ character `CRON_SECRET` and send `POST /api/jobs` with `Authorization: Bearer YOUR_SECRET` from a trusted scheduler. That endpoint intentionally uses bearer authentication instead of browser origin checks. Never put this secret in client code or URLs.

On workspace load, the same job runs at most once per five minutes as a fallback. Advisory locks and notification keys make duplicate runs safe. Jobs release recurring copies, notify about assignments/deadlines, remind students about afternoon briefs after 16:00 and reflections after 21:00 local time, and flag revisions. A sleeping instance cannot run background jobs on its own. Without a scheduler, reminders/recurrences catch up at the next workspace load, not while nobody is using the app. Recurrences use fixed 24-hour/7-day intervals from the original release (appropriate for Asia/Kolkata, which has no DST); catch-up is bounded to 15 occurrences per recurring root per invocation. Changing a parent changes future copies; existing copies remain intact. Disable repetition on the parent to stop future copies.

## Backups and restoration

**No automated backup is active merely by deploying this repository.** Configure and verify these separately:

1. Enable your PostgreSQL provider's automated backups/PITR with an appropriate retention window. Schedule a daily `pg_dump --format=custom` to a separate encrypted backup destination. Supply credentials through the environment/secret manager; never paste them into tracked scripts. Test `pg_restore` into an isolated database regularly. This preserves accounts, password hashes, sessions, relations, versions and all records.
2. Schedule a copy of the R2 bucket to a **different backup bucket/account** using a private S3-compatible backup client such as rclone. Retain immutable historical snapshots; a simple deletion-propagating mirror alone is not a backup. Give the application token no access to the backup destination. Record and verify checksums. Restore object keys exactly as stored in `FileAsset`.
3. Settings → **Export data** downloads a JSON metadata export plus file manifest. The teacher export includes all records without passwords or sessions; a student sees authorized records. This is a portable reference, **not a substitute for a full database dump and file backup**. Keep exports private. Download Complete ZIP offers assignment-level file exports.
4. Restore the database and R2 objects into staging, verify permissions/downloads, then switch production environment variables. Never run `prisma migrate reset` or `db push --force-reset` on a production database. Use `prisma migrate deploy` only; create future migrations in development and take a backup before schema changes.

Unattached pending or verified uploads are retained so interrupted drafts can recover. If storage cleanup is needed, audit `FileAsset` rows with all three attachment IDs null, allow a generous retention period, and delete only confirmed abandoned objects; a shared object key may be referenced by recurring/duplicated assignments. No automatic file deletion is implemented.

## Validation

`npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, then `npm run test:smoke`.
Tests cover upload restrictions/signatures, filename safety, date/timezone boundaries, recurrence boundaries, origin protection, password/session hashing, student visibility rules and report generation. The production HTTP smoke test starts and stops a temporary local server to check login rendering, security headers, private-page redirects, anonymous API denial and cross-origin rejection. No browser automation or GUI testing is used. Full database/R2 deployment checks require configured live services. Verify teacher/student access boundaries, uploads, a resubmission, grades, ZIP contents, result publication, a report PDF, both briefs, and restart persistence against a staging database/bucket before daily use.
