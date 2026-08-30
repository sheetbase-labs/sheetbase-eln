# Agent operations

Typed, inspectable proposals for agent-authored changes. A proposal is a
durable envelope around one canonical Sheetbase mutation. It is not a second
write path: execution always calls the Dataset Schema, Sheet Definition,
Pipeline Definition, or Dataset row RPC a human client would call.

```text
Agent / credential
        │
        ▼
propose_agent_operation  (exact operation + provenance)
        │
        ▼
PostgreSQL preview, impact, risk class, policy decision
        │
        ├── automatic / delegated  → canonical RPC runs now
        └── human_required         → inspect, approve, then execute
        │
        ▼
Same validation, RLS, revision, audit, and evidence as the product action
```

The product surface is `/agent-operations`. Multi-step sequential plans are
AUTO-05; see [`agent-workflows.md`](agent-workflows.md) when that task is
present. The decision record is ADR 0043.

## Concepts

| Concept | Table / RPC | Notes |
| --- | --- | --- |
| Proposal | `api.agent_operation_proposals` | Exact operation, preview, impact, policy evidence, status, result, provenance |
| Event | `api.agent_operation_events` | Append-only proposal timeline |
| Policy | `api.agent_operation_policies` | Owner/steward delegation of create/append Dataset writes to one service credential |
| Propose | `api.propose_agent_operation` | Validates, stores, and may auto-execute |
| Decide | `api.decide_agent_operation` | Human approve or reject |
| Execute | `api.execute_agent_operation` | Human session; runs the canonical RPC |

## Supported operations

| Kind | Canonical RPC | Risk |
| --- | --- | --- |
| `dataset_schema.create` | `create_dataset_schema_definition` | Safe draft |
| `sheet_definition.create` | `create_sheet_definition` | Safe draft |
| `sheet_definition.update_draft` | `update_sheet_definition_draft` | Safe draft |
| `pipeline_definition.create` | `create_pipeline_definition` | Safe draft |
| `pipeline_definition.create_version` | `create_pipeline_definition_version` | Safe draft |
| `pipeline_definition.update_draft` | `update_pipeline_definition_version_draft` | Safe draft |
| `dataset_rows.commit` | `commit_dataset_row_batch` | Consequential write |

Publish, submit, sign, amend, lock, delete, archive, and arbitrary RPC calls
are absent. Adding one of those requires an explicit policy decision.

Reads and previews stay outside this model. Agents use the ordinary read
APIs.

## Policy

PostgreSQL classifies every proposal:

- **Safe draft** — reversible Definition create/update. Executes automatically
  when a credential has `schema:write` (or when a human session proposes it).
- **Human required** — default for Dataset row commits, and for any
  credential that lacks the matching canonical scope.
- **Delegated** — a Dataset **create or append** that matches an enabled
  policy for **this** live service credential, target, and row limit.

An owner or Data Steward creates a policy on `/agent-operations`. Each policy
names:

- one live workspace **service credential**;
- one operation kind (`dataset_rows.commit` in the product UI);
- a canonical target: workspace, project, or Dataset;
- `maxAffectedRows` (1–1000).

A policy never applies to a different credential, a revoked or expired
credential, a Dataset update or overwrite, or a row count above the limit.
Those proposals stay `human_required` with the evaluation recorded on the
proposal.

Credentials cannot create, disable, or approve policies. They cannot approve
or execute human-required proposals.

## Provenance and evidence

`propose_agent_operation` requires agent, tool, model, and invocation
attribution. The proposal stores:

- deterministic preview and impact;
- `risk_class`, `approval_policy`, matched policy id, reason, limits, target;
- `policy_evidence` (actor kind, scopes, create-only, row counts);
- request digest and caller idempotency key.

The proposal id is the Dataset commit idempotency key. Optimistic concurrency
uses both the proposal revision and the target revision. A conflicting change
between preview and execution fails visibly; it does not apply stale data.

Automatic execution records the acting credential. Human execution records
the acting user. The canonical mutation still emits its ordinary
`change_events` and evidence.

## External boundary

| Scope | Allows |
| --- | --- |
| `agent_operations:write` | Create and inspect proposals |
| `agent_operations:read` | Read proposals, events, and policies under workspace RLS |
| `schema:write` | Automatic safe-draft execution |
| `datasets:write` | Required for delegated Dataset create/append |

Exchange a service credential at `POST /api/token` as usual
([`external-api.md`](external-api.md)). Then call the RPCs through the
same-origin `/api/db/*` proxy, never PostgREST directly.

## Product surface

`/agent-operations` lists policies and proposals. For a human-required
proposal a capable member can inspect the diff, approve or reject, and
execute. Safe drafts and delegated writes appear as already succeeded, with
the policy reason and evidence still visible.
