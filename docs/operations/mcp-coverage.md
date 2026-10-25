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
`sheetbase.dataset_rows.query`, `sheetbase.dataset_version_rows.query` and
`sheetbase.sheet_instance_rows.query` remain the convenience reads.

The admin read tool covers the tables that are not on the external allowlist:
workspace settings/counts, members, credential metadata (owner only),
connectors, recent pipeline runs, file metadata, comments scoped to a record,
audit events and usage. It is personal-token only and requires an owner, admin
or steward role.

## Change coverage

| Family             | What an agent can propose                     | Still human                                                |
| ------------------ | --------------------------------------------- | ---------------------------------------------------------- |
| Datasets           | Schema draft, row commit                      | Publish a schema, archive/restore                          |
| Sheets             | Sheet Definition draft/update                 | Publish, instantiate, edit instance state                  |
| Pipelines          | Definition draft, version draft, draft update | Start, retry, cancel, publish                              |
| Notebooks          | Insert one block (always human approval)      | Update/move/delete blocks, submit, sign, amend             |
| Templates          | Nothing yet                                   | Create/instantiate, upgrade                                |
| Models             | Nothing yet                                   | Author model fields, publish                               |
| Administration     | Workspace AI settings only                    | Members/invites, connectors, schedules, credentials, flags |
| Signing and review | Nothing                                       | Submit, sign, review decision, publication                 |

`sheetbase.notebook_block.insert` inserts through the canonical `api.insert_block`
RPC and records the record's `structureVersion` as the expected revision. It is
always `human_required`; no delegation policy is offered for notebook content.

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

## Known gaps

1. Sheet Instance, template, model and domain-module writes are not exposed.
2. Admin changes beyond AI settings are not exposed.
3. File content and comment writes are not exposed; file metadata and comments
   are admin reads only.
4. Samples, materials, instruments, protocols, schedules and analysis are not
   on the external table allowlist. Analysis is available through the context
   envelope; the others need a scope and RPC design before MCP can expose them.
5. OAuth 2.1 discovery/dynamic client registration is absent.

## Invariant

`src/lib/mcp/canonical-read.test.ts` asserts that the canonical read resources
match `EXTERNAL_TABLE_ACCESS` exactly. Adding a table to the external allowlist
therefore fails the suite until MCP coverage is added. The handler tests cover
scope refusal, flag refusal, filter validation, page caps, service-token access
and log redaction.
