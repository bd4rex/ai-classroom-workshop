# Validation record

[中文](TEST_REPORT.md) · [Back to README](README.en.md)

Validated on 2026-09-22 using local macOS, Node.js 24.14.1, and Chromium. All participants, names, and submissions are isolated test fixtures. No original project classroom database was read or migrated.

## Automated checks

`npm run check` passed: 14 tests passed, 0 failed, and the production build succeeded. `npm audit --omit=dev` reported 0 known vulnerabilities.

Coverage includes teacher authorization, same-origin writes, classroom codes, submission ordering, independent switches, school validation, required fields and lengths, concurrent deduplication, CSV export, logout, restart recovery, new-classroom isolation, and real HTTP SSE notifications.

The concurrency case simulated 150 participants sharing one outgoing address through local Fastify injection, completing 300 valid submissions. All records were readable through pagination. This is not a capacity limit verified on the target school network.

## Browser workflow

One teacher page and two isolated student browser contexts verified:

1. Students can join while both activities are closed but cannot submit. Opening an activity automatically enables the appropriate form.
2. The first submission collects school, name, field, scenario, and value. Reloading preserves the unfinished draft.
3. The other student and teacher see the first submission appear as a table row without manually refreshing.
4. Closing discovery disables the unfinished student's form. Opening design still requires that student to complete discovery first.
5. The second submission reuses the name and school, and peers can switch to the design table to view it.
6. Both students complete both submissions. Closing both activities retains shared rows, and reloading restores submitted records.
7. Name search filters the table correctly. Desktop width 1366 pixels and mobile width 390 pixels were checked. The mobile page does not overflow horizontally; the wide table scrolls within its own container.

The final browser workflow produced no script exceptions or console errors. Teacher desktop, student desktop, and student mobile screenshots were visually inspected. Local screenshots are in `output/playwright/` and are excluded from Git. Early expected unauthenticated 401 requests were replaced with an empty-session response to avoid unnecessary entry-page network errors.

## Reproduction

Run `npm ci` and `npm run build` first, and ensure port 3218 is free. Run the browser script only against the isolated QA server: it starts a new classroom and submits demonstration records.

```bash
node scripts/qa-server.js
```

Use Playwright CLI in a separate terminal:

```bash
npx --yes --package @playwright/cli playwright-cli -s=workshop-check open http://127.0.0.1:3218/teacher --headed
npx --yes --package @playwright/cli playwright-cli -s=workshop-check run-code --filename=test/browser/flow.js
```

The QA server uses an isolated `output/qa-*` directory and an explicitly test-only password. Do not use it for real classrooms. See [README.en.md](README.en.md) for normal operation.

## Unverified scope

No school server deployment, actual classroom capacity or duration acceptance, wireless network validation, external reverse proxy validation, or physical mobile-device test was performed. The mobile check used a Chromium viewport simulation. Docker and Nginx files are examples, not runtime-verified deployments. The school list still contains “School list pending.” There are no external model calls or model-quality acceptance results.
