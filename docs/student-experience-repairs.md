# Student-experience repairs

Verified locally on September 4, 2026. Scope: the six reproduced student-experience problems approved in this task. No commit, push, hosted release, or external system change was made.

## Repaired behavior

| Previous problem | Current behavior | Regression proof |
| --- | --- | --- |
| Saving a normal Git commit locked the student out. | Students can save progress, resume, sign in again, and submit newly committed work. The assigned repository, starting history, private-session protection, and selected file contents are still checked. | `student-commits.test.ts`, `repository.test.ts` |
| Simultaneous requests acknowledged work that disappeared. | Student and staff actions coordinate before reading and saving an assignment. Exact retries do not duplicate records. | `student-experience-safety.test.mjs`, `state-lock.test.mjs`, `live-student-state-adapter.test.mjs` |
| Incorrect arithmetic was accepted and could not be removed. | Arithmetic is checked before recording. Students can remove an erroneous draft calculation, including an older invalid entry, and add their correction. The original and removal remain in history. | `student-experience-safety.test.mjs`, including the actual student command |
| Staff could answer only one question per attempt. | Each question has its own preserved response. A second pending question remains actionable after the first reply. | Staff adapter and store regressions; live browser responses to two questions in one attempt |
| The local persona returned the same answer regardless of the question. | Questions use the frozen authored routes. Unknown or prerequisite-blocked requests release no facts; authored time costs and visible collection opportunities are retained. | Authored-question and prerequisite regressions; live wait-time, accuracy, and budget requests |
| Staff could not see important accepted reasoning. | Staff can read economics, estimates, calculations and sources, competency reasoning, feasibility, risks, citations, and prior accepted packets. | Exact reasoning conservation tests; accepted HTTP packet and browser readback |

## Verification

- Before changes, all six reported defects had been reproduced. Targeted regression tests failed before their corresponding fixes.
- Final `npm run verify` passed lint, type checks, and **292 tests across 27 files**, using Node 22.23.2 and npm 10.9.9. The starting suite had 271 tests.
- Real local HTTP requests acknowledged and retained all 10 simultaneous ledger entries. Replaying all 10 requests left exactly 10 entries.
- Eight separate processes preserved all eight updates. A killed lock owner recovered without taking ownership from a live process.
- The connected browser recorded two staff replies in the same attempt. Both replies were read back through the student interface.
- A complete synthetic no-build response was accepted. All six previously omitted reasoning areas appeared in both the staff response and the browser.
- Student-supplied HTML remained visible text: no injected image was created and no supplied script executed. Browser console: zero errors or warnings.
- The accepted packet was checked at 1280px and 390px. A narrow-screen overflow discovered during this pass was fixed; page width matched viewport width at both sizes.

Screenshots are local verification artifacts under `output/playwright/student-experience-*.png`.

## Independent adversarial review

The reviewer found two additional risks in the initial fixes. Both were repaired and independently retested:

- Killing a writer no longer leaves a permanently locked assignment. Independent recovery took 15 ms.
- Force-added private session files are rejected in the current commit and in earlier descendant commits, even after a later deletion. Ordinary student commits still pass. The check reads protected path names, not credential contents.

Student commands do not inspect running processes. Only the local service checks whether its recorded lock owner is still alive; it never inspects the student's editor, coding-agent activity, or unrelated processes.

## Remaining boundaries

This proves the same-machine, synthetic local pilot—not hosted readiness or a real student learning outcome. Hosted identity, repository readback, database access, provider behavior, and the blind pilot still require their existing runtime proof.

The separate local student and staff files do not share a crash-atomic transaction. Interruption between their writes can still require staff reconciliation. Unknown lock owners or reused live process IDs remain conservatively busy; interruption before acquisition may leave an unused private claim directory. These limitations are documented in the package READMEs.

The local persona uses authored text matching, not unrestricted conversational understanding. Missing information is reported as unavailable; these changes do not manufacture data or prescribe the student's estimates or decision.
