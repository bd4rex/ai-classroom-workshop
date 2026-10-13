# AI Classroom Workshop

[中文](README.md) · [Deployment guide](deploy/coze.en.md) · [Activity management](deploy/DEBUGGING_ACTIVITIES_2026-10-13.en.md) · [Latest deployment investigation](deploy/DEBUGGING_COZE_DEPLOY_2026-10-13.en.md) · [Validation](TEST_REPORT.en.md) · [Handoff log](TIMESTAMP_LOG.en.md)

One teacher, one classroom, freely arranged true/false, single-choice, and word-cloud activities. Each lesson supports up to 50 activities, including repeated types. The teacher controls access and pacing. Students follow a fixed link and submit independently before unlocking the current activity’s pie chart or word cloud on the right.

This independent simplification of [Tongpin Classroom Feedback](https://github.com/bd4rex/tongpin-classroom-feedback) uses its own repository and storage. React + Fastify supports SQLite/SSE for a local single process and shared PostgreSQL/polling for multiple replicas. There are no external AI calls, general question banks, grading, or school administration.

## Classroom workflow

| Activity      | Student input                                       | Right panel after submission                     |
| ------------- | --------------------------------------------------- | ------------------------------------------------ |
| True/false    | One of correct/incorrect                            | Vote counts and proportions as a pie chart       |
| Single choice | One of 2–6 options                                  | Per-option counts and proportions as a pie chart |
| Word cloud    | 1–3 comma-separated terms, up to 12 characters each | Class keyword cloud                              |

- School and name are collected on the first actual submission and reused. Each student submits once per activity; retries are idempotent, and drafts remain in the current browser tab.
- Teachers add, edit, move up/down, and delete items in the lesson activity list, starting from examples. Prompts allow 60 characters; options allow 24. The first submission locks the activity configuration to prevent mixing different questions. Deleting all responses does not unlock it; add another activity of the same type to use a new question.
- Deleting an activity requires confirmation and permanently removes all its responses, including removal receipts. Deleting the active item returns everyone to waiting; other activities are unaffected. Empty lists stay empty and can be filled again. Ended lessons cannot be edited; start a new classroom.
- The teacher controls page access, waiting, the current activity, pause/resume, and ending. Students cannot switch activities themselves and follow the next activity even without submitting the previous one. Pausing preserves unlocked results; closing or ending hides forms and charts.
- **Each activity independently requires submission before results.** Answering one true/false question does not unlock another question or activity. The server enforces identity, current activity, page access, and a submission receipt. Aggregation covers all valid classroom responses, not only the teacher table’s 50-row page.
- Pie sectors use raw vote counts; percentages round independently to one decimal place. Equal counts have equal displayed percentages, and totals may be 99.9% or 100.1%. Answers are not graded.
- Word frequency counts participants, deduplicating terms within each response and normalizing whitespace, full-width characters, and letter case. The server returns the top 60 terms. The fixed canvas prioritizes frequent terms and reports displayed/unique counts; teachers can inspect all valid content in the table and CSV.
- **The student page is fixed at 16:9**, scaling a 1440 × 810 canvas uniformly to fit both window dimensions. Other aspect ratios receive centered margins, keeping questions, answers, charts, and controls on one screen. The header shows only the current activity number and total, so a long list cannot crowd the answer area. A browser-fullscreen button is included. Desktop computers, landscape tablets, and classroom displays are the targets; the teacher workspace keeps a normal scrolling laptop layout, and narrow phones are not a dedicated target.
- Teachers can repeatedly share the fixed `/classroom/<classroom ID>` URL and matching QR code. Classroom codes are neither displayed nor required. Activity changes, pause, ending, refresh, and restart do not change a classroom’s link.
- Teachers filter by activity, school, name, or content and delete individual responses or up to 50 selected rows. A confirmation explains permanent deletion. Cleared content is excluded from lists, pies, clouds, and CSV; only an anti-resubmission receipt remains. Its author cannot resubmit but retains access to that activity’s results.
- PostgreSQL replicas poll every 2.5–3.5 seconds; single-process SQLite retains SSE with polling fallback. Charts refresh on data-version changes without manual reloads.
- Classroom tools provide CSV export and new classrooms; CSV includes activity ID, position, and prompt to distinguish repeated types. Close or end the current class first. A new class inherits activity order and question configuration, starts with empty response statistics, and receives a new link. Existing data remains and old links show that the original class ended. The current UI exports only the current class, so export before switching.
- Legacy Discover/Design classrooms and records remain compatible. Legacy activities with records or an active stage remain available to teachers and retain their previous form/list layout. First initialization provides three example activities. Upgrades preserve passwords and original links.

## Run locally

Requires Node.js 24 or newer.

```bash
npm ci
npm run build
npm start
```

Teacher entry: <http://localhost:3218/> (redirects to `/teacher`). Students use the fixed classroom link copied and distributed by a signed-in teacher.

The first startup prints a random teacher password in the server terminal. Save it. Students open the teacher’s fixed link directly, with no account registration. The root path `/` opens the teacher sign-in page, or the workspace if already signed in, without automatically joining a classroom. Repeated visits to the same teacher-shared classroom link reuse the current browser’s student identity. New classrooms start with the student page closed and the waiting stage selected. To recover a forgotten teacher password, stop the service first, then run:

```bash
npm run password:reset
npm start
```

This prints a new random password and invalidates existing teacher sessions without changing student work. Use `npm run dev` for development.

## School dropdown

`config/schools.json` contains the following six schools, preserving the names and order provided by the user. To update the dropdown later, edit this array and restart the service:

```json
[
  "南京浦口区石桥中学",
  "南京市溧水区东庐初级中学",
  "无锡宜兴市丰义中学",
  "南通通州区兴仁中学",
  "南通通州区新坝初级中学",
  "南通海安市墩头镇吉庆初级中学"
]
```

Supports 1–500 schools, with up to 100 characters per name. Students must choose a listed school and the server validates the selection. Submitted records retain their original school name. `SCHOOLS_FILE` can point to another JSON file.

## School network and deployment

The default listener is `0.0.0.0:3218`. Students should access the same service using the school server address. Teachers should also open `/teacher` at that address to generate usable student links and QR codes. For distribution, use a stable server address or domain configured through `PUBLIC_URL`. Classroom links have no expiry, but require that address to remain accessible and the classroom database to be retained. `localhost` and `127.0.0.1` links only work on the same computer; the interface indicates this.

```bash
cp .env.example .env
```

Set `PORT`, `HOST`, `DATA_DIR`, and `SCHOOLS_FILE` in `.env` as needed. `PUBLIC_URL` can fix the student-facing HTTP(S) address, such as `https://classroom.example.edu`, without a path. `npm start` and `npm run dev` read `.env` automatically. `TEACHER_PASSWORD` applies only during initial setup and does not replace an existing password.

Copied links prefer `PUBLIC_URL`; otherwise they use the teacher browser's actual origin so an HTTPS proxy does not produce an internal HTTP address. HTTPS reverse-proxy deployments should still set `PUBLIC_URL` to the external address for correct same-origin write validation.

Local-network HTTP is supported. Set `COOKIE_SECURE=true` for HTTPS. See [deploy/nginx.conf.example](deploy/nginx.conf.example); SSE requires proxy buffering to be disabled.

```bash
docker compose up -d --build
docker compose logs classroom
```

Docker stores data in the `classroom-data` named volume and mounts the host's `config/` directory read-only. The initial password appears in the logs. Run `docker compose restart classroom` after changing the school list. Docker was not built or run during this delivery, and no school server deployment was performed.

## Coze and multiple replicas

Version 0.5.0 supports shared PostgreSQL sessions and classroom state with 2.5–3.5 second polling. Two separate local processes passed 500-user join/submission bursts; actual Coze development PostgreSQL passed all 40 checks. This is not acceptance of production capacity. The [deployment guide](deploy/coze.en.md) covers new projects, upgrades, a configuration template, migration, and rollback. The [investigation record](deploy/DEBUGGING_2026-09-23.en.md) preserves failed attempts, fixes, and retests alongside sanitized load evidence.

## Troubleshooting deployed connections and links

- **PostgreSQL shows periodic synchronization**: this is normal; it does not open SSE or wait for it to recover.
- **SQLite periodic synchronization works but live events do not**: check whether the reverse proxy, compression, or caching buffers `/api/events?role=teacher`. A working response has type `text/event-stream`, sends a `ready` event immediately, and sends a `heartbeat` every 20 seconds. The Nginx example disables buffering, compression, and caching for this route; hosted platforms must also permit streaming responses. If long-lived streams are unavailable, polling still runs every 6–7.5 seconds and is no longer mislabeled as a network outage.
- **Connectivity is interrupted and retrying**: state requests are also failing. Check service availability, networking, and the browser's `/api/session` response. Recovery automatically returns to periodic or live synchronization; expired teacher sessions return to sign-in.
- **An old student link fails while a newly copied one works**: compare classroom IDs in the two links. Separate databases or newly created classrooms have distinct IDs; local-preview IDs cannot directly address another deployed database. Preserve `DATA_DIR` for single-process SQLite. Multi-instance hosting such as Coze requires shared PostgreSQL, not instance-local temporary files. Updating code while retaining data does not change the classroom ID or link. Unknown links never silently enter a different classroom.

Version 0.4.1 has passed local real-HTTP and browser fault-simulation checks for these fallback and recovery behaviors. Actual production proxy settings and persistent storage still need verification in the deployed environment.

## Data and operating boundaries

- Version 0.7 introduces activity IDs and changes uniqueness from participant/type to participant/activity while retaining original classrooms, passwords, and records. Stop every old instance and back up before upgrading all instances together. Mixing 0.6-or-older writers or rolling back code alone is unsupported. See [upgrade and rollback](deploy/DEBUGGING_ACTIVITIES_2026-10-13.en.md).

- New student activities expose the student’s own identity and class aggregates; teachers can inspect each name, school, and response. Legacy Discover/Design responses remain shared with students who submitted the same topic. Unjoined or unsubmitted students cannot read results; teacher operations require authentication.
- Student identity uses the current browser cookie. Clearing cookies, changing browser, or changing device creates a new participant. There is no identity verification or cross-device deduplication.
- Data defaults to `data/classroom.sqlite`, using SQLite WAL. Stop the service before backing up all of `data/`; do not copy only the live database file. Runtime data, passwords, environment files, dependencies, and screenshots are excluded from Git.
- Previously distributed `/?code=...` links automatically redirect to their original classroom’s new fixed link. There is no code-entry screen. Changing the entry flow does not reset passwords or student work.
- Upgrading from 0.1 adds lesson-state fields while preserving classrooms, identities, and responses. If both old switches were open, the selected topic becomes design; discovery-only becomes discovery; both closed becomes waiting. Stop the service and back up its data directory before upgrading.
- Upgrading to 0.4 adds a deletion timestamp to submissions; existing responses remain visible. Deletion clears content to `{}` and retains only participant, topic, submission time, and deletion time as a marker against resubmission. APIs cannot restore the original text. Independent historical backups and previously exported files are not modified.
- SQLite requires a single process and persistent storage. Multiple instances use the same PostgreSQL database, at most 10 database connections per instance. State revisions trigger list refreshes and student expiry is written only near renewal. Validate actual capacity on target resources and networking.
- No external AI service or model key is used. Discussing AI in this application incurs no model invocation charges.

## Validation and code

```bash
npm run check
npm audit --omit=dev
```

Tests use isolated temporary databases and cover combined filtering, single and bulk permanent deletion, content hiding in student APIs, authorization and classroom scope, pagination after deletion, fixed-link stability, automatic identity reuse, old-link isolation, topic synchronization, per-topic sharing gates, the master switch, pause/end controls, legacy migration, concurrent deduplication, shared sessions across replicas, real HTTP load with 500 students, SQLite-to-PostgreSQL migration, restart recovery, and real HTTP SSE. See [TEST_REPORT.en.md](TEST_REPORT.en.md) for the verified scope.

| File                                           | Purpose                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| `src/Presentation.jsx`, `src/presentation.css` | Student 16:9 canvas, charts, cloud, and question editor                   |
| `shared/activities.js`, `src/word-layout.js`   | Configuration, aggregation, and cloud layout                              |
| `src/App.jsx`, `src/styles.css`                | Teacher progression, current-topic forms, gated sharing, split layout     |
| `server/app.js`, `server/store.js`             | Authorization, lesson state, sharing gates, SQLite migration, SSE, export |
| `server/auth.js`                               | Asynchronous password derivation and verification                         |
| `config/schools.json`                          | School dropdown list, currently configured with six schools               |
| `test/`                                        | Automated regression tests                                                |

Source baseline: `tongpin-classroom-feedback` at `f597af64b2ac199ba69dd6eb301ba5317027c64a`. This repository starts from an independent initial commit and does not copy the original runtime data or Git history.
