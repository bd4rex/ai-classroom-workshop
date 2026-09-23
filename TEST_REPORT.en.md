# Validation report

[中文](TEST_REPORT.md) · [Back to README](README.en.md)

Validation date: 2026-09-23, version 0.4.0. Environment: local macOS, Node.js 24.14.1, Chromium. Tests use isolated databases and demonstration identities. No classroom database from the original Tongpin Classroom Feedback project was read or migrated.

## Automated checks

`npm run check` passed: 29 tests passed, 0 failed, and the production build succeeded. Every locked dependency entry matches the previous release; only the project's own version changed. An isolated `npm ci --ignore-scripts --no-audit --no-fund` install passed for 0.3.0 and was not repeated this time. The initial release's `npm audit --omit=dev` reported 0 known vulnerabilities; it was not rerun for this update.

Coverage includes teacher authorization, same-origin writes, stable links, automatic identity reuse, old-link isolation, the master page switch, waiting, topic changes, design submission without discovery, independent sharing gates for each topic, pause/resume, ending, stale controls, school and field validation, concurrent deduplication, CSV, logout, restart, new-classroom isolation, legacy migration, and real HTTP SSE.

Before submission, direct peer list, search, and pagination requests are denied. Submitting one topic does not unlock another. Student state contains only personal work and aggregate counts; teachers can still read all records.

A local Fastify injection test simulates 150 participants sharing an outbound address, completing 300 valid submissions as the teacher progresses. Pagination retrieves all records. This is not a target school-network capacity limit.

API tests verify link stability after restart and preservation of the original classroom for legacy links with a `code` parameter. Unknown or missing classroom links are rejected. Session, response-list, and submission requests bind to the visited classroom to avoid cross-classroom tab confusion.

New deletion checks cover combined topic, school, and keyword filtering; batches of up to 50; denial for students and unauthenticated visitors; and rejection of cross-classroom IDs, missing IDs, duplicates, oversized selections, and cross-origin writes without partial changes. Deletion clears database content to `{}` and excludes it from teacher/student lists, search, counts, and CSV. Authors receive a removal marker; resubmission and restoration requests cannot recover the original text, including after restart. A 52-response case verifies pagination after the last page is deleted, and real HTTP SSE verifies deletion notifications. Current submission data no longer contains the original response text, so future word clouds can use cleaned lists or CSV exports. Word clouds are not implemented in this update.

## School list and upgrade

The six schools preserve the user's exact names and order; see the README. Earlier isolated checks confirmed that all six can submit and the old placeholder is rejected. This update continues to test server-side school validation.

The migration test starts from the old schema and retains the classroom, identity, and submitted work, verifying that two open legacy switches select design. The new deletion field defaults to null, so existing work stays visible. The local preview was also stopped, backed up, upgraded, and restarted, retaining its original classroom and demonstration responses. Deletion tests use only isolated QA data.

## Browser workflow

One teacher page and two isolated student browser contexts completed `test/browser/flow.js`, verifying:

1. The copy button returns the correct fixed link, including the fallback when the Clipboard API is unavailable. Students enter automatically without a code field or a join button, and the root path redirects to the current classroom. Students automatically wait when the page is closed. Opening the master switch shows the waiting stage; selecting discovery automatically displays both student forms without reloads.
2. Unsubmitted students only see a lock notice. They still cannot see peer work after another participant submits. The submitter sees a forum-style list on the right.
3. Pausing disables unsubmitted forms and shows all students a pause notice, while unlocked responses remain readable. Resuming permits writing again.
4. Selecting design automatically moves both students to the second page, including the student who did not submit discovery. That student can submit design directly, retaining the school/name draft.
5. Discovery and design unlock independently. After both students submit the same topic they can read each other, and new responses appear automatically.
6. Returning to discovery restores unsent drafts, including after a reload. A student who submitted design first reuses the saved identity in discovery, but must submit discovery to unlock its responses.
7. Reloads restore submitted records. Name search filters correctly, and clearing the search restores all rows.
8. Closing the master switch hides forms and peer responses; reopening restores the current topic. Ending shows the closing screen to both students while teachers retain records.
9. The teacher link remains unchanged after all controls and ending. New visitors to an ended link see the closing screen without receiving a student identity. After creating a new classroom, old links still show their original closing screen even with a new-classroom cookie, and repeat visits do not inflate the new classroom’s participant count.
10. A 1366 × 768 computer viewport and a 1024 × 768 landscape tablet retain the split layout. A 1920 × 1080 display has no page overflow. Computer-room desktops are the primary target; narrow phones are not receiving dedicated adaptation.
11. Teacher school and content filters combine correctly, and changing filters clears selected rows. The confirmation dialog names selected students and states that deletion cannot be undone; cancellation preserves records. Single deletion removes the text from its author and peers automatically. Bulk deletion clears both responses in the other topic, while returning to the first topic retains its undeleted response. Students have no deletion controls.
12. Visible text on login, teacher workspace, student waiting, activity, submitted, and ended pages contains no classroom code. Students still enter automatically through the fixed link.

The full script passed without page exceptions or console errors. Teacher desktop, removed-author desktop, and student tablet screenshots were inspected. Local screenshots and script output are under `output/playwright/` and excluded from Git. The local preview now includes response management while retaining its fixed link.

## Reproduction

Run `npm ci` and `npm run build` first, and ensure port 3219 is free. Run the browser script only against the isolated QA server: it starts a new classroom, submits demonstration records, and deletes them. Port 3218 remains available for the regular preview.

```bash
node scripts/qa-server.js
```

In another terminal, use Playwright CLI:

```bash
npx --yes --package @playwright/cli playwright-cli -s=workshop-check open http://127.0.0.1:3219/teacher --headed
npx --yes --package @playwright/cli playwright-cli -s=workshop-check run-code --filename=test/browser/flow.js
```

The QA service uses an isolated `output/qa-*` data directory and an explicit test-only password. Do not use it for an actual classroom. See the [README](README.en.md) for normal operation.

## Unverified scope

No school server deployment, actual classroom capacity or duration acceptance, wireless network validation, external reverse proxy validation, or physical tablet/display test was performed. Size checks use Chromium viewport simulation. Docker and Nginx files are examples, not runtime-verified deployments. Official school naming conventions were not independently checked. There are no external model calls or model-quality acceptance results.
