# AI Classroom Workshop

[中文](README.md) · [Validation](TEST_REPORT.en.md) · [Handoff log](TIMESTAMP_LOG.en.md)

One teacher, one classroom, two fixed activities. The teacher opens or closes submissions for each activity independently. Students join with a classroom code, submit twice, and view each other's work in shared table rows.

This is an independent simplification of [Tongpin Classroom Feedback](https://github.com/bd4rex/tongpin-classroom-feedback), with a separate repository and data directory. It retains the React, Fastify, SQLite, and SSE approach and a fixed workflow. There is no general question bank, activity editor, model configuration, or AI invocation.

## Classroom workflow

| Activity                                     | Student input                                                              | Teacher control                  |
| -------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------- |
| Discover together: AI applications around us | School dropdown, name, field, application scenario, value                  | Open/close the first submission  |
| Design together: future AI applications      | Scenario and basic functions; reuse the first submission's school and name | Open/close the second submission |

- The switches are independent. Teachers can close discovery before opening design, or open both together.
- Students complete the first submission before the second. A student who missed the first step needs the teacher to reopen discovery.
- Each participant submits once per activity. Retrying the same request does not create duplicates; submitted work cannot be edited.
- The two shared tables display name, school, and work, newest first. They support search and pagination at 50 rows per page, rather than a card wall.
- Closing an activity only stops new submissions; existing work remains visible. Updates and reconnects refresh automatically, with an additional polling fallback approximately every 6–7.5 seconds.
- Drafts remain in the current browser tab. Submitted work persists in the database and survives page reloads and service restarts.
- Teacher classroom tools provide CSV export and a new-classroom action. Both activities must be closed before starting a new classroom, which rotates the code and requires students to rejoin. Older records remain in the database; the interface only views and exports the current classroom, so export before switching.

## Run locally

Requires Node.js 24 or newer.

```bash
npm ci
npm run build
npm start
```

Student entry: <http://localhost:3218/>; teacher entry: <http://localhost:3218/teacher>.

The first startup prints a random teacher password in the server terminal. Save it. Students only need the classroom code, with no account registration. Both activities are initially closed. To recover a forgotten teacher password, stop the service first, then run:

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

The default listener is `0.0.0.0:3218`. Students should access the same service using the school server address. Teachers should also open `/teacher` at that address to generate usable student links and QR codes. `localhost` and `127.0.0.1` links only work on the same computer; the interface indicates this.

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

- Names, schools, and both submissions are **visible to students who have joined the current classroom**. The join page explains this. Unjoined visitors cannot read the tables; teacher actions require a password.
- Student identity uses the current browser cookie. Clearing cookies, changing browser, or changing device creates a new participant. There is no identity verification or cross-device deduplication.
- Data defaults to `data/classroom.sqlite`, using SQLite WAL. Stop the service before backing up all of `data/`; do not copy only the live database file. Runtime data, passwords, environment files, dependencies, and screenshots are excluded from Git.
- Run one service process, not multiple instances sharing this database. SSE notifications are coalesced and lists are paginated to bound response size. Actual classroom capacity needs testing on the target devices and network.
- No external AI service or model key is used. Discussing AI in this application incurs no model invocation charges.

## Validation and code

```bash
npm run check
npm audit --omit=dev
```

Tests use isolated temporary databases and cover authorization, both submissions, independent switches, concurrent deduplication, 150 participants making 300 submissions, pagination, restart recovery, new-classroom isolation, and real HTTP SSE. See [TEST_REPORT.en.md](TEST_REPORT.en.md) for the verified scope.

| File                               | Purpose                                                          |
| ---------------------------------- | ---------------------------------------------------------------- |
| `src/App.jsx`, `src/styles.css`    | Teacher entry, fixed forms, shared row tables, and mobile layout |
| `server/app.js`, `server/store.js` | Authorization, switches, validation, SQLite, SSE, and export     |
| `server/auth.js`                   | Asynchronous password derivation and verification                |
| `config/schools.json`              | School dropdown list, currently configured with six schools      |
| `test/`                            | Automated regression tests                                       |

Source baseline: `tongpin-classroom-feedback` at `f597af64b2ac199ba69dd6eb301ba5317027c64a`. This repository starts from an independent initial commit and does not copy the original runtime data or Git history.
