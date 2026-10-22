# User-journey audit

Goal: ~100 end-to-end journeys across Sheetbase, each traced through the code on
`main`, to find places where a user is told something is wrong or missing but is
not shown how to resolve it.

Each domain file holds ~16–18 journeys in this shape:

### J-<DOMAIN>-<nn> <title>

- **Persona / goal:** who, and what they are trying to finish
- **Entry:** the screen or warning where the journey starts
- **Path:** numbered screens/actions the code actually offers (file:line)
- **Blockers hit:** warnings, empty or error states on the way, with the exact copy
- **Verdict:** `complete` | `partial` | `dead-end` (and the step where it breaks)
- **Fix:** the smallest change that closes it (deep link, state-aware copy, owner named, inline action)
- **Severity:** S1 blocks regulated or core work · S2 forces guesswork · S3 friction

A blocking state is only acceptable when it names the cause, who can resolve it,
and offers the next action (or names the person who can).

## Result (2026-10-18, read from code; nothing run in a browser)

102 journeys in six files: 43 dead-end, 51 partial, 8 complete.

| File                        | Journeys | Dead-end | Partial | Complete |
| --------------------------- | -------- | -------- | ------- | -------- |
| instruments-ingestion.md    | 17       | 8        | 8       | 1        |
| samples-materials.md        | 17       | 9        | 7       | 1        |
| notebook-records-signing.md | 17       | 7        | 8       | 2        |
| data-analysis-models.md     | 17       | 4        | 11      | 2        |
| pipelines-projects.md       | 17       | 5        | 11      | 1        |
| settings-auth-shell.md      | 17       | 10       | 6       | 1        |

### Recurring causes

1. **A write exists in the data layer but no screen calls it.** `acceptInvitation`,
   `instantiateNotebookTemplateVersion`, `retryOfRunId`, `certificateFileId`,
   `editSample`, `consumeSample`, `updateConnector` config. The warning promises an
   action the UI cannot perform.
2. **Warning without an action.** Calibration overdue, stale calculations, unsynced
   offline edits, late milestone, disabled Save with no reason.
3. **Link goes to the page you are on, or to a bare list.** Release basis, inbox run
   items, QR label scan, `?selected=` across tabs.
4. **"Ask a workspace admin" with no way to see who.**
5. **Raw database or contract errors shown to people.** SB115/SB116, `record is
locked`, `current signature certification required`.
6. **Silent failure states.** Removed or suspended user, expired session read as
   offline, failed load shown as empty.

### Fix first (S1, and each blocks other journeys)

- J-SET-01 invitations cannot be redeemed (also blocks J-SET-02 first signature, client portal)
- J-NBK-01 no way to start a notebook from a template
- J-PIP-03 / J-PIP-04 pipelines cannot keep a dataset or run with inputs
- J-INS-13 / J-INS-10 connector config and calibration certificate have no UI
- J-SAM-13 QR scan bypasses the quarantine banner
- J-DAT-01 "missing units" lands on a read-only grid

Unconfirmed claims to test before acting: J-INS-12 (booking guard fires on any past-due
calibration row), J-DAT-10 (Analysis list crash on a spec without `datasets`),
J-PIP-04 (what executes a manual run).
