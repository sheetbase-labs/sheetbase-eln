---
id: subtask-158
title: EXP-03.3 — Start checklist
type: subtask
status: todo
priority: medium
created: "2026-09-27"
updated: "2026-09-27"
parent: task-155
tags:
  - EXP-03.3
  - EXP
---

# EXP-03.3 — Start checklist

Step 3 of 5 in [EXP-03](../../tasks/EXP.md#exp-03--new-experiment-from-a-protocol); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: the required-items half has a declaration source after all, and it is already enforced - but not where the step says. A Notebook Template version's configuration carries `parameters`, each validated by internal.validate_parameter and carrying a `required` flag (src/lib/parameter.ts:156); internal.validate_notebook_template_version checks them. instantiate_notebook_template_version already collects the required parameters with no supplied input and raises on them (missing_keys, around line 111), so a notebook cannot be instantiated from a template with a required parameter left unset. What the step asks for is start_experiment refusing while required items are missing, i.e. a re-check at start, and that is not a small addition: the supplied inputs are not persisted on the record (only source_notebook_template_version_id is), so a start-time check has to reconstruct them from the instantiated Sheet instances' state.parameterValues through the placements' parameterMappings (internal.template_parameter_inputs_for_placement maps templateParameterId to definitionParameterId per placement). That mapping is the remaining work, and it is why this stays open rather than being closed on the instantiation enforcement alone: an experiment whose instance values were cleared or changed after instantiation would start today.
  - 2026-10-10: partially verified - api.start_experiment refuses while the PROJ-03 and LAB-07 rules fail (effective protocol version, and internal.assert_protocol_start_eligible covering lifecycle, exact-version acknowledgement and the project pin), which is the half with a concrete declaration source. The template-declared 'required items' half has no declaration to read: notebook template versions carry parameters and placements but no required-item list, while the only required-item declarations in the schema belong to Sheet Definitions. That is a decision to settle before this step can be called done, so it stays open.
  - 2026-10-09: the PROJ-03 and LAB-07 halves of the start checklist are implemented (drizzle/0351; tests/db/experiment-start-lifecycle.test.ts, 10 cases): start_experiment refuses an ineligible/unacknowledged/unpinned version and a project that requires one without a pin. Template-declared required items and private drafts remain unimplemented, so this step stays open.
  - 2026-10-09: server start checklist landed (drizzle/0351; tests/db/experiment-start-lifecycle.test.ts, 10 cases). start_experiment is the only draft->in_progress path and enforces PROJ-03 require_effective_protocol plus LAB-07 eligibility/training/pin; set_experiment_status owns the rest with allowed transitions and reasons. Remaining: template-declared required items, private drafts and the full /experiments/new page.
