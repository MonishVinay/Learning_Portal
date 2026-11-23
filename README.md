# Scholar

A responsive Teacher–Student workspace built with Next.js App Router, TypeScript, Tailwind CSS, Prisma, Supabase PostgreSQL, and private Supabase Storage. Runs on Render Free with Supabase Free; no paid add-ons or new SDK dependencies are required. Authentication, database models, migrations and learning features are unchanged.

## Run locally

1. Install Node.js 22 LTS or newer. Use your Supabase Free project and existing private bucket `learning-portal-files`.
2. Copy `.env.example` to `.env`; fill every required value. Generate `AUTH_SECRET` with the command in that file. Set `APP_URL=http://localhost:3000`.
3. Run `npm ci --include=dev`, `npm run db:deploy`, and `npm run dev`. Prisma and bootstrap load `.env`; standalone `npm run jobs` needs the same values loaded into the terminal environment. On Render, variables are injected automatically.
4. Sign in as `teacher` with the **exact** value of `TEACHER_INITIAL_PASSWORD` (initial requested value: `teacher @123`, including the space). Set a new password when prompted. Add student accounts in **Students**; each student must change their temporary password too.

The bootstrap command creates the teacher only if missing. It never changes an existing password, resets tables, or inserts demo data. Remove `TEACHER_INITIAL_PASSWORD` from the running service after first creation if desired. To reset a forgotten teacher password, use a database administrator to replace only that user's bcrypt hash and revoke their sessions; do not reset the database.

## Deploy manually: Render Free + Supabase Free

1. When ready, push this folder, including `package-lock.json` and the existing `prisma/migrations`, to your GitHub repository yourself. Do **not** commit `.env`. This update does not push or deploy anything.
2. In Supabase **Connect → Session pooler**, copy the connection string on **port 5432**. Use the actual pooler hostname shown for your project, username `postgres.YOUR_PROJECT_REF`, your **database password** (URL-encoded), and database `postgres`. Append `?sslmode=require&connection_limit=3` (or `&...` if the URL already has a query). This IPv4-compatible URL is `DATABASE_URL` for both this persistent Node server and Prisma migrations. No `DIRECT_URL`, IPv4 add-on, ORM replacement, or new schema is needed. Do **not** use transaction mode on port 6543 for migrations/advisory locks. See [Supabase's Prisma guide](https://supabase.com/docs/guides/database/prisma).
3. Keep `learning-portal-files` **private**. In Storage bucket settings, allow the existing PDF/JPEG/PNG/DOC/DOCX/TXT MIME types and a file size of at least 20 MB (or lower `MAX_UPLOAD_MB` to match). No public bucket or anonymous storage policies are needed. Audit existing `storage.objects` policies so `anon`/`authenticated` cannot directly read or write this bucket: the portal uses its own sessions, not Supabase Auth. Obtain the project URL and server-only legacy `service_role` key from **Settings → API Keys → Legacy API keys**. Supabase's hosted Storage endpoint handles CORS; remove the old R2 CORS setup.
4. Secure the database's independent Data API **before** starting the portal. For a project dedicated to this app, open **Data API integration → Enable Data API** and turn it off; Prisma SQL connections and the separate Storage API are used here. If other apps need Data API access, instead enable RLS with no `anon`/`authenticated` policies on every portal table (including sessions, login buckets and `_prisma_migrations`), and audit grants/functions. Do not leave Prisma-created `public` tables exposed. [Supabase's security guide](https://supabase.com/docs/guides/api/securing-your-api) explains these controls.
5. In Render create a **Web Service**, connect the repository, choose **Node** and the **Free** instance type. Alternatively use the supplied `render.yaml` Blueprint, which declares only a free web service, with no database, disk, cron service or paid pre-deploy command. Commands:
   - Build: `npm ci --include=dev && npm run build`
   - Start: `npm run db:deploy && npm run start:render`
   - Health check: `/api/health`
6. Set the environment variables below in Render. `APP_URL` must match your actual HTTPS `onrender.com` origin with no path; update it once Render assigns the address. Preserve your existing `AUTH_SECRET` and teacher credentials on an existing installation. Only a brand-new database needs `TEACHER_INITIAL_PASSWORD=teacher @123` (including the space). The Blueprint generates secrets for a new service; copy the existing secret instead when replacing an existing service.
7. Deploy manually when ready. Sign in, test an upload, file preview/download, a resubmission and complete ZIP, then restart and confirm records remain. All records stay in Supabase PostgreSQL and all bytes stay in Storage; Render's ephemeral disk holds no permanent data.

Startup runs the existing `prisma migrate deploy` and idempotent teacher bootstrap **before** the web server accepts traffic. A migration failure stops startup; it does not fall through to starting an incompatible app. Already applied migrations are skipped and existing users/passwords/data are preserved. Do not run `migrate reset`, force-reset `db push`, or edit applied migrations. If tables already exist without Prisma migration history, review and baseline their matching migrations first; do not reset or blindly mark unknown schemas as applied.

### Exact environment variables

Use `.env.example` as the template. No actual credentials are included or modified by this update.

| Variable | Render value |
| --- | --- |
| `DATABASE_URL` | Supabase **session** pooler, port 5432, TLS, as above; keep private |
| `SUPABASE_URL` | `https://YOUR_PROJECT_REF.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only legacy `service_role` key; **never** `NEXT_PUBLIC_*`, a public/anon key, or the database password |
| `SUPABASE_STORAGE_BUCKET` | `learning-portal-files` |
| `APP_URL` | Exact `https://YOUR-SERVICE.onrender.com` origin |
| `AUTH_SECRET` | Existing value, or a new random 32+ character secret for a new installation |
| `TEACHER_INITIAL_PASSWORD` | Required only when creating the teacher; existing teachers are never reset |
| `TEACHER_NAME` | Initial display name, default `Teacher` |
| `MAX_UPLOAD_MB` | `20` (must not exceed bucket/project limits) |
| `CRON_SECRET` | Optional 32+ character bearer secret for an external scheduler you already use |
| `NODE_ENV` / `NODE_VERSION` | `production` / `22` |
| `PORT` | Supplied by Render automatically; do not set manually |

The server uses built-in `fetch` for Supabase Storage; the removed AWS SDKs are not replaced with another SDK. Service-role headers never reach the browser. Authenticated upload requests receive a token scoped to one random object key with **upsert disabled**, so retries cannot overwrite originals. Supabase's signed upload tokens last two hours; read URLs last two minutes. A URL holder can use that capability until expiry. Server-side size, MIME and magic-byte checks remain mandatory before attachment. Existing owner/role/recipient checks still guard finalization, downloads, previews and streamed ZIPs. PDF/JPG/PNG preview inline; Word files download. Files are not antivirus scanned. Limits remain 12 attachments per operation, 100 uploads per user/hour, and 20 MB per file by default.

Interrupted uploads can be retried by selecting the same file again in the same tab; an already uploaded object is accepted only after server verification. Upload IDs, per-user drafts, submission idempotency and immutable histories are preserved. Credentials are never saved in drafts. Clear site data on shared devices to remove local drafts.

### Existing data and free-plan limits

If files already exist in R2, **manually copy them to `learning-portal-files` with exactly the same `FileAsset.objectKey` paths and Content-Type metadata** before switching production storage. Do not flatten folders or overwrite existing keys; compare sizes/checksums and test ZIP downloads. Existing database rows and IDs stay unchanged. This code change does not copy files, move database records, or delete anything. If moving the database too, back up and restore the existing application tables and `_prisma_migrations` history into Supabase first; do not restore over Supabase's managed `auth`/`storage` schemas.

Render Free sleeps when idle, so the first request can be slow. Supabase Free can pause inactive projects and has storage/database/egress quotas; resume it in the Supabase dashboard if needed and monitor usage. No paid disk, IPv4 add-on, Render database, cron service, or managed backup is required by this setup. Free tiers do not guarantee always-on availability. See [Render Free limits](https://render.com/docs/free) and [Supabase Free limits](https://supabase.com/pricing).

## Daily operations

- **Assignments:** create, schedule, edit, reuse templates, duplicate, repeat daily/weekly, and assign to one or more students. Students upload multiple answers and resubmit a new immutable version. Teachers review any version, approve, request corrections or grade. Complete ZIP contains assignment originals and all answer versions, with a history manifest.
- **Exams:** manually record external exam marks and weak topics, save drafts, publish/unpublish, upload existing reports, and generate multi-page PDF report cards. Weighted totals, grades and performance charts use saved results.
- **Daily briefs:** one afternoon plan and one editable evening reflection per student/local date. Every goal gets a completion outcome. Past dates are supported and labeled late; original plans lock after reflection. Teachers comment on the record. Default timezone is Asia/Kolkata.
- **Progress:** real assignment/brief statistics, seven-day activity, subject scores, XP, achievement badges, optional streaks, revision reminders and a reload-resilient optional timer. XP is calculated from approved/graded latest submissions (+25), completed reflections (+10), and mastered topics (+15); it never duplicates on resubmission.
- **Archive:** server-side search across the full assignment/result history, including submission versions, file downloads and complete ZIPs. Search returns up to 100 matching records per category; refine the search for older records. Normal workspace panels show the most recent 500 records; notifications show the last 100.
- **Accounts:** secure HttpOnly sessions, exact-origin CSRF checks, role/recipient authorization, bcrypt password hashing, database-backed login throttling, forced first-login password change, password resets, session revocation, account disable/enable and user timezones.

### Recurring tasks and reminders

The existing workspace-load fallback needs no scheduler or paid service. If you already have a free/local scheduler, it can run `npm run jobs` with the database environment or send `POST /api/jobs` with `Authorization: Bearer YOUR_CRON_SECRET` (32+ characters). No Render Cron Job is provisioned or required. Never put that secret in client code or URLs.

On workspace load, the same job runs at most once per five minutes as a fallback. Advisory locks and notification keys make duplicate runs safe. Jobs release recurring copies, notify about assignments/deadlines, remind students about afternoon briefs after 16:00 and reflections after 21:00 local time, and flag revisions. A sleeping instance cannot run background jobs on its own. Without a scheduler, reminders/recurrences catch up at the next workspace load, not while nobody is using the app. Recurrences use fixed 24-hour/7-day intervals from the original release (appropriate for Asia/Kolkata, which has no DST); catch-up is bounded to 15 occurrences per recurring root per invocation. Changing a parent changes future copies; existing copies remain intact. Disable repetition on the parent to stop future copies.

## Backups and restoration

**No automated backup is active merely by deploying this repository.** Configure and verify these separately:

1. Supabase Free does not include downloadable managed database backups. Use a local/free scheduler to run `pg_dump --format=custom` through the session pooler (or Supabase CLI export) to a private encrypted backup destination you control. Protect credentials with environment variables. Test restoration of app tables and `_prisma_migrations` into an isolated database. No paid PITR or automated provider backup is assumed. [Supabase backup guidance](https://supabase.com/docs/guides/platform/backups).
2. Back up Storage file bytes **separately** from PostgreSQL; a database dump does not contain them. Use the private file manifest and authenticated downloads/complete ZIPs, or a trusted server-side Storage export tool, retaining object keys, Content-Type metadata and checksums. Store dated copies on a private device/destination you already control. Do not expose the service-role key in browser scripts or backup URLs.
3. Settings → **Export data** downloads a JSON metadata export plus file manifest. The teacher export includes all records without passwords or sessions; a student sees authorized records. This is a portable reference, **not a substitute for a full database dump and file backup**. Keep exports private. Download Complete ZIP offers assignment-level file exports.
4. Restore app tables and Supabase Storage objects into staging, verify permissions/downloads, then switch production environment variables. Never run `prisma migrate reset` or `db push --force-reset` on a production database. Use `prisma migrate deploy` only; create future migrations in development and take a backup before schema changes.

Unattached pending or verified uploads are retained so interrupted drafts can recover. If storage cleanup is needed, audit `FileAsset` rows with all three attachment IDs null, allow a generous retention period, and delete only confirmed abandoned objects; a shared object key may be referenced by recurring/duplicated assignments. No automatic file deletion is implemented.

## Validation

`npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, then `npm run test:smoke`.
Tests cover upload restrictions/signatures, filename safety, date/timezone boundaries, recurrence boundaries, origin protection, password/session hashing, student visibility, report generation and mocked Supabase Storage requests/streams. The production HTTP smoke test starts and stops a temporary local server to check login rendering, security headers, private-page redirects, anonymous API denial and cross-origin rejection. No browser automation or GUI testing is used. Live Supabase database/bucket checks require your configured environment and are not performed by the mocked tests. Verify teacher/student access boundaries, uploads, a resubmission, grades, ZIP contents, result publication, a report PDF, both briefs, and restart persistence before daily use.
