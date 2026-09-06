# Agent workflows

AUTO-05 adds bounded, sequential agent workflows on top of AUTO-04 operation
proposals. A workflow is an inspectable plan, not a second Pipeline engine or
an agent-only mutation path. Single operations, policy, and the proposal RPCs
are documented in [`agent-operations.md`](agent-operations.md).

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

## Policy-driven progression

This is the AUTO-05 addition: the workflow does not invent a second approval
model. It observes the AUTO-04 decision on each step.

After `internal.agent_workflow_propose_step` calls `propose_agent_operation`:

- `automatic` or `delegated` and `succeeded` — the step completes and the
  next step is proposed in the same transaction (and may itself auto-run);
- `human_required` / `pending` — the workflow stays `waiting_approval`;
- `failed` — the workflow pauses without a human execute click.

A mixed plan is the intended shape: drafts and delegated appends can finish
unattended; a Dataset update, unmatched credential, or exceeded row limit
stops the plan at that step. A human then approves that one proposal, calls
`advance_agent_workflow`, and later steps may auto-run again.

Resume is still human-only. If the resumed actor is a human session, a safe
draft will auto-execute on resume; a Dataset update will not.

## Advance

`advance_agent_workflow` only observes the current proposal:

- pending, approved, or executing — workflow unchanged;
- succeeded — complete the step and propose the next (which may auto-run);
- rejected, failed, or cancelled — pause;
- last step succeeded — workflow `succeeded`.

No workflow RPC executes a scientific mutation. AUTO-04 still calls the
canonical RPC, either under policy or after human approval.

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
provenance, operation/token/cost limits and usage, wall latency and step
rollups, recovery state, and the workflow event timeline. The proposal
tab retains the exact per-operation preview, diff, approval, execution,
and canonical evidence path.

## External boundary

`agent_operations:write` allows external credentials to create, advance,
report usage for, and cancel workflows they created.
`agent_operations:read` allows access to `agent_workflows`,
`agent_workflow_steps`, and `agent_workflow_events` under workspace RLS.

External credentials cannot resume workflows, approve proposals, or execute
proposals. Those operations require a human session.

## AUTO-PLUS-02: dry-run, approval gates, safe execution

No new engine and no new RPC. Everything below is a derived view over the
proposal and workflow tables plus the existing decide/policy path.

### Dry-run / preview

`dryRunAgentWorkflow(steps, proposalsById)` in `src/lib/agent-workflows.ts`
previews every step without advancing state: it is a pure join, issues no
RPC, and touches no revision, budget, or proposal. Steps already proposed
carry their stored PostgreSQL preview, impact, and risk class; planned
steps carry the catalogue prediction (tool mode, risk, predicted gate).
`/agent-operations` renders this as the Dry-run preview section before
approval, so a human sees each step's operation, mode (`draft` vs
`mutate`), risk, gate, and stored preview/impact line.

### Approval gates

Consequential (`mutate`-mode, `consequential_write`) steps require explicit
human approval per step through `decide_agent_operation`; the per-plan gate
is the rollup (`summarizeWorkflowApprovals`): pending-approval, approved,
and rejected step keys. Safe drafts and delegated create/appends flow
without a click under the existing automatic/delegated policy. Gates are
visible as per-step badges (`planned`, `flowing`, `pending-approval`,
`approved`, `rejected`, `failed`, `cancelled`, `succeeded`) and as
plan-header counts. Without loaded proposal data a proposed step fails
closed to `pending-approval`.

### Safe execution

- **Idempotency:** every step attempt proposes under
  `workflow:{workflowId}:{stepKey}:{1-based attempt}`
  (`workflowStepIdempotencyKey`, parity with
  `internal.agent_workflow_propose_step`). Resume proposes attempt + 1
  under a fresh key, so it never double-executes a prior attempt;
  reusing a key with different content fails `23505`, at both workflow
  and proposal level.
- **Bounded retry:** attempts consume the durable operation budget, so
  `workflowRetriesRemaining` (max − used) is the retry bound —
  `canRetryWorkflowStep` allows a human resume only while paused on a
  failed/rejected step with budget left.
- **Resume after partial failure:** completed steps keep their canonical
  results and are never re-executed; the failed step retries the same
  pinned operation as a new attempt; a stale later step stays paused
  until cancelled and re-planned.
- **Cancellation:** terminal but inspectable — completed steps keep
  status and results, unfinished steps flip to cancelled, the reason is
  recorded, and the event timeline stays readable. Continue with a new
  workflow.

No migration was needed: approval stays on the existing decide/policy
RPCs and every gate above derives from stored proposal columns.

## AUTO-PLUS-03: run provenance, evidence, evaluation

No new tables and no second engine. Everything below is a derived view
over the workflow, step, proposal, and event rows.

### Run provenance record

`buildWorkflowProvenanceRecord(workflow, steps, proposalsById)` in
`src/lib/agent-provenance.ts` projects one run into a single inspectable
record: workflow run (goal, plan digest, budget/usage, actors) → ordered
step attempts → linked proposals (status, approval policy and reason,
risk class, request digest, proposed/decided/executed actors, error) →
input version pins and output references. Steps without a stored
proposal yet carry nulls, never invented values. Output references are
operation-derived targets (always computable) plus result-derived ids
only from known canonical identity keys holding UUIDs; unknown result
shapes yield no refs rather than guesses.

### Evidence boundaries

`markProposalEvidence` / `markWorkflowStepEvidence` mark every
agent-produced output as agent-produced. Only a _succeeded_ proposal
carries a canonical result whose pins may enter submitted work after
human review; pending, approved-but-unexecuted, rejected, failed, and
cancelled outputs are marked not submittable with the reason.
`/agent-operations` shows the marking on both tabs. The marking is
information, never attestation: submit/sign RPCs stay denied to agent
credentials and only a human may submit or sign.

### Run cost/latency rollups

Metrics decision: run-level rollups live in
`summarizeWorkflowRunMetrics` on the stored workflow usage reporting
(budgets, used tokens/cost, step states, wall-clock timestamps) — not
in the AI-03 gateway registry, which stays scoped to per-model-call
telemetry. Gateway usage reaches a run through
`report_agent_workflow_usage`; the rollup only reads stored run state.
Wall latency is completed_at − created_at (null until completion).
`/agent-operations` renders latency and the per-state step rollup in
the Budget and usage section.

### Evaluation suites

`src/lib/agent-provenance.test.ts` evaluates the projections (joins,
output extraction, evidence marking, rollups).
`tests/db/agent-evaluations.test.ts` evaluates correctness (a
representative two-step run produces canonical Pipeline/Dataset
effects with a joinable provenance chain), permission isolation (every
human-only and cross-principal path fails closed at the database
layer), and failure behaviour (rejected, budget-exhausted, and
cancelled runs stay inspectable and resume the same pinned operation).
