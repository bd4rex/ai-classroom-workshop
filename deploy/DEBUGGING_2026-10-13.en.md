# Three activities and a 16:9 student view: implementation and investigation

[中文](DEBUGGING_2026-10-13.md) · [README](../README.en.md) · [Validation](../TEST_REPORT.en.md) · [Deployment](coze.en.md)

## Requirements and implementation

2026-10-13, version 0.6.0. The user approved teacher-editable prompts/options and submission-gated results for all three activities. The target is browser fullscreen. Only students use a fixed 16:9 canvas; the teacher workspace remains a normal scrolling laptop layout.

- True/false has two fixed answers; single choice has 2–6 options. Both show counts and proportions in a right-side pie chart.
- Word clouds accept 1–3 terms per participant, up to 12 characters each. Terms are deduplicated within each submission and counted by participants. Aggregation is independent of pagination; the top 60 terms are returned, the canvas reports actual visible counts, and the teacher table/CSV retain all valid content.
- The 1440 × 810 canvas scales by `min(available width / 1440, available height / 810)` with centered margins. Prompts allow 60 characters and choice labels 24 to bound single-screen content. A button uses the browser Fullscreen API.
- Activity settings belong to a classroom. Its first response locks that question even after deletion. New classrooms inherit settings with reset revisions; existing classroom IDs, links, sessions, and records retain their semantics.
- `/api/results` enforces classroom ownership, activity, page access, and a submission receipt. Teacher results still require teacher authentication. Deletion clears content and removes it from pies, clouds, and exports.
- Shared PostgreSQL, polling, and teacher revision checks remain. Cookie/iframe protections are unchanged. No external AI or chart dependencies were introduced.

## Investigation

| Finding                                                                        | Cause                                                                  | Repair and verification                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Teacher blank screen when switching choice to word cloud                       | The component briefly rendered the previous activity’s loaded data     | Key results by classroom, activity, and role; repeated transitions with populated data passed without new script errors                                                                                                                   |
| Maximum prompt, six maximum-length options, and first identity form overflowed | A separate checkmark region reduced option text width                  | Tightened spacing and used color/letter selection cues; longest content no longer clips or scrolls the page                                                                                                                               |
| Three maximum-length terms squeezed the submit button                          | A redundant pre-submit term preview consumed space                     | Removed the repeated preview and kept inline validation; submitted term cards remain and passed maximum-content checks                                                                                                                    |
| Equal votes showed 33.4%, 33.3%, 33.3%                                         | Remainders were allocated to force a 100% total                        | Round independently so equal counts show 33.3%; explain possible rounding discrepancy in the UI                                                                                                                                           |
| Older count assertions failed                                                  | They listed only Discover/Design instead of the three additional kinds | Updated complete count objects; legacy and new workflows passed                                                                                                                                                                           |
| Old databases rejected new submission kinds                                    | The 0.5 CHECK allowed only Discover/Design                             | Rebuild SQLite submissions atomically while retaining sequence high-water marks; update PostgreSQL constraints under the initialization lock. Receipts, identities, sessions, and classrooms survived; concurrent replica upgrades passed |

## Validation scope

- SQLite: 46 of 50 passed, four PostgreSQL-specific tests skipped. Local PostgreSQL: all 50 passed. Production build passed.
- A new 500-participant test exercises 500 joins, 1,500 submissions, and 1,500 result reads across the three activities, including proportions, word counts, and deletion. It uses injected application requests with local databases, **not production gateway or real-browser concurrency testing**.
- Browser checks covered question editing, per-activity gates, skipping an unanswered prior activity, maximum prompt/option/term lengths, charts after submission, pause/closure/resume, fullscreen, and teacher result transitions.
- Tested 1920 × 1080, 1366 × 768, 1280 × 720, 1024 × 768, and 1280 × 800. Student canvases retained 16:9 without document overflow. Word layout has separate boundary, collision, and stability tests.
- All data was isolated QA/demo data. Existing local preview storage was not modified. No Coze production database, password, replica setting, or deployment was changed.

## Reproduction

```bash
npm ci
npm run check
# Use an isolated test database, never formal production data.
TEST_DATABASE_URL=postgresql://127.0.0.1:55439/classroom_test npm test
node scripts/qa-server.js
```

QA listens on local port 3219, prints a test-only password, and creates a new ignored data directory. Open the copied student link in a separate browser context. Verify the locked panel before and after selecting an answer, then submit to reveal results. A teacher activity switch must lock the next activity until its own submission. Repeat for all three activities, pause, close, and resume.

Maximum-layout case: configure a 60-character prompt and six 24-character options, leaving a new student’s identity unfilled. Use three 12-character terms for the cloud. At each viewport above inspect cards, controls, labels, and charts. `test/browser/flow.js` is a historical 0.5 Discover/Design script, not evidence for the new 0.6 flow.

## Upgrade and rollback

1. Back up the actual deployment database and stop classroom writes. Preserve platform `.coze`, environment configuration, and database bindings. Never replace production data with demo data.
2. Fetch a commit containing 0.6, build, and start against existing storage. Automatic migration extends the submission-kind constraint while retaining content, classroom IDs, passwords, and teacher sessions. PostgreSQL initialization uses a shared lock across replicas.
3. Verify 0.6.0 health on the actual domain, sign in and reload the teacher page, and check the original fixed link. Legacy Discover/Design remains compatible; teachers can select the new activities. Use an isolated classroom for exercises because the first response locks a question.
4. Production acceptance must verify all activities, gates, switching, deletion, charts, and CSV. Local checks do not replace it. The earlier two-process HTTP load test was not rerun this time; its historical evidence remains in the prior record.
5. Before rollback, stop writes and back up new responses. Version 0.5 does not understand the new activity kinds: do not merely revert code and continue collecting answers. Reconcile new data and restore matching code/database backups. Do not clear storage to fix constraint errors.

Code, tests, and sanitized records are committed to GitHub. Merge status follows the PR and remote `main`; a code publication is not a Coze deployment.
