# Two failed Coze releases: preparing the production schema

[中文](DEBUGGING_COZE_DEPLOY_2026-10-13.md) · [Deployment guide](coze.en.md) · [Handoff log](../TIMESTAMP_LOG.en.md)

## Code alignment with GitHub main verified at 14:48

The baseline was GitHub main `a8a439f`, package version 0.7.0. Remote main was re-read at the end and remained unchanged. Checked production health, actual public JS/CSS, and source fingerprints from the immutable deployed Coze revisions. No source, database, or deployment was changed.

| Target | Actual version / deployed revision | Relationship to GitHub main |
| --- | --- | --- |
| Project 2: `ai5class.coze.site` | 0.7.0 / `7ce857c` | All 21 scoped core files match; production JS and CSS exactly match a fresh clean-main build |
| Original: `ai4class.coze.site` | 0.8.0 / `c9a56d8` | 15 of 21 scoped files match and six differ; production JS differs, CSS matches |

The scope covers all five `server/` files, `shared/`, `src/`, `config/`, `public/`, `index.html`, `vite.config.js`, `package.json`, and `package-lock.json`. SHA-256 of `git ls-tree -r <deployed revision> -- <paths>` is `4dd0bdf5f818a8a04fcd0e40e86a789c878aca960ffb6c7420c57ac4aec3497a` for both project 2 and the GitHub baseline. This establishes application source equality, not identical platform configuration, maintenance documentation, complete container images, or installed dependencies.

The original differs in `server/app.js`, `server/store.js`, `src/App.jsx`, `src/Presentation.jsx`, `package.json`, and `package-lock.json`. Its public bundle and backend `app.js` blob diff confirm optional school/name, an unsigned-identity display, and optional legacy Discover/Design fields for domain, scenario, value, and basic functionality. GitHub and project 2 retain required fields. Authentication, database migration, server entrypoint, and shared activity definitions match the baseline; these existing mechanisms are not unique 0.8.0 changes.

Project 2's Coze repository lacks the upstream `3a98f56` commit object, so direct commit diff returned bad revision. Immutable deployed-file blobs and the deterministic tree fingerprint completed the comparison without fetching, overwriting, or merging. When the user was using Chrome, inspection resumed after explicit permission to switch tabs. Only development sandboxes were reconnected and read-only Git commands run. The original project's source differences were not imported into GitHub. File and asset fingerprints are recorded in [sanitized comparison evidence](evidence/version-comparison-2026-10-13.json).

## Production release and acceptance completed at 14:13

The user explicitly authorized proceeding without backing up the original content. No production backup was created or validated, and no data was cleared. The isolated-tested transaction added and backfilled the column and enforced NOT NULL separately in each project's **production environment**, followed by each project's own saved release.

| Project | Deployed revision | Production health | Post-pre-migration total / populated / visible | Production UI acceptance |
| --- | --- | --- | --- | --- |
| AI教室工作坊网站 2 | `7ce857c23926253d65b5e9bfb139cd74e62efd93` | HTTP 200, 0.7.0, PostgreSQL / polling | 1 / 1 / 0 | Existing password, session after refresh, and all 10 authenticated reads passed; fixed student link shows the ended lesson |
| AI课堂工作坊网站 | `c9a56d8a5d64d910230f4367dc2b28a7fc957209` | HTTP 200, 0.8.0, PostgreSQL / polling | 16 / 16 / 14 | Existing password, session after refresh, and all 10 authenticated reads passed; fixed student link shows the waiting lesson |

Acceptance was verified at 14:13 on 2026-10-13, Asia/Shanghai. The original project's separate 0.8.0 changes were retained. This repository's runtime remains 0.7.0; upstream did not overwrite that project. Both teacher pages display periodic classroom synchronization and three activities. Repeated reads return one stable classroom per project. Student links do not report an invalid classroom. This operation did not reset pacing, current classroom IDs, or passwords.

Execution and troubleshooting:

1. Rechecked production counts and classroom state: neither database had a classroom accepting activity submissions; existing rooms were waiting or ended. Used this inactive window for pre-migration and immediate release, without separately stopping every container or changing classroom pacing.
2. Created separate SQL queries in each production panel and executed the entire BEGIN-to-COMMIT transaction, which only handles `activity_id`. Independent SELECT queries then verified the counts above. Existing drafts were preserved; no DELETE/TRUNCATE or development-data copy was performed.
3. A disconnected Coze development sandbox temporarily prevented the release-version list from loading. Refreshing the sandbox and selecting the saved revision resolved that UI blocker. Development workspace connectivity is separate from production classroom polling.
4. Project 2's old run command lacked the shared-database guard, so production variable `REQUIRE_SHARED_DATABASE=true` was added. Existing PostgreSQL auto-detection, polling, and remaining settings were retained. The original project already enabled the guard.
5. Resource settings were retained as observed: project 2 had 1 CPU / 2 GB, two instances, concurrency 802; the original project had 4 CPU / 8 GB, one instance, concurrency 800. These are observed configuration values, not recommendations or measured capacity.
6. After both releases succeeded, independently checked production health, existing-password login, and repeated teacher reads, then browser login, refresh, and teacher-provided student links. One duplicate paste in the original site's browser login produced an incorrect-password message; clearing the field and entering the same password succeeded. No password reset was performed.

Production acceptance added no student responses, changed no activities or classroom lifecycle, and did not apply a 500-user load. Counts are production PostgreSQL aggregates immediately after pre-migration, not a complete audit of any older SQLite files. No old SQLite files were restored or imported. This does not establish preservation of every historic distributed link or instance-local record. UI proof remains in a local ignored directory; GitHub contains only [sanitized acceptance evidence](evidence/coze-deployment-2026-10-13.json), without student content, sessions, or credentials.

## Initial read-only observations at 12:45

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

This general procedure was prepared during the initial investigation. Both projects have now been repaired and released; see the 14:13 completion record above for the actual scope and the user's explicit backup waiver. That waiver is not a default for future deployments.

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

See [sanitized evidence](evidence/coze-deployment-2026-10-13.json) for results and commands. Initial investigation did not modify production; subsequent production repair and acceptance are recorded separately at the top of this page. Neither stage changed this repository's runtime code/version, production passwords, or instance settings. Local SQL tests and production-domain acceptance remain distinct evidence.
