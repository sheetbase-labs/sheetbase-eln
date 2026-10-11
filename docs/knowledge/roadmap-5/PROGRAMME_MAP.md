# Programme map and status

All work is **PROPOSED** at ELN `10a84a42`, 11 October 2026. This is the only
task-status table in this corpus. See [FINDINGS.md](FINDINGS.md) for the audit
each row comes from and [README.md](README.md) for the programme.

Effort is a coarse engineering estimate including targeted verification: S is up
to a day, M is roughly 2–4 days, L is roughly 5–10 days. These are not calendar
commitments. Risk means scientific meaning, evidence or access semantics — not a
demonstrated vulnerability.

| ID           | Outcome                                                                     | Class                          | Priority | Effort | Risk   | Depends on                       | Status   |
| ------------ | --------------------------------------------------------------------------- | ------------------------------ | -------- | ------ | ------ | -------------------------------- | -------- |
| R5-SURF-01   | Dataset detail carries its Imports, Used by and History tabs                | New surface over existing data | P0       | L      | Low    | None                             | PROPOSED |
| R5-SURF-02   | A project lists its own Datasets, Samples and Experiments                   | New surface over existing data | P0       | L      | Low    | None                             | PROPOSED |
| R5-SURF-03   | Unmatched URLs render the product's not-found screen                        | Fix                            | P0       | S      | Low    | None                             | PROPOSED |
| R5-SURF-04   | An import is addressable, resumable and can create a dataset                | Extension                      | P1       | M      | Medium | None                             | PROPOSED |
| R5-STUDIO-01 | Analyse mode states its method: ANOVA, assumptions, term table              | New                            | P1       | L      | High   | A statistics decision (see task) | PROPOSED |
| R5-STUDIO-02 | Chart encodings are authored by drag-and-drop shelf and role list           | Extension                      | P2       | M      | Low    | None                             | PROPOSED |
| R5-STUDIO-03 | Stale sources and citations are explicit and resolvable                     | Extension                      | P1       | M      | High   | Analysis frozen-source contract  | PROPOSED |
| R5-NOTE-01   | Review presents the annotated document, not only a diff                     | New                            | P2       | L      | High   | Review round semantics           | PROPOSED |
| R5-NOTE-02   | Notebook carries signature-request and action blocks, and one e-sign dialog | Extension                      | P2       | L      | High   | REV-03 signing contract          | PROPOSED |
| R5-HOME-01   | A quiet home says what is next                                              | Extension                      | P2       | M      | Low    | None                             | PROPOSED |
| R5-CONFIG-01 | Diagnostics and usage carry their evidence                                  | Extension                      | P2       | M      | Low    | Usage metering decisions         | PROPOSED |
| R5-CONFIG-02 | Instruments declare how data arrives and when it last did                   | Extension                      | P2       | M      | Medium | LAB-06 contracts                 | PROPOSED |
| R5-CONFIG-03 | Model versions can be submitted for approval and merged safely              | Extension                      | P1       | L      | High   | MDL-03 publication decision      | PROPOSED |
| R5-CONFIG-04 | Template in-use and version history are inspectable                         | Extension                      | P2       | M      | Medium | SHEET-04 governance              | PROPOSED |
| R5-CONFIG-05 | Milestones carry scale, dependencies, risk and date history                 | Extension                      | P2       | L      | Medium | PROJ-02 decisions                | PROPOSED |
| R5-SHELL-01  | Every product route gets the adopted shell                                  | Fix                            | P2       | M      | Low    | None                             | PROPOSED |
| R5-SHELL-02  | The theme is applied at first paint, not after it                           | Fix                            | P1       | S      | Medium | None                             | PROPOSED |
| R5-SHELL-03  | Capability flags have real keys and honest gap states                       | Fix                            | P1       | M      | Medium | None                             | PROPOSED |
| R5-SHELL-04  | Search and pickers carry their designed scope and suggestions               | Extension                      | P2       | M      | Medium | SRCH-02 follow-on                | PROPOSED |
| R5-SHELL-05  | Sign-in covers its designed states or records why not                       | Decision + fix                 | P2       | M      | High   | Authentication decision          | PROPOSED |
| R5-SHELL-06  | Pipeline code and artefact state are presented, not dumped                  | Extension                      | P3       | S      | Low    | None                             | PROPOSED |

## Delivery sequence

### Wave A — reach what already exists

SURF-01, SURF-02, SURF-03 and SHELL-03. These add no new domain capability: the
tables, the timeline component and the not-found screen are already in the
repository. Exit: a dataset shows its imports, usage and history; a project
lists its own datasets, samples and experiments; an unknown URL renders the
product's own screen; a deployment can name an unbuilt capability and the UI
says so.

### Wave B — the studio and the quiet home

STUDIO-01, STUDIO-02, STUDIO-03, HOME-01, SURF-04. Exit: an analysis states its
method and its inputs, resolves a stale source, and charts are authored without
form-filling; a workspace with nothing waiting reads like the design; an import
can be linked, resumed and aimed at a new dataset.

### Wave C — fidelity and configuration

NOTE-01, NOTE-02, CONFIG-01..05, SHELL-06. Exit: review reads as an annotated
document, the notebook carries signature and action blocks, and the
configuration surfaces carry the evidence the designs show.

### Wave D — platform decisions

SHELL-01, SHELL-02, SHELL-04, SHELL-05. These are sequenced last because two of
them need a decision (authentication states) or touch every route (theme at
first paint, shell coverage). Exit: one shell and one theme behaviour across the
product, with search and sign-in states matching their designs or a recorded
reason they differ.

## Ownership and non-duplication

- Where a requirement is already owned by a Roadmap 4 task or an accepted
  decision, the task file names it and this programme owns only the additional
  interface scope. Do not maintain a second completion checklist for the same
  behaviour.
- The interface source
  (`/Users/garethprice/Developer/sheetbase/sheetbase-app-ui-only`) is a design
  reference, not a dependency: nothing here adds it to the workspace or copies
  its fixture data.
- The unnumbered scientific-workflow proposal at
  `plans/roadmap-5/` is a separate programme. If it is activated, reconcile the
  two before either claims a shared outcome.
