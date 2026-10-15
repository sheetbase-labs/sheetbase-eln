# Notebook and review fidelity

Two depth gaps in how the notebook and the review surface present scientific
work. Planned at `10a84a42`, 11 October 2026. Read [GUIDE.md](../GUIDE.md) and
[FINDINGS.md](../FINDINGS.md) sections 6–7. Both need an existing contract
confirmed before implementation.

## R5-NOTE-01: review presents the annotated document

**Outcome:** a reviewer reads the frozen revision with marks in place and
comments anchored to the change they belong to. Priority P2, effort L, high
risk. Depends on review-round semantics staying as they are.

**Current state and scope:** the ELN renders a structured revision diff
(`src/components/review/revision-diff-review.tsx`); the design renders the
document itself with inline insertions/deletions, a Δ change gutter, change
cards inside the document and anchored comments
(`components/review/review-document.tsx`). Searches for
`ChangeMark|Δ|<ins|</del|tracked` under `src/components/review` return nothing.
Scope: the review reading surface. The signature, amendment and promotion flows
are present and out of scope.

**Steps:**

1. Confirm the revision/round model and what is frozen at submission; the
   annotated view must render the frozen revision, never a live document.
2. Add the marked reading view: inline insertion/deletion marks, the change
   gutter and change cards, driven from existing diff data rather than a new
   comparison.
3. Anchor comments to their location and keep them navigable both ways (comment
   to location, location to comment), including for comments that no longer
   apply after an amendment.
4. Keep the diff view available: some reviews are better read as a change list.
   Do not remove a working surface to add the new one.

**Verification/exit:** component tests for a revision with insertions,
deletions, unchanged content and an orphaned comment; a browser check that
review at phone width does not overflow and keeps the comment anchors usable;
`pnpm validate`. A revised revision that changes what a comment referred to must
show that the comment no longer applies rather than silently re-anchoring it.

## R5-NOTE-02: notebook signature and action blocks, and one e-sign dialog

**Outcome:** the notebook carries signature requests and corrective actions as
blocks, and signing uses one dialog with re-authentication, meaning and server
time. Priority P2, effort L, high risk. Depends on the REV-03 signing contract.

**Current state and scope:** `src/components/notebook/block-picker.tsx` has no
signature-request or corrective-actions block type, and `grep 'ESignDialog|ESign'`
over `src/` returns nothing: signing is per-flow dialogs plus `ReasonDialog`, and
signatures are a submit/sign flow rather than a block. The design also shows an
outline with a required-section checklist and a requested-signature table.
Scope: the two block kinds, a shared signing dialog over the existing contract,
the outline checklist and the requested-signature list.

**Steps:**

1. Confirm the REV-03 contract: re-authentication, meaning, attestation text and
   server time already exist — the dialog must consume that contract, not
   reimplement it.
2. Add the signature-request and corrective-actions blocks with their block
   semantics (identity, ordering, who may add them, what happens when the
   referenced revision changes).
3. Extract the single e-sign dialog and move the existing per-flow signing onto
   it, one flow at a time, keeping each flow's acceptance test green.
4. Add the outline's required-section checklist and the requested-signature
   table, driven from the same data as the blocks.

**Verification/exit:** component tests for both block kinds (add, render,
missing reference), a regression test per converted signing flow, a DB test that
a signature still records the actor, meaning and server time through the shared
dialog, and `pnpm validate`. No flow may lose its step-up requirement while
being migrated.
