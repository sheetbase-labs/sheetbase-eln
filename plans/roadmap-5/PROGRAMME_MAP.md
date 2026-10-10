# Programme map and status

All work is **PROPOSED** at `e5801327`, 2 October 2026. This is the only task-status table inside this proposal. Roadmap 4 was reconciled at `9bbd305c` on 2 October; its original task owners are retained. See [the reconciliation](../../docs/knowledge/roadmap-4/RECONCILIATION.md). This proposal is not activated.

Effort is a coarse engineering estimate including targeted verification: S is up to a day, M is roughly 2–4 days, L is roughly 5–10 days, XL needs multiple bounded PRs and re-estimation after its design step. These are not calendar commitments. High risk usually means scientific identity, evidence or access semantics, not a demonstrated vulnerability.

| ID         | Outcome                                            | Class                           | Priority            | Effort | Risk   | Depends on                                                           | Status   |
| ---------- | -------------------------------------------------- | ------------------------------- | ------------------- | ------ | ------ | -------------------------------------------------------------------- | -------- |
| R5-BASE-01 | Reconcile implementation and roadmap ownership     | Acceptance                      | P0                  | M      | Low    | None                                                                 | PROPOSED |
| R5-BASE-02 | Real-service scientific release gate               | Acceptance                      | P0                  | L      | Medium | BASE-01                                                              | PROPOSED |
| R5-BASE-03 | First scientific outcome and personal resumption   | Carry-over + extension          | P1                  | M      | Medium | BASE-01; WORK-02.2                                                   | PROPOSED |
| R5-BASE-04 | Complete filtered search                           | Carry-over                      | P1                  | M      | Medium | BASE-01; SRCH-02                                                     | PROPOSED |
| R5-CAP-01  | Bench observation through frozen evidence          | Carry-over + extension          | P1                  | L      | High   | BASE-02; DSET-01/LAB-03/MOB-02 reconciliation                        | PROPOSED |
| R5-CAP-02  | Durable, resumable large import                    | Carry-over + extension          | P1                  | XL     | High   | BASE-02; DSET-05 raw-file contract                                   | PROPOSED |
| R5-CAP-03  | Reusable, versioned intake profiles                | Extension                       | P2                  | L      | Medium | CAP-02; DSET-06 reconciliation                                       | PROPOSED |
| R5-SCI-01  | Full-data analysis and frozen reconstruction       | New                             | P1                  | XL     | High   | BASE-02; agreed workload fixtures                                    | PROPOSED |
| R5-SCI-02  | Extend existing Sheet materialization for analysis | SHEET-05 carry-over + extension | P2                  | XL     | High   | BASE-02; existing materialization contract; COMP/formula disposition | PROPOSED |
| R5-SCI-03  | Reproducible comparison across experiments         | New                             | P2                  | L      | High   | SCI-01, SCI-02                                                       | PROPOSED |
| R5-RUN-01  | Retained real SQL/Python/action examples           | Acceptance                      | P1                  | M      | Medium | BASE-02; PIPE authoring/runtime availability                         | PROPOSED |
| R5-RUN-02  | Scientific validation cases for pipelines          | New                             | P2                  | L      | High   | RUN-01; PIPE-01 side-effect-free preview                             | PROPOSED |
| R5-RUN-03  | Tested pipeline promotion and runtime lifecycle    | Extension                       | P2                  | L      | High   | RUN-02                                                               | PROPOSED |
| R5-TEAM-01 | Discussions anchored to stable Sheet cells         | New                             | P2                  | L      | Medium | BASE-02; Sheet identity contract                                     | PROPOSED |
| R5-TEAM-02 | Version-specific protocol readiness                | Carry-over                      | P1                  | L      | High   | BASE-02; LAB-07 version/policy decision                              | PROPOSED |
| R5-TEAM-03 | Approved evidence delivered to a client            | Carry-over + extension          | P2                  | L      | High   | BASE-02; PORTAL/REV sharing contract                                 | PROPOSED |
| R5-OPS-01  | Populated scientific recovery proof                | Acceptance                      | P0 before real data | L      | Medium | BASE-02 fixture                                                      | PROPOSED |
| R5-OPS-02  | Independently recoverable off-host backups         | Conditional rollout             | P0 before real data | L      | High   | OPS-01; destination/key/retention decision                           | PROPOSED |
| R5-OPS-03  | Installed SDKs against the public service          | Acceptance                      | P2                  | L      | Medium | BASE-02                                                              | PROPOSED |
| R5-AI-01   | One cited live validation explanation              | Optional                        | P3                  | L      | High   | BASE-02; provider/data/evaluation decision                           | PROPOSED |

Dependency references without an R5 prefix refer to the original Roadmap 4 task. An R4 dependency means its specific required exit must be met or an explicit changed decision recorded; it does not require all 86 R4 tasks to complete first.

## Delivery sequence

### Wave A: a complete small workflow

BASE-01, BASE-02, BASE-03 and BASE-04 establish current truth and daily usability. CAP-01 makes the first product milestone a bench reading carried through Dataset, analysis and frozen evidence. RUN-01 and OPS-01 can use the same seeded fixture and proceed alongside capture once BASE-02 is available.

Exit: the small real-service workflow passes, a new user can start it, search finds matching work beyond the first page, and a populated restore has concrete evidence. Hosted checks must report actual results at the tested SHA.

### Wave B: realistic scientific workloads

CAP-02 and SCI-01 share workload fixtures and are accepted together. CAP-03 follows durable intake. TEAM-01, TEAM-02 and OPS-03 are independent after their stated prerequisites.

Exit: an instrument-sized file produces complete, source-linked analysis; retried import does not duplicate rows; scientific exclusions and sample counts are explicit; installed SDKs can exercise the same supported contract.

### Wave C: reuse, change and delivery

SCI-02 extends materialization of composed work; SCI-03 compares pinned inputs. RUN-02 and RUN-03 validate and promote methods deliberately. TEAM-03 closes the reviewer-to-client workflow. OPS-02 must be finished before a deployment becomes authoritative storage for real work, regardless of wave naming.

Exit: a method/input change can be compared without rewriting previous results; a client downloads only its exact shared evidence; the workspace is recoverable after loss of its original host.

### Optional wave: demonstrated assistance

AI-01 starts only with a selected operation and evaluation criteria. Failure to demonstrate usefulness defers the feature and does not block the core programme.

## Rules for parallel execution

- Reuse one fixture contract, but run DB suites sequentially against the shared local test database, or give each worker an explicitly separate database/stack.
- Assign one migration owner at a time when tasks touch the same schema; regenerate against the current migration head.
- CAP-01 owns observation identity; CAP-02 owns import-job state; SHEET-05 retains composed-source ownership; SCI-02 extends existing materialization. They must agree their boundary before sharing columns or RPCs.
- A changed formula evaluator, schema or method version invalidates relevant numerical acceptance evidence. Rerun the bounded parity corpus and downstream evidence checks.
- Runtime images, SDK publication and backup destinations need their own authorised rollout. Code acceptance and deployment acceptance remain distinct.

## Evidence and completion

After assignment, statuses may become IN PROGRESS, BLOCKED with a named dependency, IMPLEMENTED, or ACCEPTED. ACCEPTED requires the task's semantic exits, command results, tested SHA and retained evidence. DEPLOYED is an additional observation with environment and time, never inferred from ACCEPTED. Do not mark overlapping R4 tasks done from this table alone.
