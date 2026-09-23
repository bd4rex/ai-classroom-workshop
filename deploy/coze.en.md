# Coze multi-instance deployment and 500-student classrooms

[中文](coze.md) · [README](../README.en.md) · [Investigation record](DEBUGGING_2026-09-23.en.md)

## Fast path for a new project

1. Import merged `main` and verify its Git commit. Require Node.js 24+ and use `pnpm` in Coze.
2. Create the default PostgreSQL database in the database panel. Reconnect the sandbox and open a new terminal if PG variables are missing. Check presence only, never values.
3. Back up the platform's `.coze`, then adapt the [credential-free template](coze.toml.example). Restrict development `--watch-path` to avoid Vite restart loops. Production must require shared storage.
4. Keep `DATABASE_SCHEMA=public` so platform schema synchronization can discover tables. Migrate existing data before starting the application. Empty storage creates a new classroom. Configure an initial password through the platform environment, outside Git; it never overwrites a stored password.
5. Run `pnpm install` and `pnpm run check`. Default checks skip PostgreSQL-specific tests; use the safe test invocation below to validate shared storage.
6. Development health must report version `0.5.0`, `storage: postgres`, and `syncMode: polling`. Open `/teacher` in a standalone tab, sign in, copy the student link, and exercise both topics in another browser context.
7. Select the production database when publishing. Do not copy development student exercises into a new production database or overwrite existing production data. These are separate databases.
8. Validate the actual production domain after publishing. A deployment-success indicator does not replace health, session, and stable-link checks. Record commit, time, environment, outcomes, and remaining work.

## Existing-project upgrade order

Proceed in order: **identify production source → stop writes and back up → inspect → import into empty target → compare original fields → update code/configuration → start → validate**. Do not initialize a fresh classroom before importing the old one.

Sandbox files are not a production backup. Preserving production SQLite requires files from the actual production instances or platform backups. If production terminal/backup access is unavailable, resolve access first without overwriting deployment. Two old replicas may contain different records; do not arbitrarily choose one.

## Why shared storage is required

Version 0.4.x stores sessions, classroom IDs, and responses in local SQLite. When two replicas each use `/tmp`, signing in on A does not authenticate requests routed to B, and a classroom link from A may not exist on B. Recreated temporary storage loses data. Version 0.5.0 shares these records through PostgreSQL and polls every 2.5–3.5 seconds, so 500 online students no longer each hold a persistent SSE request.

## Coze configuration

1. Open the project's Database panel and create its default database. Coze separates development and production PostgreSQL; a working development connection does not establish production readiness.
2. The app recognizes standard `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, and `PGSSLMODE`. `DATABASE_URL` and `PGDATABASE_URL` are also supported. Never put connection secrets in Git, chats, or logs.
3. Use the default `public` schema so Coze's schema synchronization can discover the app tables. Tests use separate schemas. Each instance has at most 10 database connections, or 20 across two replicas.
4. Set `REQUIRE_SHARED_DATABASE=true`, `SYNC_MODE=polling`, and `COOKIE_SECURE=true` in production. Set `PUBLIC_URL` to the actual student-facing origin. Multiple trusted origins may be comma-separated; the first generates shared links. Do not include internal ports or paths.
5. Start production with `node --env-file-if-exists=.env server/index.js`, using the platform's configured listening port. Preserve the existing initial teacher-password configuration; it never overwrites a password already stored in the shared database. Coze uses `pnpm install` and `pnpm run build`.
6. Remove legacy `DATA_DIR=/tmp/...` injection from `.coze` if present. `REQUIRE_SHARED_DATABASE` prevents missing database settings from silently creating a temporary classroom.
7. Open teacher and student pages in standalone browser tabs. HttpOnly / SameSite=Strict cookies remain enabled. Restricted preview iframe cookies produce a clear message, and students do not repeatedly rejoin through polling.

Replica count multiplied by per-instance concurrency is not an online-user limit: it limits simultaneously processed requests. Whether 2 × 100 accommodates 500 students depends on latency, gateway queuing, database networking, and resources. Use shared storage and short requests first, then validate an isolated classroom on the target platform. Production capacity is not guaranteed without that test.

## Safely check database integration

This command outputs variable names and presence only:

```bash
node -e 'console.log(Object.fromEntries(["PGHOST","PGPORT","PGUSER","PGPASSWORD","PGDATABASE","PGSSLMODE","DATABASE_URL","PGDATABASE_URL"].map(k=>[k,Boolean(process.env[k])])));'
```

Run shared-storage tests against development or a dedicated test database, never formal production data. This invocation builds a connection string in memory and passes it to the child process without printing it. Tests create and remove their own schemas, so schema-creation permission is required.

```bash
node --input-type=module -e 'import {spawnSync} from "node:child_process";let connection=process.env.DATABASE_URL||process.env.PGDATABASE_URL;if(!connection){if(!process.env.PGHOST||!process.env.PGDATABASE)throw new Error("Missing PG environment");const u=new URL("postgresql://localhost");u.hostname=process.env.PGHOST;u.port=process.env.PGPORT||"5432";u.username=process.env.PGUSER||"";u.password=process.env.PGPASSWORD||"";u.pathname="/"+process.env.PGDATABASE;connection=u.href;}const r=spawnSync("pnpm",["run","check"],{env:{...process.env,TEST_DATABASE_URL:connection},stdio:"inherit"});process.exitCode=r.status??1;'
```

Expected: 40 passed, zero failures, and a successful build. Without `TEST_DATABASE_URL`, SQLite checks report 37 passed and three skipped; this does not validate shared storage. Do not print secrets with `env`, `printenv`, or `set -x`.

## Preserve existing classrooms and responses

Stop old classroom writes and back up the actual production instances' complete SQLite data. Verify the current classroom ID, table counts, and teacher password. Development SQLite is not a production backup. If replicas diverged, select or reconcile the correct source before migration; never replace formal data with development examples.

The app provides read-only inspection and a one-time import. Back up first. Target application tables must be empty and the application must not have initialized them; the tool refuses to overwrite existing classrooms. It preserves IDs, legacy link mappings, password hashes, sessions, identities, submission IDs, and removal receipts without restoring cleared content.

```bash
# Supply credentials through environment variables, not command text.
node --env-file-if-exists=.env scripts/migrate-postgres.js /secure-backup/classroom.sqlite
node --env-file-if-exists=.env scripts/migrate-postgres.js /secure-backup/classroom.sqlite --apply
```

Inspection reports counts only and does not write the target. Import is one transaction and rolls back on failure. Start the service only after a successful import; retain the source backup. Existing production PostgreSQL must be reused, never reimported or replaced with development data.

Code cannot recover responses or classroom mappings from already-lost production temporary files. Check backups and exported CSV files before choosing a recovery plan; do not silently replace shared links.

## Acceptance and rollback

- Verify `/api/health` on the actual production origin: `storage: postgres`, `syncMode: polling`, version `0.5.0`.
- Teacher authentication and shared links must survive alternating requests, refreshes, and replica restarts.
- Unsubmitted students cannot read peers; students follow the teacher on the next poll; deletion removes content from both audiences and exports.
- 500 students polling every 3 seconds average roughly 167 state requests per second, plus joins, submission bursts, and list requests.
- `TEST_DATABASE_URL=... npm run test:load` only accepts a local database and creates/removes an isolated synthetic schema. It never stress-tests production.
- Before reverting to SQLite, stop writes and reconcile any new PostgreSQL data. A code-only rollback makes newer records temporarily invisible. Keep both database backups; database rollback is more than reverting a Git commit.

## Symptoms and next checks

| Symptom | Investigation order |
| --- | --- |
| Correct password followed by sign-out | Check production health for PostgreSQL and verify all replicas share one database; then inspect cookies in a top-level tab. Do not repeatedly reset passwords |
| Newly copied link works but old link fails | Compare classroom IDs, database sources, and classroom creation history. Find the original backup; never redirect an unknown ID to another class |
| Scheduled classroom synchronization | Normal PostgreSQL behavior; confirm students follow teacher controls on the next poll |
| Connection interrupted and retrying | Inspect `/api/session` status/content type, application logs, and database connectivity; HTTP 200 HTML can be a proxy error |
| Concurrent submissions fail | Verify the `room_changes` fix is deployed; inspect sanitized error codes, pool waits, gateway limits, and resource usage, then reproduce in isolation |
| Missing configuration after database creation | Reconnect the sandbox, open a new terminal, and check variable presence; verify the production database binding separately |
| Preview restarts indefinitely | Replace bare `--watch` with the template's two `--watch-path` options |
| Import refuses an existing target | Stop overwrite attempts, identify the data source, and back up. Do not bypass this protection by clearing tables |

Append each release's results to the [handoff log](../TIMESTAMP_LOG.en.md) and maintain [validation evidence](../TEST_REPORT.en.md). See the [complete investigation](DEBUGGING_2026-09-23.en.md) for this incident.

Platform references: [Database integration](https://docs.coze.cn/guides_integrate_database), [Web deployment](https://docs.coze.cn/guides_deploy_vibe_web).
