# Roadmap 5: complete scientific workflows

Status: **proposed**, 2 October 2026. Inspected branch: `roadmap-4/ui-app3`, commit `e5801327`. This proposal does not certify Roadmap 4 complete, activate implementation, or claim deployment acceptance.

Sheetbase now has much of the interface and many of the operations needed for scientific work. The next programme should make those operations work together: capture an observation, preserve its identity, analyse the full data, review the result, deliver the evidence, and recover it after a failure.

The recommended central workflow is:

> A scientist starts an experiment, records or imports sample measurements, analyses them with a pinned method, reviews the result with a colleague, and shares an approved evidence package. The same results survive later edits, retries and a restore.

## Why this programme

The inspected code supports a more specific roadmap than the September status notes suggest:

- Bench readings and sample measurements exist, but the current measurement table does not identify a Dataset row, field, version, experiment or instrument. The earlier planned-row and source-link promises remain unfinished.
- Import is limited to 10 MiB and 1,000 rows. Scientific analysis has a separate 10,000-row browser ceiling. Increasing intake alone would leave the downstream workflow blocked.
- Sheets compose multiple sources and local fields, while reusable analysis explicitly consumes one Dataset. Scientists need an explicit, reproducible handoff between them.
- Pipeline execution supports considerably more than its current editor exposes. Pinned inputs and runtimes make scientific validation cases possible, but they need a safe execution contract before becoming a feature.
- Search facets operate on the first 100 results. Protocol training identifies a protocol record rather than the trained version. Client Reports now exists, but its list does not provide a complete evidence-delivery experience.
- CI has real-service visual parity, but functional API/browser acceptance remains manual. Recovery and packaged SDKs need stronger end-to-end evidence.

See [BASELINE.md](BASELINE.md) for source references, confidence and corrected historical claims.

## What to do first

1. **R5-BASE-01:** use the completed [Roadmap 4 reconciliation](../../docs/knowledge/roadmap-4/RECONCILIATION.md), then select the follow-on scope and its exact prerequisite exits. Original tasks retain ownership.
2. **R5-BASE-02:** automate one real-service scientific workflow, including frozen evidence and permission isolation.
3. **R5-CAP-01:** connect bench readings to canonical scientific data. This is the first substantial product feature.
4. **R5-BASE-03 and R5-BASE-04:** finish first-use guidance and complete search results. These are smaller improvements that can proceed alongside the bench work.
5. **R5-CAP-02 and R5-SCI-01:** deliver larger intake and full-data analysis together.

Start the populated restore proof early, using the acceptance fixture. It must pass before real laboratory data depends on the system.

## Programme

| Stream                                                 |  Tasks | User outcome                                                                                  | Priority                |
| ------------------------------------------------------ | -----: | --------------------------------------------------------------------------------------------- | ----------------------- |
| [Baseline and daily use](tasks/BASE.md)                |      4 | A new user can complete a scientific workflow and find their work; delivery gates prove it    | First                   |
| [Traceable capture](tasks/CAP.md)                      |      3 | Bench and imported observations become attributable, reusable scientific data                 | First product milestone |
| [Reproducible analysis](tasks/SCI.md)                  |      3 | Analyse complete datasets and explicitly captured composed Sheets; compare pinned experiments | Core                    |
| [Dependable automation](tasks/RUN.md)                  |      3 | Exercise real SQL/Python runs, validate changes, and deliberately promote tested versions     | Core                    |
| [Scientific collaboration and delivery](tasks/TEAM.md) |      3 | Discuss actual Sheet cells, identify protocol qualifications, and deliver approved evidence   | Core                    |
| [Recovery and public clients](tasks/OPS.md)            |      3 | Recover populated work and use installed SDKs against the real service                        | Release gates           |
| [Optional live assistance](tasks/AI.md)                |      1 | Explain validation failures with cited, permission-scoped context                             | Conditional             |
| **Total**                                              | **20** |                                                                                               |                         |

There are 19 proposed core tasks and one optional AI task. R5-OPS-02's live off-host activation additionally depends on the deployment choice. Task count is not an estimate of PR count; larger tasks are split into the bounded steps in their specifications.

## Relationship to Roadmap 4

Roadmap 4 owns interface adoption and the capabilities already promised by its task specifications. This proposal does not rename those tasks to make them appear newly discovered or completed.

The baseline file distinguishes:

- **Carry-over:** first-run guidance, search completeness, planned-row bench capture, version-specific protocol readiness and existing pipeline authoring exits.
- **Extension:** durable import jobs, full-data analysis, extensions to existing Sheet materialization for analysis, reusable pipeline validation, stable Sheet-cell discussions, and complete client evidence delivery.
- **Acceptance:** functional CI, real Python runs, populated recovery and installed SDK contracts.

When R5-BASE-01 finds an existing task still owns a requirement, retain that ID as the implementation owner and link its evidence from this programme. An overlapping R5 task owns the complete workflow acceptance and only the additional scope described here. Do not maintain two competing completion checklists for the same implementation.

In particular, **workspace-defined Record Models remain MDL-01..04 under accepted ADR-0051**. The current Models screen reads Dataset schemas. Complete or explicitly defer that requirement; do not interpret the screen's existence as implementation of the accepted record-model contract. Likewise, the accepted shared-grid/formula decision belongs to COMP-06 and ADR-0048, not a new R5 rewrite.

## Success criteria

- A person can start from an empty permitted workspace and reach a useful scientific draft without SQL or manual fixture injection.
- A bench observation or imported value has one authoritative write target and inspectable source identity through analysis and submission.
- Supported large workloads use all eligible rows for statistics. Display sampling is labelled and does not alter the analysis population.
- A cited result identifies input versions, schema/field identities, method/configuration and relevant runtime. Later changes do not rewrite submitted evidence.
- Pipeline validation cannot send notifications, mutate ordinary ELN records or count a cached prior run as a new validation result.
- Client recipients can open and download only explicitly shared evidence. Revocation blocks future access without claiming to recall prior downloads.
- A populated replacement stack reproduces the original frozen results, file hashes and access boundaries.

Targets in the task files are proposed engineering acceptance targets, not measured performance or contractual service guarantees. The initial programme optimises one representative bench experiment and one instrument-export workflow before adding more scientific methods or instrument families.

## Boundaries

Keep PostgreSQL/RLS, canonical Dataset/Record/Sheet identities, ChartSpec, existing Pipeline versions/runs, and human attestation authoritative. Reuse the adopted v3 interface and shared component work. No new general workflow engine, arbitrary join engine, generic Sheet Version, automatic local-field promotion, whole-app rewrite, organisation hierarchy, instrument fleet platform or blanket compliance claim.

ADR-0045 is now accepted with a September owner decision. Formal validation packs still require their named filing/inspection gate. ADR-0044 remains proposed. This roadmap does not silently change either status.

## How to use this proposal

Read [BASELINE.md](BASELINE.md), [PROGRAMME_MAP.md](PROGRAMME_MAP.md), [GUIDE.md](GUIDE.md), then the complete task stream. All tasks start as **PROPOSED**. The programme map is the proposal's status index; it is not a replacement for the active Roadmap 4 tracker.

The recommendations come from current source, tests, workflow definitions and accepted decisions. This was a repository survey, not a test run or deployed acceptance exercise. Hosted CI, registry publication, deployment users, production configuration, visual quality and performance were not independently verified.
