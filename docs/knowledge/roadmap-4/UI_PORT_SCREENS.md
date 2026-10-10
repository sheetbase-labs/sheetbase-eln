# UI port — current screen work

**Reconciled 2 October 2026 at `9bbd305c`.** The earlier 30 September inventory
is superseded by this source audit. [UI_PORT.md](UI_PORT.md) retains the port
history; [RECONCILIATION.md](RECONCILIATION.md) records evidence and complete
remaining scope for all tasks, with an
[update since the audit](RECONCILIATION.md#update-since-this-audit) for the
tasks closed after 2 October. This is a screen index, not another task tracker.

The v3 routes now contain real data-backed surfaces for measurements, results,
model editing, pipeline editing, protocol training, instruments and portal
messages. Their presence does not mean their original behavior is complete.

| Current surface                | Remaining behavior                                                                                                                                | Owner                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Shell/Home/Inbox               | Workspace switching, role-aware nav, unified shortcuts/theme, personal recents and first run; all work-item kinds                                 | SHELL-01/02/03, WORK-01/02/03     |
| Projects                       | Copy structure; milestone evidence/reorder; groups and effective-protocol enforcement; mixed folders and versioned files                          | PROJ-01..04                       |
| Experiments/Notebook           | Rich sample/Dataset inspectors, readiness/start enforcement, selected-cell provenance, full history, durable offline                              | EXP-01..06, SHEET-03              |
| Datasets/import                | Canonical flag comparison; true retention/keep/tombstones; complete recoverable import and versioned parsers                                      | DSET-01..06                       |
| Sheets/analysis                | Shared grid/chart consumption, audited source updates, approval, discussions and multi-source analysis via existing materialization               | COMP-01..07, SHEET-01..05         |
| Models/templates               | Workspace Record Model domain, approval/generated records, templates across all specified kinds                                                   | MDL-01..04, SHEET-04              |
| Samples/materials/bench        | Dataset-backed measurement provenance, reservations, timed holds/release, controlled stock, labels/resolver, validated planned readings           | LAB-01..05, MOB-02                |
| Instruments/protocols/schedule | Qualification-aware bookings, effective version/training and server readiness                                                                     | LAB-06/07, WORK-04, EXP-02/03     |
| Pipelines                      | Full step editor/test, human wait/resume, proposals, file outputs and typed notifications                                                         | PIPE-01..05                       |
| Review/evidence/portal         | Review-round behavior, meanings/reauthentication, frozen/live comparisons, hash verification, approved content/downloads and email client sign-in | REV-01..05, PORTAL-02             |
| Search/settings/mobile         | Server filtering/paging; formats, counters, groups, security enforcement and delivery controls; phone workflow acceptance                         | SRCH-01/02, SET-01..04, MOB-01/02 |

Route inventory must be read from current source. `/planner`, `/configure` and
old `/admin/*` pages are no longer evidence that milestones/model/settings work
has not started. Do not rebuild them or delete the legacy shell solely from the
old retirement list: inspect live consumers in `src/routes/__root.tsx` first.

Some v3 routes intentionally use a different path from the original proposed
screen. Verify behavior and redirects under the existing route; see the
[route dispositions](RECONCILIATION.md#acceptance-and-design-contract).

The current app-3 kit is `src/components/v3/ui/`; route inclusion is in
`src/routes/__root.tsx`. Use the authenticated `/api/db` or session-preserving
server boundary. Complete capabilities through their existing task, including
server enforcement and truthful unavailable/empty states.

DSYS-05/06 still need mapped populated states and an effective visual gate.
Historical browser/script counts in the port log were not rerun here; local
service contents and seed failures from the earlier handoff were not rechecked.
A new acceptance run must record fixture, revision, auth roles and tested states.
