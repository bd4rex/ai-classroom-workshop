# AI Classroom Workshop

[中文](README.md) · [Validation](TEST_REPORT.en.md) · [Handoff log](TIMESTAMP_LOG.en.md)

One teacher, one classroom, two fixed topics. The teacher controls page access and lesson progression. Students open a fixed link to enter directly and automatically follow the current topic. They write independently, then unlock that topic’s peer responses on the right after submitting.

This is an independent simplification of [Tongpin Classroom Feedback](https://github.com/bd4rex/tongpin-classroom-feedback), with a separate repository and data directory. It retains the React, Fastify, SQLite, and SSE approach and a fixed workflow. There is no general question bank, activity editor, model configuration, or AI invocation.

## Classroom workflow

| Activity                                     | Student input                                                                                                    | Teacher control                           |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Discover together: AI applications around us | School dropdown, name, field, application scenario, value                                                        | Switch to discovery; pause/resume writing |
| Design together: future AI applications      | Scenario and basic functions; collect school/name on the first actual submission, otherwise reuse saved identity | Switch to design; pause/resume writing    |

- The teacher can copy the student link and distribute it repeatedly. Neither teacher nor student pages display a classroom code. Students enter automatically through the link without a passcode or join button. The `/classroom/<classroom ID>` link is fixed once the classroom is created; topic changes, pause, closure, ending, reloads, and restarts do not reset it. The QR code uses the same link.
- The master page switch controls whether students see the activity. Closing it shows a waiting screen; reopening follows the current topic. Only one of waiting, discovery, or design appears at a time.
- Switching to design automatically moves all students to the second page, including students who have not submitted discovery. Teachers can return to a previous topic; students cannot navigate topics themselves.
- Each topic independently requires submission before peer reading. Before submission, a lock notice appears and the server rejects list, search, and pagination requests. Submitting discovery does not unlock design responses.
- Computer-room desktops are the primary target, with landscape tablets and classroom displays also considered. Narrow phones are not a dedicated adaptation target. The student's form or saved work appears on the left and a forum-style row list on the right shows names, schools, times, and responses. Newest responses appear first, with search and 50 items per page. Teachers can always view all records for both topics.
- In the classroom responses table, teachers can combine topic, school, name, and content filters. Delete a single row or select rows on the current page and delete them together (up to 50 at a time). After confirmation, student pages remove the content automatically. Changing filters, topics, or pages clears the selection to avoid deleting hidden rows. The confirmation dialog lists the selected names and states that deletion cannot be undone.
- Deletion permanently clears response content and removes it from teacher/student lists, search, response counts, and CSV exports. Only a submitted marker remains: its author sees a removal notice and cannot resubmit that topic, while retaining the existing peer-reading entitlement. Future word clouds should use active response lists or exports; this update does not implement word clouds.
- Pausing stops writing while retaining already unlocked responses. Closing the page or ending the lesson hides student forms and peer responses. Ending shows a closing screen; teachers retain access to records and export.
- Each participant submits once per topic; identical retries do not duplicate records, and submitted work cannot be edited. Drafts stay in the current browser tab across topic switches and reloads. Submitted records persist in the database.
- Students do not need to refresh manually. Live events and reconnects fetch current state, with a polling fallback approximately every 6–7.5 seconds. Instant synchronization is unavailable while disconnected.
- Teacher classroom tools provide CSV export and a new-classroom action. End the lesson or close the page first; a new classroom receives a different fixed link that must be shared again. The old link continues to show the original classroom as ended and never enters the new classroom. Older records remain in the database, but the interface only views and exports the current classroom, so export before switching.

## Run locally

Requires Node.js 24 or newer.

```bash
npm ci
npm run build
npm start
```

Student entry: <http://localhost:3218/>; teacher entry: <http://localhost:3218/teacher>.

The first startup prints a random teacher password in the server terminal. Save it. Students open the teacher’s fixed link directly, with no account registration. The root path `/` redirects to the current classroom’s fixed link. Repeated visits to the same link reuse the current browser’s student identity. New classrooms start with the student page closed and the waiting stage selected. To recover a forgotten teacher password, stop the service first, then run:

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

Local-network HTTP is supported. Set `COOKIE_SECURE=true` for HTTPS. See [deploy/nginx.conf.example](deploy/nginx.conf.example); SSE requires proxy buffering to be disabled.

```bash
docker compose up -d --build
docker compose logs classroom
```

Docker stores data in the `classroom-data` named volume and mounts the host's `config/` directory read-only. The initial password appears in the logs. Run `docker compose restart classroom` after changing the school list. Docker was not built or run during this delivery, and no school server deployment was performed.

## Data and operating boundaries

- Names, schools, and responses are **visible to current-classroom students who have submitted the same topic**, and only while that topic is the open current topic. The join page explains this. Unjoined or unsubmitted visitors cannot read peer responses; teacher actions require a password.
- Student identity uses the current browser cookie. Clearing cookies, changing browser, or changing device creates a new participant. There is no identity verification or cross-device deduplication.
- Data defaults to `data/classroom.sqlite`, using SQLite WAL. Stop the service before backing up all of `data/`; do not copy only the live database file. Runtime data, passwords, environment files, dependencies, and screenshots are excluded from Git.
- Previously distributed `/?code=...` links automatically redirect to their original classroom’s new fixed link. There is no code-entry screen. Changing the entry flow does not reset passwords or student work.
- Upgrading from 0.1 adds lesson-state fields while preserving classrooms, identities, and responses. If both old switches were open, the selected topic becomes design; discovery-only becomes discovery; both closed becomes waiting. Stop the service and back up its data directory before upgrading.
- Upgrading to 0.4 adds a deletion timestamp to submissions; existing responses remain visible. Deletion clears content to `{}` and retains only participant, topic, submission time, and deletion time as a marker against resubmission. APIs cannot restore the original text. Independent historical backups and previously exported files are not modified.
- Run one service process, not multiple instances sharing this database. SSE notifications are coalesced and lists are paginated to bound response size. Actual classroom capacity needs testing on the target devices and network.
- No external AI service or model key is used. Discussing AI in this application incurs no model invocation charges.

## Validation and code

```bash
npm run check
npm audit --omit=dev
```

Tests use isolated temporary databases and cover combined filtering, single and bulk permanent deletion, content hiding in student APIs, authorization and classroom scope, pagination after deletion, fixed-link stability, automatic identity reuse, old-link isolation, topic synchronization, per-topic sharing gates, the master switch, pause/end controls, legacy migration, concurrent deduplication, 150 participants making 300 submissions, restart recovery, and real HTTP SSE. See [TEST_REPORT.en.md](TEST_REPORT.en.md) for the verified scope.

| File                               | Purpose                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------- |
| `src/App.jsx`, `src/styles.css`    | Teacher progression, current-topic forms, gated sharing, split layout     |
| `server/app.js`, `server/store.js` | Authorization, lesson state, sharing gates, SQLite migration, SSE, export |
| `server/auth.js`                   | Asynchronous password derivation and verification                         |
| `config/schools.json`              | School dropdown list, currently configured with six schools               |
| `test/`                            | Automated regression tests                                                |

Source baseline: `tongpin-classroom-feedback` at `f597af64b2ac199ba69dd6eb301ba5317027c64a`. This repository starts from an independent initial commit and does not copy the original runtime data or Git history.
