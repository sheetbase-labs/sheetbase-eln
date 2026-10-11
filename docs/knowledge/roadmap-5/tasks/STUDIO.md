# Analysis studio depth

The interface's analysis studio does more than the ELN's. Planned at `10a84a42`,
11 October 2026. Read [GUIDE.md](../GUIDE.md) and
[FINDINGS.md](../FINDINGS.md) section 5. ChartSpec, the analysis definition and
the frozen-source contract stay authoritative; extend them, do not fork them.

## R5-STUDIO-01: Analyse mode states its method

**Outcome:** an analysis says which model it ran, whether the assumptions held,
and what each term means. Priority P1, effort L, high risk. Depends on a
statistics decision (below).

**Current state and scope:** `src/lib/analysis-definition.ts:27` defines two
kinds — `descriptive` and `regression` (polynomial) — surfaced by
`src/components/viz/analysis-panel.tsx`. The design shows a linear/one-way-ANOVA
toggle, a fit plot, a Term/Estimate/SE/95% CI/p results table and an
assumption-check list. Scope: the analysis definition, the computation boundary
and the results presentation. Do not implement a statistics engine in the
browser, and do not present a model whose assumptions are unchecked.

**Decision required first:** which models are in scope, what the ELN is willing
to state as a scientific result, and where the computation belongs (server-side
SQL/extension versus a pinned runtime). Record it before implementation; the
task cannot be accepted on UI alone.

**Steps:**

1. Record the model scope and the authority for each reported quantity. A result
   the product presents as scientific must name its inputs, its method and its
   runtime identity — reuse the existing analysis/evidence provenance rather
   than inventing a second one.
2. Implement the computation at the chosen boundary, returning a term table and
   assumption checks as structured results, not pre-formatted text.
3. Present the method and its assumptions in the studio, including the failing
   case: an assumption check that fails must be visible and must not be
   auto-corrected or hidden.
4. Extend exports and the cited-analysis freeze to carry the method and its
   checks, so a cited result still describes the model it ran.

**Verification/exit:** unit tests with known-answer datasets for every supported
model (including a deliberately violated assumption), a test that a cited frozen
analysis keeps its method after the source changes, and `pnpm validate`. A
method with no test fixture does not ship. If ANOVA cannot be supported
honestly, record the deferral in [FINDINGS.md](../FINDINGS.md) instead of
shipping a visual approximation.

## R5-STUDIO-02: chart encodings are authored by drag-and-drop

**Outcome:** a field can be assigned to x, y, colour, size or facet by dragging
it, with a keyboard path that does the same. Priority P2, effort M, low risk. No
prerequisite.

**Current state and scope:** `src/components/viz/chart-configurator.tsx` assigns
fields through `NativeSelect` dropdowns. The design has a grouped field list
(measured, derived, run metadata) with a `+` role menu and drop-target
ShelfPills. Scope: the configurator's authoring surface only — the ChartSpec it
produces, the renderer and the field grouping rules stay as they are.

**Steps:**

1. Port the field list and role slots onto the adopted primitives, keeping the
   dropdown path available as the keyboard and fallback route (the two must
   produce the same ChartSpec).
2. Keep role validity explicit: an incompatible drop is refused with a reason,
   never silently reassigned.
3. Announce drag state and results to assistive technology, and provide a
   keyboard-only route to assign every role.

**Verification/exit:** component tests that both authoring paths produce the
same spec for the same assignment, that an invalid assignment is refused, and
that the keyboard path reaches every role; `pnpm validate`. Reuse the existing
field-role grouping rather than re-deriving it in the component.

## R5-STUDIO-03: stale sources and citations are explicit and resolvable

**Outcome:** when a newer dataset snapshot exists, the analysis says so and can
be updated deliberately; a saved analysis names what cites it. Priority P1,
effort M, high risk. Depends on the frozen-source contract already used by
cited analyses.

**Current state and scope:** `src/routes/analysis/new.tsx:1443` shows a stale
warning line with no resolution action; there is no "Cited by" column; the
Compare mode has no A/B swap or "match rows by" control. The design resolves a
stale source with explicit Keep/Update choices and shows citations from signed
records. Scope: the stale comparison and its resolution, the citation list, and
the compare controls. Do not weaken the rule that a cited analysis keeps the
versions it cited.

**Steps:**

1. Define what "stale" means against the frozen-source contract: which change
   makes a source newer, and which changes are irrelevant. Compute it at the
   canonical boundary.
2. Add the resolution actions — keep the pinned version, or update to a named
   version — recording the actor and the result through the existing history
   path. Updating a _cited_ analysis must not rewrite submitted evidence.
3. Add the "Cited by" list from the existing citation records, showing the
   citing record and whether it is signed or locked.
4. Add the compare controls (A/B swap, match rows by) with the row-matching rule
   stated in the UI.

**Verification/exit:** DB tests for staleness detection (source changed, source
unchanged, source removed), a test that updating an uncited draft leaves no
evidence change and that updating a cited analysis is refused or explicitly
versioned, component tests for the citation list and compare controls, and
`pnpm validate`.
