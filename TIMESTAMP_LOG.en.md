# Project timestamps and handoff log

[中文](TIMESTAMP_LOG.md) · [Back to README](README.en.md)

## 2026-09-22 · Independent simplification and local validation

- Source: `bd4rex/tongpin-classroom-feedback`, `main`, baseline `f597af64b2ac199ba69dd6eb301ba5317027c64a`. Only source and configuration were read; the original working tree remains clean.
- New project: `ai-classroom-workshop`, titled “AI 共创课堂,” with separate code, Git history, and runtime data.
- Confirmed requirements: discovery and design have independent switches; the school list will be supplied later and currently uses an explicit placeholder.
- Implementation: school/name collection, two fixed forms, two submissions, shared table rows, realtime notifications, search and pagination, CSV, new classrooms, persistence, and teacher authentication.
- Validation: 14 automated tests and the production build passed; production dependency audit reported 0 known vulnerabilities; a teacher and two isolated students completed the browser workflow, including desktop and a 390-pixel mobile viewport.
- Pre-publication checks exclude runtime databases, credentials, actual environment configuration, dependencies, build output, and browser screenshots.
- Handoff limits: no target server deployment; final school list pending; Docker, reverse proxy, actual wireless network, and real classroom capacity remain unverified.

## GitHub publication

- 2026-09-22 13:19 (Asia/Shanghai): created and read back the private repository [bd4rex/ai-classroom-workshop](https://github.com/bd4rex/ai-classroom-workshop), with default branch `main`.
- Initial implementation commit: `a267ecefd9d5b02170df47e58f64c4ef9a110782`, containing 32 files; pushed successfully.
- Publication read-back: local `HEAD` and `git ls-remote origin refs/heads/main` both matched that commit, with a clean working tree at publication.
- Original project recheck: still at `f597af64b2ac199ba69dd6eb301ba5317027c64a`, with a clean working tree.
- The isolated browser test service has been stopped. Follow the README for normal operation. GitHub publication does not mean deployment to a school server.
- This entry is retained in a follow-up documentation commit. Use `git log -1` and remote `main` for the subsequent current version.

## 2026-09-22 13:37 · Six-school list published

- Configured six schools in `config/schools.json`, preserving the user's exact names and order, and removed the placeholder. Both READMEs contain the full list.
- API tests and the browser script use actual configured options rather than depending on the placeholder name.
- `npm run check` passed: 14 tests and the production build. An isolated API check confirmed that all six schools can submit and the old placeholder is rejected. The complete browser workflow was not rerun for this update.
- Repository: `bd4rex/ai-classroom-workshop`; branch: `main`; school-list commit: `5160970a52373a47ac69a74c52ca63a3578be352`. Pushed and verified that local `HEAD` matched remote `main`.
- The pending school-list item is complete. No server deployment was performed; any existing instance needs to pull the update and restart to load the new list.

## 2026-09-22 14:25 · Teacher-synchronized progression and gated sharing

- Updated user confirmation: the teacher controls page access and the current topic. All students follow a switch to design, even without a discovery submission. Peer responses appear on the right only after submitting that same topic.
- Version 0.2.0 adds waiting, discovery, design, pause/resume, and ending states; split layout, forum-style rows, independent server-side reading gates for each topic, retained drafts, and identity collection on the first actual submission.
- Computer-room desktops are the primary interface target, with landscape tablets and classroom displays also considered. Narrow phones are not a dedicated adaptation target. Viewports checked: 1366 × 768, 1024 × 768, and 1920 × 1080.
- Validation: 21 automated tests and the production build passed. One teacher and two isolated students completed the browser workflow without page exceptions or console errors, covering synchronized topics, skipping the first submission, independent unlocks, pause, page gating, ending, search, drafts, and reload recovery.
- Local preview: stopped and backed up the existing preview database before upgrading, retaining its classroom code and demonstration work. Version 0.2.0 is running at `http://127.0.0.1:3218`; teacher and unsubmitted-student pages are open. Preview data and backups remain excluded from Git.
- Repository: `bd4rex/ai-classroom-workshop`; branch: `main`; feature commit: `124cf737a897abde9df1378c23504a3e2bc1000c`. Pushed and read back, confirming that the local commit matches remote `main`.
- The original project remains at `f597af64b2ac199ba69dd6eb301ba5317027c64a` with a clean working tree. No school-server deployment, physical-device acceptance, wireless-network acceptance, or real classroom capacity acceptance was performed.
- This bilingual handoff entry is retained in a follow-up documentation commit. Use local `HEAD` and remote `main` for the subsequent current version.

## 2026-09-22 22:16 · Fixed student links and automatic entry

- Removed classroom-code entry as requested. Teachers copy a fixed student link and students enter automatically. Each classroom's `/classroom/<classroom ID>` path is determined when it is created.
- The same classroom link survives topic switches, pause, closure, ending, reloads, and restarts. A new classroom has a separate link; old links show their original classroom as ended and never enter the new one. Previously distributed legacy links retain their original classroom mapping.
- Per-topic submission-before-sharing remains enforced. Student sessions, response lists, and submissions bind to the visited classroom; repeated visits reuse the same browser identity.
- The copy button includes a fallback for school-network HTTP. Browser tests verified copied contents both with the Clipboard API and with that API unavailable.
- Validation: 25 automated tests, the production build, and the full browser workflow with a teacher and two isolated students passed, covering copying, automatic entry, stable links, old-link isolation, and existing classroom synchronization. Dependency versions are identical to the previous release; `npm ci --ignore-scripts --no-audit --no-fund` passed in an isolated directory.
- The local preview was stopped, backed up, and upgraded to 0.3.0, preserving the classroom, password, and responses. Teacher and fixed student-link pages are open and the local preview remains running. Runtime data, backups, and passwords are excluded from Git.
- Repository: `bd4rex/ai-classroom-workshop`; branch: `main`; feature commit: `6e3c5e58b51a285eda6bbd7563ca6b11c9377c6e`, pushed and read back successfully. This log and the dependency-lock correction are published in the following commit; use local `HEAD` and remote `main` for the current version.
- The original project remains clean. No school-server deployment was performed. Distribution across schools requires a consistently accessible server address or domain and retention of the classroom database.
