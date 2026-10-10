---
id: subtask-152
title: EXP-02.2 — Protocol progress
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-150
tags:
  - EXP-02.2
  - EXP
---

# EXP-02.2 — Protocol progress

Step 2 of 4 in [EXP-02](../../tasks/EXP.md#exp-02--overview-plan-progress-and-readiness); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented by the coordinator. The overview used to say 'Step progress is not recorded'; it is. A procedure_step block carries the pinned protocol revision it came from (sourceProtocolRevisionId), the step block it came from (sourceStepBlockId), whether it is done, and who finished it and when (completedByUserId/completedAt) plus a note. LAB-07's step model does not exist yet, so this derives from what the notebook actually records, which is what the step asks for until LAB-07 lands. Each step renders with its number, text and note, and either Done with the person and time or Not started; a step with no recorded state is not presented as done, and an experiment with no such steps says no progress is recorded rather than inventing steps. Five tests in the overview file. Note: 'evidence links' per step are not rendered because the step payload carries no evidence link of its own - the block's links are the notebook's, not the step's.
