# Submit readiness API

What stands between an experiment and its submission, and whether it stops it.

An experiment is checked before it is submitted for review. `experiment_readiness` (see [experiments-reviews-api.md](experiments-reviews-api.md)) lists everything that is still open: record checks that failed, open comment threads, empty required sheet parameters, and two checks that are workspace rules:

- **Open steps.** Protocol steps (`procedure_step` blocks) nobody has marked finished. They come back as `openSteps`, each with its `blockId`, `stepNumber`, `partId` and `text`, in notebook order.
- **No decision.** The experiment has no decision (`supported`, `refuted` or `inconclusive`, see `set_experiment_decision`). It comes back as `decisionMissing: true`.

The workspace chooses what they do, with the setting below. The same function answers the Overview, the submit dialog, the reviewer and the submit call itself, so the list and the block cannot disagree.

| `mode`  | Open steps and no decision                                        | `ready`                    |
| ------- | ----------------------------------------------------------------- | -------------------------- |
| `off`   | Not checked. `openSteps` is empty and `decisionMissing` is false. | Unaffected                 |
| `warn`  | Listed everywhere, but the submission goes through.               | Unaffected                 |
| `block` | Listed, and the submission is refused until they are cleared.     | `false` while any are open |

New workspaces start on `warn`. A refused submission answers `record is not ready for submission` (SQLSTATE `SB123`) with the readiness result in `DETAIL`.

## Tables and columns

| Where                                      | Scope      | What it holds                                                  |
| ------------------------------------------ | ---------- | -------------------------------------------------------------- |
| `workspace_settings.submit_readiness_mode` | `lab:read` | The workspace rule: `off`, `warn` or `block` (default `warn`). |

## `set_submit_readiness_mode`

Sets the rule above. Needs Signatures settings access, so the person the token belongs to must be allowed to change it. It is on `sheetbase.lab.act` over MCP, in the Python and TypeScript SDKs, and the assistant offers it as a card (`sheetbase.submit_readiness.set`) that the person confirms. Returns the workspace settings and sends `workspace.settings.updated` with `effect: "submit_readiness"` and the new `mode`.

Scope: `lab:write`. Returns `row:workspace_settings`.

| Argument           | Type | Notes                     |
| ------------------ | ---- | ------------------------- |
| `p_workspace_id` * | uuid | Your workspace id.        |
| `p_mode` *         | text | `off`, `warn` or `block`. |

Submitting for review, approving and signing stay in the app. A token can change how strict the check is (the person it belongs to must have the access), never pass it on someone's behalf.

It is not a pipeline action: a run that could switch the check off would let automation loosen the guardrail. Pipelines can read the list (`experiment_readiness`) and stop on it.
