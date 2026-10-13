# Editable classroom activities: implementation and upgrade record

[中文](DEBUGGING_ACTIVITIES_2026-10-13.md) · [README](../README.en.md) · [Validation](../TEST_REPORT.en.md) · [Deployment guide](coze.en.md)

## Requirements and behavior

2026-10-13, version 0.7.0. Teachers can add, delete, and reorder activities within a lesson. Types remain true/false, multiple choice, and word cloud; each type may appear repeatedly. The user confirmed permanent deletion of an activity and all its responses together.

- A lesson holds 0–50 activities, initially retaining the three examples. Teachers add, edit, move up/down, start, or delete items in the lesson activity list.
- Questions, response receipts, reading gates, statistics, and configuration locks belong to individual activities. Answering one true/false question does not unlock another question's pie chart.
- Receiving any response locks that activity's prompt/options. Teachers can add another of the same type. Existing pause, close, waiting, and end rules remain; students follow the next activity even if they skipped the previous one.
- Deletion requires confirmation and removes all responses, including removal receipts. Deleting the active activity returns everyone to waiting; deleting another preserves the current activity and other answers. An empty list stays empty after refresh, restart, and creating a new lesson.
- Reordering preserves activity identity, results, and the current question. New IDs never reuse deleted IDs. A new classroom inherits activity order/prompts with reset question revisions, retains previous classroom data, and receives a new link.
- Students retain a fixed 16:9 canvas with a compact current/total counter. Teacher records use an activity dropdown. CSV appends activity ID, position, and prompt to distinguish repeated types.
- Ended lessons cannot be edited; start a new classroom through classroom tools. Legacy Discover/Design remains compatible but is not an addable type.

## Data and concurrency

The `activities:<classroom ID>` metadata changes from a type-keyed object to an ordered array of `id`, `kind`, `question`, `options`, and `revision`. Old objects normalize on read; original activity IDs remain their type names. Empty arrays are valid and must not fall back to defaults.

`submissions.activity_id` is backfilled from `kind`, and uniqueness changes to `(participant_id, activity_id)`. `kind` retains its type constraint. SQLite rebuilds the table transactionally while preserving the sequence high-water mark; PostgreSQL backfills the column and replaces the unique constraint/index under the initialization advisory lock. The SQLite-to-PostgreSQL importer supports old tables and new activity arrays.

Activity mutations require teacher authentication, an exclusive current-classroom lock, and `room.revision` checks. Student submissions use shared classroom locks and participant locks. Deletion and submission resolve in order: an accepted response is subsequently deleted, or submission after deletion returns 404. No orphan response remains. Statistics/exports use consistent snapshots.

Existing `:kind` / `?kind=` parameter names remain but now carry activity IDs; actual types come from configuration. New `POST /api/teacher/activities` accepts `add`, `reorder`, or `delete`; deletion additionally requires `confirm: true`. Teacher `stage` values are activity IDs. Per-student submissions allow 120 requests/minute for multiple lesson questions and retries.

## Validation and investigation

- SQLite: 51 of 56 tests passed, five PostgreSQL-specific tests skipped. Shared PostgreSQL: all 56 passed. Production build and syntax checks passed. No new dependencies.
- Added coverage: repeated types and independent results/gates, locks, CSV identity, list limits, invalid orders, stale mutations, deletion/empty lists, inheritance/old links, 0.6 SQLite/PostgreSQL upgrades, concurrent two-instance reordering and deletion/submission.
- The existing 500-student / 1,500-response three-type case passed on both stores. Injected requests with local databases are not Coze production gateway capacity acceptance.
- Initial legacy SQLite migration fixture failed because `SELECT *` now returned an extra column. Explicitly selecting the old seven columns fixed the fixture while preserving old-field, session, and sequence checks. The production migration also selects source columns explicitly.
- Browser checks on isolated port 3219 covered all addable types, a second true/false question, option editing, moving up, teacher switching, per-activity unlocks, separate pies/clouds, deletion confirmation, empty states, and refresh. Permanent deletion/clear operations used the test service API with synthetic data; synchronized teacher/student UI outcomes were inspected.
- Student canvas stayed 16:9 without document scrolling at 1024 × 768 and 1366 × 768. With 50 activities, only the total counter changed; canvas height stayed fixed. No new teacher/student console exceptions.
- The original isolated port-3218 demo was stopped and fully backed up before upgrade. All old columns matched across tables: one classroom, 18 participants, 54 responses; all 54 activity IDs were backfilled. An editable example true/false activity was then added. Original classroom ID/link remain. Earlier `output/local-preview` data and Coze production were untouched.
- Raw logs, screenshots, databases, and backups stay in ignored `output/`; only a [sanitized summary](evidence/validation-2026-10-13-v070.json) enters Git. Docker and Coze production/configuration were not changed or exercised this run.

## Reproduction

```bash
npm ci
npm test
npm run build
# Isolated test database only; never commit credentials.
TEST_DATABASE_URL=postgresql://127.0.0.1:55439/classroom_test npm test
node scripts/qa-server.js
```

Open QA `/teacher`, sign in, add a second true/false activity, and copy the student link. Answer the first question and switch to the second: its results remain locked until separately answered. Add choice/cloud activities and inspect independent prompts, options, and results. Inspect deletion confirmation; execute deletion checks only in a dedicated test classroom. With 50 activities, students still see a single canvas. Clearing the list yields empty/waiting states that persist after refresh/restart.

## Upgrade and rollback

Addendum: Coze synchronizes schema before application startup. Production storage with existing submissions and no `activity_id` requires [maintenance pre-migration](DEBUGGING_COZE_DEPLOY_2026-10-13.en.md). Automatic migration below assumes platform schema synchronization has succeeded; it does not establish readiness of an unprepared old database.

1. Schedule a lesson outage, stop writes from every old instance, and fully back up the actual database. Record classroom ID, counts, version, and sign-in behavior. Copy the entire stopped SQLite data directory or take a consistent PostgreSQL backup.
2. Run 0.7.0 on all instances while retaining existing storage and production configuration. Initialization migrates automatically; do not recreate the classroom or re-import an existing PostgreSQL database.
3. Check production `/api/health` for 0.7.0 and the intended storage/sync mode. Verify the original password, link, responses, and activity order; exercise mutations and cross-instance following in a dedicated test classroom.
4. **Do not mix 0.6-or-older and 0.7 writers against upgraded storage.** The new required column and array configuration are not compatible with old writers. Stop old instances before switching; a mixed-version rolling release is unsupported.
5. To roll back, stop new instances and preserve post-upgrade records, then restore the complete pre-upgrade database and matching old code. Code-only rollback is insufficient. New responses do not appear in an old backup; export first. Activity deletion does not alter historical backups or previously exported files.
