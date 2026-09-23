# Coze login, synchronization, and concurrency investigation — 2026-09-23

[中文](DEBUGGING_2026-09-23.md) · [Deployment guide](coze.en.md) · [Validation](../TEST_REPORT.en.md) · [README](../README.en.md)

This record preserves problems, evidence, attempts, fixes, and retest results for future deployments. It is not production acceptance. Passwords, connection strings, cookies, student names, and response content are excluded from Git. Counts below validate tests and migration without identifying participants.

## Starting point and diagnosis

The user reported successful password entry followed by a signed-out view, intermittent missing classrooms at stable student links, and a teacher header indefinitely recovering its live connection. The target is 300–500 simultaneous students, preserving teacher pacing and per-topic submission-gated sharing.

| Check | Observed evidence | Interpretation and limit |
| --- | --- | --- |
| Top-level production login | Login and later session requests succeeded during observation; no intermittent failure captured | One success cannot establish cross-instance consistency |
| Separate SQLite services | A's login cookie was not recognized by B | Reproduced the split-session mechanism locally |
| Coze deployment | 1 core/2 GB, maximum two instances, concurrency 100 each; SQLite under `/tmp/ai-classroom-data` | Each replica has a separate database; ephemeral storage cannot preserve state |
| Database panel | No integration at inspection; the new default development PostgreSQL connected successfully | Development and production databases are separate |
| Preview iframe | Browsers may restrict cross-site cookies; a platform-only patch had relaxed SameSite | Cookie changes cannot fix separate SQLite databases; keep Strict and use top-level tabs with explicit errors |
| Long-lived requests | Previous implementation used SSE; 500 students could occupy 500 persistent requests | Hosted shared storage now uses short polling requests every 2.5–3.5 seconds |

## Implementation and failed attempts

1. **Establish shared storage.** `server/database.js` provides asynchronous SQLite/PostgreSQL access. Sessions, classrooms, identities, and responses are shared. Transactions keep one pool connection; initialization and classroom/student operations use compatible locks to avoid check/write races. SQLite remains supported locally.
2. **Fix misleading authentication behavior.** Login/join verifies the resulting session. Invalid JSON and HTTP 200 HTML error pages no longer masquerade as sign-out. Blocked cookies cause explicit errors without repeated student joins. `PUBLIC_URL` supports multiple trusted origins; HttpOnly and SameSite=Strict remain enabled.
3. **Reduce requests and writes.** PostgreSQL uses jittered short polling and refreshes response lists on version changes. Student expiry is written only when less than 12 hours remain. Each process uses at most 10 database connections.
4. **Initial local checks passed.** Commit `8e78303` added shared storage, migration, browser recovery, and the 500-user HTTP test. This established only local behavior; Coze development validation followed.
5. **The first Coze database check exposed contention.** `pnpm run check` in a separate checkout and isolated `test_*` schema passed 39 tests and failed one: 150 concurrent joins received `INTERNAL_ERROR`. Source review found that joins/submissions updated the same classroom row, serializing writes. A specific SQLSTATE was not captured; a pool-acquisition timeout remains an inference, not a recorded database error.
6. **Remove the shared write bottleneck.** Commit `6d511e9` stopped advancing the response version on joins. PostgreSQL submissions and removals append `room_changes` receipts instead of updating one hot row. Versions count committed receipts so late commits with lower sequence IDs are not missed. Pool acquisition timeout increased from five to ten seconds. Regression coverage expanded to 500 participants and 1,000 submissions, including out-of-order commit visibility.
7. **Actual Coze PostgreSQL retest passed.** Using platform-injected PG variables, all 40 checks passed with no failures in about 64.7 seconds. The 500-user/1,000-response case took about 10.8 seconds. These are application injection tests against the real cloud database, not 500 browsers through the production gateway.
8. **Repeat local real HTTP load.** Two separate Node processes, 500 cookies, two submission bursts, and 60 seconds of polling produced 13,688 requests, zero unexpected errors, and 523 peak in-flight requests. A sanitized [machine-readable result](evidence/load-2026-09-23.json) is committed; operation definitions and latency are in the validation report.
9. **Correct the browser fault simulation.** The first blocked-cookie simulation was affected by Playwright `route.fetch` persisting test cookies and an incorrect student-message locator. Corrected simulation and selectors passed; these were test-script issues, not reported product vulnerabilities.
10. **Migrate the development sandbox.** Stop the identified application on port 5000; back up SQLite, WAL/SHM, platform/environment configuration, and old source. Run read-only inspection and transactional import into development PostgreSQL. All source fields matched across all tables: seven classrooms, 343 participant identities, 16 responses, 11 teacher sessions, and two metadata entries. Password and classroom IDs were preserved. Backups remain private in `data/backups/v050/`, outside Git.

### Sandbox operational issues

- Existing terminals did not receive PG variables immediately after database creation. Reconnect the sandbox and open a new terminal; inspect variable presence, then test `pg.Pool()`. Never print full environment values or connection strings.
- Character-based Web terminal input collapsed a multiline heredoc. Cancel incomplete input and use a single-line command; an unfinished input is not evidence of migration or validation.
- The temporary verification checkout tracked only the feature branch. `git fetch origin main` updated `FETCH_HEAD` without creating `origin/main`, so the first archive attempt failed with `not a valid object name` and did not replace workspace files. Use `git archive FETCH_HEAD -o /tmp/workshop-upstream.tar`, then extract only after success, avoiding pipelines that mask earlier failures. Preserve platform `.coze`, environment files, private handoff rules, and data separately.
- `pg` warned of future changes to some `sslmode` semantics. Current connection/tests passed; TLS and certificate checks were not disabled. Recheck platform TLS requirements on driver upgrades, rather than setting `rejectUnauthorized: false`.
- Development must use `--watch-path=./server --watch-path=./config`, avoiding a bare `--watch` reacting to Vite temporary files and causing restart loops. This constraint is included in the upstream development command and Coze template.

## Verify code, data, and each environment separately

| Layer | Established this round | Still unverified |
| --- | --- | --- |
| GitHub | Code, reproducible scripts, sanitized test output, and bilingual records are maintained together; PR and remote main establish merge state | A GitHub merge does not deploy Coze |
| Local | PostgreSQL 40 passed; SQLite 37 passed/three skipped; build and browser flow passed; two-process 500-user HTTP load passed | School networking and full-lesson duration |
| Local preview | Complete backup; original classroom, password, identities, and two responses matched after upgrade | It is a separate dataset from production |
| Coze development | Real cloud PostgreSQL 40 passed; development migration matched every source field; original-password login, refresh, stable link, and teacher/student topic/page controls passed | Production database, replicas, and gateway capacity |
| Coze production | Old deployment configuration inspected; no development data copied over production | Retention scope, production migration/release, and session/link/500-user acceptance remain pending |

## New-project production password verification (2026-09-23 21:00, Asia/Shanghai)

This check concerns the new project “AI教室工作坊网站 2” and its production domain `https://ai5class.coze.site`. It is separate from the older project above and does not establish migration of that project's data.

- Production `/api/health` returned `version: 0.5.0`, `storage: postgres`, and `syncMode: polling`. The Coze deployment page showed running revision `e396bbd`; its latest maintenance record, `3afa2f2`, reported updating the production password hash and revoking old sessions. Coze performed that database update; this verification did not repeat a password write.
- The platform record explains that the earlier change affected only development storage and initial-password configuration. Production was already initialized, so changing `TEACHER_PASSWORD` did not replace its stored hash. This matches upstream initialization and database separation; domain names are not inputs to password hashing.
- Independent browser check: after clearing the password field, the user-requested password opened the production teacher workspace. Refresh and multiple synchronization cycles retained sign-in, with the healthy polling indicator visible. One attempt that appended to the existing field returned a password error; clearing the field removed that input-operation confounder, so it is not evidence of another backend failure.
- The teacher's sharing URL uses the production domain. No students were joined, responses submitted, classroom controls changed, replica settings altered, or deployment started. This establishes sign-in and refresh persistence only, not full classroom or 500-user production acceptance.
- The bilingual deployment guide now covers separate development/production passwords, first-initialization configuration, and production-domain verification. Passwords, hashes, cookies, connection strings, and classroom access identifiers are omitted from public records.

## Where to start next time

Read the [deployment guide](coze.en.md) and choose its new-project or existing-project path. Use the [configuration template](coze.toml.example), not the old ephemeral SQLite setup or hard-coded passwords.

For each continuation, record date, Git commit, environment, commands, results, failures, fixes, retests, backup location, and remaining work. Record secure locations and verification status for data and credentials, never their contents. Keep full logs in a controlled environment and commit sanitized evidence plus reproducible code.
