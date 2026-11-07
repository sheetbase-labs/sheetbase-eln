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

| Family                 | Resources                                                                                                                 | Scope                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Projects and notebooks | `projects`, `folders`, `records`, `blocks`, `record_links`, `revisions`, `record_models`, `record_field_definitions`      | `projects:read`                                                 |
| Datasets               | `datasets`, `dataset_versions`, `dataset_schema_definitions`, `dataset_schema_versions`, `dataset_schema_version_fields`  | `datasets:read` / `schema:read`                                 |
| Sheets                 | `sheet_instances`, `sheet_definitions`, `sheet_definition_versions`                                                       | `sheets:read` / `schema:read`                                   |
| Templates              | `notebook_templates`, `notebook_template_versions`                                                                        | `templates:read`                                                |
| Agents                 | `agent_operation_proposals`, `agent_operation_events`, `agent_workflows`, `agent_workflow_steps`, `agent_workflow_events` | `agent_operations:read`                                         |
| Pipelines              | `pipeline_definitions`, `pipeline_definition_versions`, `pipeline_runs`, `pipeline_run_logs`, `pipeline_run_outputs`      | `pipelines:read`                                                |
| Webhooks               | `webhook_subscriptions`, `webhook_deliveries`                                                                             | `webhooks:read`                                                 |
| Trusted timestamps     | `signature_timestamps`                                                                                                    | `reviews:read`                                                  |
| Validation runs        | `validation_runs`                                                                                                         | `admin:read`                                                    |
| Agent permissions      | `agent_action_policies`, `ai_eval_runs`, `ai_eval_results`                                                                | `admin:read`                                                    |
| Provenance             | `pipeline_reproductions`, `lineage_targets`, `lineage_deliveries`                                                         | `lab:read`                                                      |
| Robots                 | `instrument_robot_settings`, `instrument_jobs`                                                                            | `lab:read`                                                      |
| Scheduler              | `scheduler_settings`, `part_plans`, `part_resource_needs`, `schedule_proposals`                                           | `lab:read`                                                      |
| Code cells             | `code_cell_runs`                                                                                                          | `lab:read`                                                      |
| Data contracts         | `data_contracts`, `data_contract_runs`, `data_contract_dataset_status` (through `sheetbase.lab.read`)                     | `lab:read`                                                      |
| Open data              | `lake_tables`, `ontology_annotations`, `publication_targets`, `publications`                                              | `datasets:read` / `schema:read` / `admin:read` / `reviews:read` |

The tool fixes the projected columns from the published row schema, allows
equality filters only, caps rows per resource, and returns `nextOffset`. Pipeline
logs and webhook delivery bodies are marked `untrusted`; connection strings and
secret-shaped values are redacted before the response leaves the server, and a
delivery's HMAC `signature` is replaced with `[redacted]`.

`sheetbase.context.assemble` remains the grounded envelope for records,
notebooks, sheets, datasets, dataset versions and analyses. `sheetbase.search`,
`sheetbase.dataset_rows.query`, `sheetbase.dataset_version_rows.query`,
`sheetbase.sheet_instance_rows.query`,
`sheetbase.storage.readings` (freezer, fridge, incubator and room readings with
their alarm limits, optionally only those out of range) and
`sheetbase.sheet_instance.materialization_preview` remain the convenience reads.
`sheetbase.events.read` follows the workspace event stream (`event_stream_page`, `admin:read`):
every change after a sequence number, limited to what the person could see in the app.
Lineage endpoints are changed with `sheetbase.lab.act` (`save_lineage_target`,
`delete_lineage_target`, `retry_lineage_deliveries`, `set_event_stream_retention`).
Reproducing a run is `POST /api/pipelines/reproduce` and, in the assistant, the
“Reproduce run” card (`sheetbase.pipeline.reproduce`).
Logging readings is `record_storage_readings` through `sheetbase.lab.act`, the
same call loggers and scripts make over the API.

Robots, the scheduler and code cells use the same two tools. Robots are set up and
sent worklists with `set_instrument_robot`, `clear_instrument_robot`,
`queue_instrument_job` and `cancel_instrument_job` through `sheetbase.lab.act`;
`start_instrument_job` is there too, but starting a job is the act of the person
at the robot. The scheduler is `set_part_plan`, `request_schedule_proposal`,
`accept_schedule_proposal`, `dismiss_schedule_proposal`, `slip_experiment_part` and
`set_scheduler_settings`. A code cell is a notebook block, so an agent writes one
with `sheetbase.notebook_block.insert` (type `code_cell`) and reads its runs from
`code_cell_runs`; running one happens in the app, where the person sees it. In the
assistant they are the “Send to robot”, “Plan schedule” and “Accept and book” cards
(`sheetbase.robot.send_worklist`, `sheetbase.schedule.plan`,
`sheetbase.schedule.accept`).

The admin read tool covers the tables that are not on the external allowlist:
workspace settings/counts, members, credential metadata (owner only),
connectors, pipeline runs and schedules, instrument metadata, protocol
versions, analysis-definition metadata, file metadata, comments scoped to a
record, audit events and usage. It is personal-token only and requires an
owner, admin or steward role. Instrument and analysis reads project metadata
only; instrument configuration, analysis definitions and source revisions stay
out of the response.

## Change coverage

| Family             | What an agent can propose                                                                                                                                                                                                                                          | Still human                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Records            | Create a record; update custom fields                                                                                                                                                                                                                              | Archive/restore, transition status, lock                                                                |
| Datasets           | Schema draft, row commit                                                                                                                                                                                                                                           | Publish a schema, archive/restore                                                                       |
| Sheets             | Sheet Definition draft/update; create, update, archive or restore an Instance; materialise an Instance                                                                                                                                                             | Publish, upgrade                                                                                        |
| Pipelines          | Definition draft, version draft, draft update                                                                                                                                                                                                                      | Start, retry, cancel, publish                                                                           |
| Notebooks          | Insert, update, move or delete one block (always human approval)                                                                                                                                                                                                   | Submit, sign, amend                                                                                     |
| Templates          | Instantiate an active protocol template; upgrade a notebook                                                                                                                                                                                                        | Create, instantiate a notebook template version                                                         |
| Models             | Update custom fields; create/update/activate model fields                                                                                                                                                                                                          | Publish model-field changes, retire                                                                     |
| Money              | Mark a reagent order placed; set or clear an order price; set or clear an instrument rate (`facility:write`)                                                                                                                                                       | Spend and usage reports are read-only tools                                                             |
| Administration     | Workspace AI settings only                                                                                                                                                                                                                                         | Members/invites, connectors, schedules, credentials, flags, directory sync tokens (a person makes them) |
| Signing and review | Nothing                                                                                                                                                                                                                                                            | Submit, sign, review decision, publication                                                              |
| Trusted timestamps | Nothing. Choosing the time-stamping service changes where fingerprints are sent, so it stays with a person; asking again for a failed stamp is `request_signature_timestamp` over the API                                                                          | Choosing the service                                                                                    |
| Data contracts     | Make or change a contract, add or remove a rule, delete one, check it now, preview rules, check rows or a record against it, and import or export ODCS (`save_data_contract`, `add_contract_rule`, `run_contract_check` and the rest, through `sheetbase.lab.act`) | Nothing; the person's role (owner, admin or steward) decides, as in the app                             |
| Open data          | Nothing over MCP; the in-app assistant proposes turning open tables on and preparing a repository draft as cards. Agents read status with `sheetbase.open_tables.status` and the four resources above                                                              | Making table logins, and publishing a draft for good (it cannot be undone)                              |
| Validation         | Nothing. Starting a run needs a person signed in to the app, in a regulated lab; the assistant can propose it as a card, and agents read finished runs from `validation_runs`                                                                                      | Starting a run, downloading the pack                                                                    |

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

`sheetbase.reagent_order.mark_ordered`, `.set_price` and `sheetbase.instrument_rate.set`
delegate to `api.mark_reagent_ordered`, `api.set_reagent_order_price` and
`api.set_instrument_rate`. They are always `human_required`. MCP needs
`facility:write` as well as `agent_operations:write`, and the preview shows the
price on file only to someone who may see prices.

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
