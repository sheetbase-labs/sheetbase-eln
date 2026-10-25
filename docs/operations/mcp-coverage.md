# MCP coverage

This page records what a connected agent can read and change through MCP, and
what stays deliberately human-only. It is the checklist for “all necessary
parts of the site are available via MCP”.

The rule is: **MCP mirrors the canonical surface; it does not invent one.** A
read tool uses the same external-table allowlist, read scope and PostgreSQL RLS
as `/api/db`. A change goes through `propose_agent_operation` and the existing
approval ledger. A flag or scope can only reduce access.

## Read coverage

`sheetbase.canonical.read` covers every table in the external allowlist:

| Family                 | Resources                                                                                                                 | Scope                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Projects and notebooks | `projects`, `folders`, `records`, `blocks`, `record_links`, `revisions`, `record_models`, `record_field_definitions`      | `projects:read`                 |
| Datasets               | `datasets`, `dataset_versions`, `dataset_schema_definitions`, `dataset_schema_versions`, `dataset_schema_version_fields`  | `datasets:read` / `schema:read` |
| Sheets                 | `sheet_instances`, `sheet_definitions`, `sheet_definition_versions`                                                       | `sheets:read` / `schema:read`   |
| Templates              | `notebook_templates`, `notebook_template_versions`                                                                        | `templates:read`                |
| Agents                 | `agent_operation_proposals`, `agent_operation_events`, `agent_workflows`, `agent_workflow_steps`, `agent_workflow_events` | `agent_operations:read`         |
| Pipelines              | `pipeline_definitions`, `pipeline_definition_versions`, `pipeline_runs`, `pipeline_run_logs`, `pipeline_run_outputs`      | `pipelines:read`                |
| Webhooks               | `webhook_subscriptions`, `webhook_deliveries`                                                                             | `webhooks:read`                 |

The tool fixes the projected columns from the published row schema, allows
equality filters only, caps rows per resource, and returns `nextOffset`. Pipeline
logs and webhook delivery bodies are marked `untrusted`; connection strings and
secret-shaped values are redacted before the response leaves the server, and a
delivery's HMAC `signature` is replaced with `[redacted]`.

`sheetbase.context.assemble` remains the grounded envelope for records,
notebooks, sheets, datasets, dataset versions and analyses. `sheetbase.search`,
`sheetbase.dataset_rows.query`, `sheetbase.dataset_version_rows.query`,
`sheetbase.sheet_instance_rows.query` and
`sheetbase.sheet_instance.materialization_preview` remain the convenience reads.

The admin read tool covers the tables that are not on the external allowlist:
workspace settings/counts, members, credential metadata (owner only),
connectors, pipeline runs and schedules, instrument metadata, protocol
versions, analysis-definition metadata, file metadata, comments scoped to a
record, audit events and usage. It is personal-token only and requires an
owner, admin or steward role. Instrument and analysis reads project metadata
only; instrument configuration, analysis definitions and source revisions stay
out of the response.

## Change coverage

| Family             | What an agent can propose                                                                              | Still human                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Records            | Create a record; update custom fields                                                                  | Archive/restore, transition status, lock                   |
| Datasets           | Schema draft, row commit                                                                               | Publish a schema, archive/restore                          |
| Sheets             | Sheet Definition draft/update; create, update, archive or restore an Instance; materialise an Instance | Publish, upgrade                                           |
| Pipelines          | Definition draft, version draft, draft update                                                          | Start, retry, cancel, publish                              |
| Notebooks          | Insert, update, move or delete one block (always human approval)                                       | Submit, sign, amend                                        |
| Templates          | Instantiate an active protocol template; upgrade a notebook                                            | Create, instantiate a notebook template version            |
| Models             | Update custom fields; create/update/activate model fields                                              | Publish model-field changes, retire                        |
| Administration     | Workspace AI settings only                                                                             | Members/invites, connectors, schedules, credentials, flags |
| Signing and review | Nothing                                                                                                | Submit, sign, review decision, publication                 |

`sheetbase.notebook_block.insert` inserts through the canonical `api.insert_block`
RPC and records the record's `structureVersion` as the expected revision. The
update/move/delete variants use `api.update_block_payload`, `api.move_block` and
`api.delete_block` with the block or record revision they saw. All four are
always `human_required`; no delegation policy is offered for notebook content.

`sheetbase.record.create`, `sheetbase.record.custom_fields.update`,
`sheetbase.sheet_instance.create` / `.update` / `.archive` / `.restore` /
`.materialize`, `sheetbase.template.instantiate` / `.upgrade`,
`sheetbase.record.comment.create` and the three `sheetbase.model_field.*` tools
delegate to their existing canonical
RPCs. They are always `human_required`; no delegation policy is offered for
them yet. Materialisation requires the digest from
`sheetbase.sheet_instance.materialization_preview`; the contract recomputes it,
so the approval is bound to the composition the agent saw.

`sheetbase.workspace_ai_settings.update` is always `human_required`; approval
and execution need a live owner browser session.

## Accessibility

- Personal tokens act as their creating member; service tokens act as the
  workspace identity. Both use the same scopes and RLS.
- `admin:read` / `admin:write` and the admin read tool are personal-token only.
- Workspace AI access flags gate the assistant, MCP reads, drafts, workflows,
  admin reads and admin proposals. `mcp_read` gates the canonical read tool.
- MCP uses bearer credentials; OAuth 2.1 discovery and dynamic client
  registration are not implemented.

## Deliberate boundaries

1. Administration beyond workspace AI settings stays human-only: members and
   invitations, connectors, schedules, credentials, and access flags. These
   either grant access or move secrets, so the browser session remains the
   actor. The admin read tool exposes their metadata.
2. File content writes stay human-only. Binary upload is an object-store action,
   not a canonical RPC proposal. File metadata and record comments are
   readable, and notebook comment creation is exposed for personal tokens.
3. OAuth 2.1 discovery and dynamic client registration are absent; MCP uses
   bearer personal or service tokens.
4. Instrument, protocol-version, schedule and analysis-definition metadata is
   readable through the personal-token admin tool, not the project-scope
   canonical read. Sample, material and protocol-template records remain
   readable through `records`, and analysis through the context envelope.

## Invariant

`src/lib/mcp/canonical-read.test.ts` asserts that the canonical read resources
match `EXTERNAL_TABLE_ACCESS` exactly. Adding a table to the external allowlist
therefore fails the suite until MCP coverage is added. The handler tests cover
scope refusal, flag refusal, filter validation, page caps, service-token access
and log redaction.
