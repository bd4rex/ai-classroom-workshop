# Validation record

[中文](TEST_REPORT.md) · [README](README.en.md)

## 2026-10-13 · 0.7.0 editable activity lists

- SQLite `npm test`: 51 of 56 passed, five PostgreSQL-only checks skipped. Local shared PostgreSQL: all 56 passed. Syntax and production build passed; no dependencies added.
- Coverage includes independent same-type answers/results, per-activity gates/locks, CSV identity, ordering, limits, permissions, stale requests, deletion/submission races, empty lists, restart, inheritance, old-link isolation, 0.5/0.6 SQLite/PostgreSQL upgrades, and two-instance initialization.
- Browser checks covered adding/editing all types, moving, automatic following, separate same-type unlocks, pies/clouds, and deletion confirmation. Test API deletion of synthetic data synchronized waiting/empty states; refresh did not restore defaults.
- Students retained a single 16:9 canvas at 1024 × 768 and 1366 × 768, including a 50-activity list. No document scrolling or new teacher/student script errors. Teacher scrolling is intentional.
- Existing 500-student / 1,500-response cases passed on both stores using local injected requests, not production capacity acceptance.
- The original isolated 3218 demo was fully backed up and upgraded; old columns matched and 54 activity IDs were backfilled before adding an editable example. Coze production is unchanged. See the [implementation/investigation record](deploy/DEBUGGING_ACTIVITIES_2026-10-13.en.md) and [sanitized evidence](deploy/evidence/validation-2026-10-13-v070.json) for reproduction and rollback.

## 2026-10-13 · 0.6.0 activities and fixed canvas

- Local SQLite `npm run check`: 46 of 50 passed, four PostgreSQL-specific tests skipped. PostgreSQL `npm test`: all 50 passed. Production build passed. No dependencies added.
- Added coverage includes independent result gates, teacher authorization/configuration locks, stale question versions, complete aggregation and deletion, term normalization, equal percentages for equal votes, cloud layout, and 0.5 constraint upgrades in SQLite/PostgreSQL.
- Both stores passed a new three-activity 500-participant check: 500 joins, 1,500 submissions, 1,500 result reads, and deletion aggregation. These are injected application requests with local databases, not Coze production HTTP capacity acceptance.
- Browser checks passed for question editing, automatic activity following, submission-gated results, pause/close/resume, fullscreen, and populated teacher chart transitions. Maximum 60-character prompts, six 24-character options, and three 12-character terms fit without clipped controls or content.
- Student pages retained 16:9 without document scrolling at 1920 × 1080, 1366 × 768, 1280 × 720, 1024 × 768, and 1280 × 800. Teacher pages scroll normally. No new script exceptions after repairs.
- Isolated data only; a separate local demo runs on 3218. Existing preview storage and Coze deployment were not changed. The [new record](deploy/DEBUGGING_2026-10-13.en.md) captures failures, repairs, reproduction, and rollback. The [sanitized summary](deploy/evidence/validation-2026-10-13.json) contains no student data, cookies, or credentials.

- Runtime packaging check: Dockerfile now copies `shared/`; an assembled runtime directory passed imports, health, and the static teacher page. An actual Docker image/container was not built or run.

## 2026-09-23 · 0.5.0 historical validation

The following records describe that earlier run, not production acceptance of 0.6.0. Historical browser scripts cover Discover/Design; use the current checks above for the new activities.

Date: 2026-09-23; version 0.5.0. Local macOS, Node.js 24.14.1, PostgreSQL 16, Chromium. Automated checks and load tests use isolated databases and synthetic identities, never production classroom submissions.

## Automated checks

- PostgreSQL `TEST_DATABASE_URL=... npm run check`: 40 passed, zero failures; production build passed.
- Default SQLite `npm test`: 37 passed, three PostgreSQL-specific tests intentionally skipped, zero failures.
- `npm audit --omit=dev`: zero known vulnerabilities. Added the `pg` driver and lockfile entries.
- Existing rules regressed: teacher root entry, stable links, six schools, teacher controls, submission-gated sharing, skipping to design, pause/close/end, idempotency, immutable identity, search/pagination, moderation, CSV, and restart recovery.
- Shared storage checks: simultaneous bootstrap creates one classroom; sign in on A and authenticate on B; only one concurrent teacher revision succeeds; logout on B invalidates A; standard PG variables work; required missing storage cannot fall back to SQLite; conflicting HTTP/Secure Cookie configuration fails startup.
- Migration checks: read-only SQLite inspection, transactional import, preserved classroom ID/password/session/removal receipt, matching counts, and refusal to overwrite existing data.
- HTTP 200 error pages, invalid JSON, and missing state fail explicitly without pretending the teacher signed out.

## Two-process, 500-student real HTTP load

`npm run test:load` starts two independent Node processes against one isolated PostgreSQL schema. Requests alternate between processes, using 500 distinct cookies. It runs 500 simultaneous joins and two bursts of 500 submissions while polling every 2.5–3.5 seconds, followed by 60 seconds with all 500 users online. It also checks expected 403 sharing gates, lists, topic progression, moderation, and session recovery after restarting both processes.

Results below use local loopback networking and cannot establish capacity for Coze's 1-core/2-GB replicas:

| Operation       | Requests | P95 (ms) | P99 (ms) |
| --------------- | -------: | -------: | -------: |
| join            |      500 |      212 |      214 |
| submit-discover |      500 |      167 |      168 |
| submit-design   |      500 |      124 |      132 |
| poll            |    10135 |        5 |       47 |
| board           |      500 |      173 |      185 |

13688 requests, 0 unexpected errors; peak 523 in flight.

Expected sharing-gate 403 responses are not errors. After removing one design response, counts must be 500 participants, 500 discovery responses, and 499 design responses. All 1,000 submissions were retained; the removed response keeps only its receipt. The test runner only accepts local database addresses.

## Browser workflow and recovery

`test/browser/flow.js` passed on the PostgreSQL QA service: one teacher and two isolated student contexts, stable-link copying, master switch, automatic design progression, independent topic gates, draft recovery, peer updates, filtering, single/bulk moderation reflected for authors and peers, ending, and new-classroom isolation. Desktop 1366 × 768 and landscape tablet 1024 × 768 retain side-by-side content; 1920 × 1080 has no page overflow. No page exceptions or console errors.

`test/browser/auth.js` passed: blocked cookies produce a clear teacher error and only one student join attempt. An HTTP 200 HTML proxy error preserves the teacher workspace, shows interrupted connectivity, and recovers on valid responses. PostgreSQL mode makes zero SSE requests. The initial simulation needed correction for `route.fetch` updating test cookies and the student-message locator; corrected checks passed without product changes.

SQLite SSE authentication, notification, handshake, heartbeat, logout cleanup, and silent-connection recovery remain covered by automated tests. The older SSE fault browser script was not rerun; shared-storage operation does not depend on SSE.

## Coze development database retest and migration

The first actual Coze PostgreSQL run passed 39 checks and failed one concurrent-join check. After removing classroom-row write contention, the case expanded to 500 participants and 1,000 submissions: all 40 checks passed in about 64.7 seconds, with the burst case taking about 10.8 seconds. These use injected application requests and the real cloud database, not the production gateway. Development preview health reports version 0.5.0 with PostgreSQL/polling; the original teacher password signs in, and refresh preserves the workspace. Standalone teacher/student Coze development tabs also passed waiting, discovery, advancing an unsubmitted student to design, closing into waiting, and reopening automatically; sharing stayed locked before submission in both topics.

After a complete backup and transactional import, all original fields matched across seven classrooms, 343 participant identities, 16 responses, 11 teacher sessions, and two metadata entries. Classroom IDs, password, and removal receipts were preserved. These are migration-time counts; subsequent browser checks can create ordinary sessions or anonymous participants.

## Deployment evidence and limits

Inspected the user's open Coze project: 1 core/2 GB, maximum two instances, concurrency 100 per instance; the old production command stored SQLite in `/tmp/ai-classroom-data`. The database panel was empty. A development PostgreSQL database was created, and standard PG connection-variable injection was confirmed after reconnecting. Connection passwords were not read or recorded.

Separate SQLite replicas failing to recognize each other's sessions were reproduced locally; the deployment configuration matches that mechanism. An earlier top-level production sign-in succeeded at the time, so the intermittent production failure was not directly captured. Preview iframe cookies can also be blocked; successful curl requests do not eliminate replica-state problems.

Production migration requires confirming the retention scope and backing up or importing data before deployment. Production acceptance with 500 students on Coze remains outstanding. Local short-duration load cannot establish full-lesson stability, gateway behavior, school networking, or cloud-database latency. Docker, Nginx, and physical devices were not validated this round. Narrow phones are not a target.

## Reproduction

```bash
npm run check
# Isolated PostgreSQL only. Supply local credentials safely; never commit them.
TEST_DATABASE_URL=postgresql://127.0.0.1:55439/classroom_test npm run check
TEST_DATABASE_URL=postgresql://127.0.0.1:55439/classroom_test LOAD_HOLD_MS=60000 npm run test:load
```

Browser QA uses a separate database and port 3219, never a formal classroom:

```bash
DATABASE_URL=postgresql://127.0.0.1:55439/classroom_test DATABASE_SCHEMA=browser_test node scripts/qa-server.js
npx --yes --package @playwright/cli playwright-cli -s=workshop-check open http://127.0.0.1:3219/teacher
npx --yes --package @playwright/cli playwright-cli -s=workshop-check run-code --filename=test/browser/flow.js
npx --yes --package @playwright/cli playwright-cli -s=workshop-check run-code --filename=test/browser/auth.js
```

Committed sanitized [HTTP load evidence](deploy/evidence/load-2026-09-23.json) corresponds to commit `6d511e9`. The [check summary](deploy/evidence/validation-2026-09-23.json) also records environment and migration verification. See the [investigation](deploy/DEBUGGING_2026-09-23.en.md) for failures and fixes. Full raw ignored artifacts: `output/load-test/result.json`, `output/check-v050-*.log`, `output/browser-auth-v050.log`, and `output/playwright/`. See [Coze deployment](deploy/coze.en.md) for migration and rollback.
