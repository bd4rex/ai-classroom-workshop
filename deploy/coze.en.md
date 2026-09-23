# Coze multi-instance deployment and 500-student classrooms

[中文](coze.md) · [README](../README.en.md)

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

Platform references: [Database integration](https://docs.coze.cn/guides_integrate_database), [Web deployment](https://docs.coze.cn/guides_deploy_vibe_web).
