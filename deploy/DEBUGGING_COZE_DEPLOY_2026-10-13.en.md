# Two failed Coze releases: preparing the production schema

[中文](DEBUGGING_COZE_DEPLOY_2026-10-13.md) · [Deployment guide](coze.en.md) · [Handoff log](../TIMESTAMP_LOG.en.md)

## Verified state

On 2026-10-13, inspected raw deployment logs, public health endpoints, and read-only production database queries in the user's open Coze projects. These are observations, not a subsequent release claim.

| Coze project title | Production origin | Running release | Failed release | Production PostgreSQL submissions |
| --- | --- | --- | --- | --- |
| AI教室工作坊网站 2 | `https://ai5class.coze.site` | `0.5.0`, `e396bbd0df`; health explicitly reports PostgreSQL / polling | `9032dd1571`, `0.7.0`; failed at 12:06:30 | 1 total: 0 visible, 1 removal receipt |
| AI课堂工作坊网站 | `https://ai4class.coze.site` | `0.4.0`, `cb1af78af4`; health omits storage type | `c9a56d8a5d`, build reports `0.8.0`; failed at 12:23:02 | 16 total: 14 visible, 2 removal receipts |

Times are Asia/Shanghai. Both health endpoints returned HTTP 200. The older site's health omits storage, so records in its production PostgreSQL do not establish that its running application uses that database. Verify runtime configuration and the complete data source before upgrading.

Both production `submissions` tables have the old seven columns, no `activity_id`, `UNIQUE(participant_id,kind)`, and a kind check permitting only `discover/design`. Queries retrieved counts and schema, not student content or credentials. Existing incomplete SQL drafts were preserved; separate SELECT snippets were created. No deletion or production migration was executed.

GitHub `main` was `3a98f56` / `0.7.0`. The original project's `0.8.0` includes separate platform-side work; a larger version number does not establish deployment, and importing upstream must preserve those changes. Project 2 also has documentation commit `7ce857c`, distinct from its failed deployment revision.

## Confirmed failure

Both deployment logs report:

```text
[deploy] [database] / [launch]
sync public schema failed: code=170000015
modify "submissions" table:
ERROR: column "activity_id" of relation "submissions" contains null values
(SQLSTATE 23502)
```

The original project's log explicitly shows successful Vite and build pipelines before the database error. This failure occurs in schema synchronization, not that frontend build. There is no evidence that reducing replicas, raising concurrency, or cleaning disk space would fix this constraint failure.

The application migrates by adding a nullable column, backfilling from `kind`, then enforcing NOT NULL. Coze first copies the development database's **final schema** into production. Applying the new NOT NULL column to existing records fails before the application can run its backfill. A working development environment does not establish production upgrade success. [Coze's documentation](https://docs.coze.cn/guides_integrate_database) describes independent environments and schema-only synchronization on subsequent releases; the raw logs establish this incident's failed stage.

Previous tests covered application-startup migration but omitted platform schema synchronization before startup. This record adds the missing deployment prerequisite, reproduction, and preparatory SQL. Clearing existing submissions is unnecessary to resolve this error; removal receipts should also remain to preserve submission state.

## Data-preserving maintenance sequence

This procedure was validated in an isolated database. **It has not been executed against either production database, and neither project was redeployed.**

1. Identify the project, domain, production database, running code, and actual data source separately. If the older site still writes SQLite, preserve its actual production files and reconcile existing PostgreSQL using the [storage migration guide](coze.en.md#preserve-existing-classrooms-and-responses); do not overwrite or repeat import.
2. Stop all old instances and other submission writers during maintenance and obtain a restorable full backup. Response CSV is not a substitute for sessions, credentials, and metadata. The original project's database overview displayed a zero-hour restore window; no available recovery point was validated, so a backup must be established first.
3. In the intended project's Database → Production → SQL Query panel, run the [read-only preflight](sql/coze-activity-id-preflight.sql). Save current counts/schema; historical counts in this document are not live assertions.
4. Once backup and write suspension are verified, the maintenance owner can approve and run the complete [pre-migration SQL](sql/coze-activity-id-premigration.sql). It only adds `activity_id`, backfills NULL from `kind`, and enforces NOT NULL. It leaves content, removal markers, room IDs, credentials, sessions, old uniqueness, and kind constraints unchanged. Execute the whole file in one transaction/connection, with a five-second lock wait and 30-second statement timeout. After an error, ROLLBACK before investigating; do not resume with selected middle statements.
5. Repeat preflight: total, visible, and removal counts must match; the column list must include `activity_id:NO`. Publish the selected new code so the platform synchronizes remaining schema and the application upgrades uniqueness, kind constraints, and activity configuration. Keep each project's own code and database; do not copy development data over production.
6. Validate the actual production version, PostgreSQL / polling, existing password and refresh, fixed student link, original submissions/receipts, repeated-type activities, and per-activity result gates. Reopen the classroom only after acceptance; record deployed commit and results.

**After pre-migration commits, old code cannot submit because it omits activity_id.** Never execute this during a live lesson or as an automatic build step. Mixed old/new writers remain unsupported. If publication fails, keep writes stopped and investigate; rollback requires a complete backup and corresponding old code, not just a Git revert.

## Alternatives and boundaries

- Making the development column nullable can avoid this NOT NULL conflict, but requires coordinated changes to table creation/startup migration, write/uniqueness validation, and old/new handover tests. Unchecking NOT NULL in the panel alone is undone by application startup. That architecture change was not implemented here.
- No reliable setting to disable platform schema synchronization was verified; do not assume this option exists.
- Clearing submissions loses responses or receipts and was not performed. The projects' identities, data, domains, and deployment records are independent.

## Reproduction and validation

`test/coze-upgrade.test.js` uses a random isolated schema and synthetic records only:

1. Prepare two old responses and one cleared removal receipt with the legacy two-kind check and participant/kind uniqueness.
2. Add `activity_id TEXT NOT NULL` before app startup, reproduce `23502`, and verify no partial column remains.
3. Run the delivered SQL with only `public` replaced by the test schema. Verify preservation of the seven old columns, rooms, identities, sessions, and metadata; correct backfill for all three records; NOT NULL; repeatability; and preservation of existing custom IDs.
4. Run existing application migration, verify the database accepts one student's records for two same-type activities, and verify removed content stays cleared. Existing regressions also passed for the complete application submission flow.

```bash
# Use a dedicated local database; provide credentials through the environment.
node --test test/coze-upgrade.test.js
npm run check
# Set TEST_DATABASE_URL to exercise the PostgreSQL cases.
npm test
```

See [sanitized evidence](evidence/coze-deployment-2026-10-13.json) for results and commands. Application runtime code, version, production credentials, replicas, and data were not changed. Local SQL validation is not completed Coze deployment.
