# Validation record

[中文](TEST_REPORT.md) · [README](README.en.md)

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

| Operation | Requests | P95 (ms) | P99 (ms) |
| --- | ---: | ---: | ---: |
| join | 500 | 502 | 522 |
| submit-discover | 500 | 346 | 367 |
| submit-design | 500 | 373 | 389 |
| poll | 10246 | 4 | 174 |
| board | 500 | 244 | 253 |

13799 requests, 0 unexpected errors; peak 523 in flight.

Expected sharing-gate 403 responses are not errors. After removing one design response, counts must be 500 participants, 500 discovery responses, and 499 design responses. All 1,000 submissions were retained; the removed response keeps only its receipt. The test runner only accepts local database addresses.

## Browser workflow and recovery

`test/browser/flow.js` passed on the PostgreSQL QA service: one teacher and two isolated student contexts, stable-link copying, master switch, automatic design progression, independent topic gates, draft recovery, peer updates, filtering, single/bulk moderation reflected for authors and peers, ending, and new-classroom isolation. Desktop 1366 × 768 and landscape tablet 1024 × 768 retain side-by-side content; 1920 × 1080 has no page overflow. No page exceptions or console errors.

`test/browser/auth.js` passed: blocked cookies produce a clear teacher error and only one student join attempt. An HTTP 200 HTML proxy error preserves the teacher workspace, shows interrupted connectivity, and recovers on valid responses. PostgreSQL mode makes zero SSE requests. The initial simulation needed correction for `route.fetch` updating test cookies and the student-message locator; corrected checks passed without product changes.

SQLite SSE authentication, notification, handshake, heartbeat, logout cleanup, and silent-connection recovery remain covered by automated tests. The older SSE fault browser script was not rerun; shared-storage operation does not depend on SSE.

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

Raw ignored artifacts: `output/load-test/result.json`, `output/check-v050-*.log`, `output/browser-auth-v050.log`, and `output/playwright/`. See [Coze deployment](deploy/coze.en.md) for migration and rollback.
