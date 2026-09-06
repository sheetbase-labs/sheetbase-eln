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
documented in [`agent-workflows.md`](agent-workflows.md). The decision record
is ADR 0043.

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

## Tool catalogue (AUTO-PLUS-01)

The bounded agent-callable surface is `src/lib/agent-tool-catalogue.ts`:
7 operation tools (6 `draft`, 1 `mutate`), 5 workflow lifecycle RPCs, and
4 read-only canonical reads — 16 entries total, each with a description,
zod input contract, existing server error codes, and the capability the
server asserts. Agents discover it through `listAgentTools` (mode +
capability filtering) and `describeAgentTool`; human-only attestation
(`decide`, `execute-as-human`, `resume`, submit/sign/amend/checks) is
listed in `UNAVAILABLE_AGENT_OPERATIONS` with reasons. `AGENT_OPERATION_TOOL_NAMES`
is the single authority behind `AGENT_WORKFLOW_TOOLS` and the AI gateway's `GATEWAY_TOOLS` (drift-tested).

## Policy

This is the AUTO-04 addition: execution is policy-driven, not “approve every
proposal”. PostgreSQL decides `approval_policy` at propose time and records
the evaluation on the proposal.

| Decision | When | What happens |
| --- | --- | --- |
| `automatic` | Safe draft, and the actor has `schema:write` (credential) or is a human session | `propose_agent_operation` calls the canonical RPC immediately |
| `delegated` | Dataset **create/append** matches an enabled policy for this credential, target, and row limit, and the credential has `datasets:write` | Same: the canonical commit runs inside propose |
| `human_required` | Everything else | Proposal stays `pending` until a human session approves and executes |

### Delegation policies

Owner or Data Steward RPCs (human session only):

- `api.create_agent_operation_policy(workspace_id, name, operation_kind, target_type, target_id, credential_id, limits)`
- `api.disable_agent_operation_policy(workspace_id, policy_id)`

The product UI on `/agent-operations` only creates `dataset_rows.commit`
policies. Each policy binds:

- one live workspace **service** credential (revoked or expired credentials
  never match);
- a canonical target: `workspace`, `project` (the Dataset’s primary project),
  or `dataset`;
- `limits.maxAffectedRows` (1–1000).

Matching uses the most specific enabled policy (Dataset, then project, then
workspace). Automatic Dataset writes are **create/append only**: any `update`
row in the batch stays `human_required` even if a policy matches. A policy
for credential A never authorises credential B.

Credentials cannot create, disable, or approve policies. They cannot approve
or execute `human_required` proposals.

### Evidence

Every proposal stores `policy_id`, `policy_reason`, `policy_limits`,
`policy_target`, and `policy_evidence` (`actorKind`, `credentialId`,
`requiredScope`, `scopeSatisfied`, `targetMatched`, `createOnly`,
`affectedRows`, `maxAffectedRows`, `limitSatisfied`). Inspect that payload
instead of inferring why a write ran or waited.

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
([`external-api.md`](../api/external-api.md)). Then call the RPCs through the
same-origin `/api/db/*` proxy, never PostgREST directly.

## Product surface

`/agent-operations` lists policies and proposals. For a human-required
proposal a capable member can inspect the diff, approve or reject, and
execute. Safe drafts and delegated writes appear as already succeeded, with
the policy reason and evidence still visible.
