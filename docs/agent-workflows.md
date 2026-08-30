# Agent workflows

AUTO-05 adds bounded, sequential agent workflows on top of AUTO-04 operation
proposals. A workflow is an inspectable plan, not a second Pipeline engine or
an agent-only mutation path.

## Contract

An external agent or human client calls `create_agent_workflow` with:

- a goal;
- a versioned plan containing 2 to 20 ordered steps;
- one bounded tool name and exact AUTO-04 operation per step;
- immutable Dataset Version or published Pipeline Definition Version input
  references where the workflow depends on scientific inputs;
- agent, tool, model, and invocation provenance;
- maximum operations, tokens, and cost in micro-US dollars;
- planning usage and an actor-bound idempotency key.

PostgreSQL validates each step's bounded tool and operation shape before it
stores the plan, and validates the first operation against current state. It
revalidates every exact operation against current state immediately before
creating that step's proposal. This permits a later step to name the Dataset
revision produced by an earlier step without weakening execution-time
optimistic concurrency. The complete plan, goal, budget, initial usage, and
provenance are hashed; the stored plan and digest never change.

The v1 tool allowlist contains only:

- Dataset Schema draft creation;
- Sheet Definition draft creation and draft update;
- Pipeline Definition creation, draft-version creation, and draft update;
- Dataset row commit.

Publish, submit, sign, amend, lock, delete, archive, and arbitrary RPC tools
are absent.

## State and approval

The workflow creates one AUTO-04 proposal for its current step. If AUTO-04
classifies that proposal as `automatic` or `delegated`, the canonical mutation
runs immediately and the workflow continues to the next step. If the proposal
is `human_required`, the workflow enters `waiting_approval`. A human session
with the capability required by that operation must then approve and execute
it. `advance_agent_workflow` only observes the proposal outcome:

- a pending, approved, or executing proposal leaves the workflow unchanged;
- a succeeded proposal completes the step and creates the next proposal, which
  may itself auto-execute;
- a rejected, failed, or cancelled proposal pauses the workflow;
- the final succeeded proposal completes the workflow.

No workflow RPC executes a scientific mutation. AUTO-04 continues to call the
canonical Dataset, Sheet Definition, Dataset Schema, or Pipeline Definition
RPC, either automatically under policy or after human approval.

## Recovery and cancellation

Only a human session can call `resume_agent_workflow`. Resume revalidates the
same pinned operation and creates a new proposal attempt. It cannot edit or
substitute a step. A stale operation therefore stays paused until the user
cancels it and an agent submits a new plan.

If a future step no longer validates when reached, the workflow records the
error and pauses without creating an executable proposal.

The creating external credential or a workspace writer can cancel a workflow.
Cancellation records a reason, cancels a pending or approved proposal, and
marks unfinished steps cancelled. A cancelled proposal cannot later be
approved or executed.

## Budgets and usage

`report_agent_workflow_usage` records positive token and cost increments on
the append-only workflow timeline. Proposal attempts consume the operation
budget. Crossing any limit changes the workflow to `budget_exhausted` and
cancels a pending or approved proposal before it can mutate data.

`/agent-operations` shows plans, input references, proposal attempts,
provenance, operation/token/cost limits and usage, recovery state, and the
workflow event timeline. The proposal tab retains the exact per-operation
preview, diff, approval, execution, and canonical evidence path.

## External boundary

`agent_operations:write` allows external credentials to create, advance,
report usage for, and cancel workflows they created.
`agent_operations:read` allows access to `agent_workflows`,
`agent_workflow_steps`, and `agent_workflow_events` under workspace RLS.

External credentials cannot resume workflows, approve proposals, or execute
proposals. Those operations require a human session.
