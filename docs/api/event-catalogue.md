# Event Catalogue

The stable domain events Sheetbase emits — what they are called, what
produces them, what the payload looks like, and which consumers can see
them. Read this instead of inferring meaning from database table changes:
internal `change_events` entity/operation pairs are an implementation
detail and may change; the names here will not.

Pinned in code by `src/lib/event-catalogue.ts` (`EVENT_CATALOGUE`), which
drift tests hold equal to the webhook delivery map. `change_events` stays
the single durable source; events are lightweight notifications, not a
second audit/evidence store.

## Envelope

Every catalogue event shares one envelope:

| Field           | Meaning                                                                    |
| --------------- | -------------------------------------------------------------------------- |
| `event`         | Canonical stable name (e.g. `sheet.updated`).                              |
| `schemaVersion` | Envelope schema version, currently `'1'`.                                  |
| `id`            | Globally unique event id (the `change_events` id). Use as idempotency key. |
| `occurredAt`    | Creation timestamp (ISO 8601).                                             |
| `workspaceId`   | Owning workspace.                                                          |
| `actor`         | `{ userId, credentialId, clientId }` — exactly one of user/credential set. |
| `provenance`    | `{ entityType, operation, entityUuid, sequence, recordId, projectId }`.    |
| `data`          | Lightweight summary — never the source of truth. Re-read the object.       |

Order within a workspace with `provenance.sequence` (gapless, monotonic).
Deduplicate across retries/replays with `id`.

## Versioning

- Event names are added, never renamed (`docs/development/conventions.md`).
- `schemaVersion` is `'1'` with no negotiation in this revision; a future
  version will be additive (new optional fields) with the old form still
  accepted.
- Shipped wire names that leak table names stay on the wire as documented
  aliases (below). New subscribers should use the canonical names;
  subscription filters accept either form. Aliases are retired only with an
  explicit migration, never silently.

## Families

Status `stable` = safe for external consumers today. Status `provisional` =
pinned name + producer, visible over SSE, not webhook-surfaced yet
(EVENT-03 decides surfacing). Status `reserved` = never emitted; the name is
claimed so it cannot be reused.

### Record (`stable`)

| Event                                                                                                           | Produced by                                                                |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `record.created` / `record.updated` / `record.moved` / `record.deleted` / `record.archived` / `record.restored` | `record` + `create` / `update` / `move` / `delete` / `archive` / `restore` |
| `record.amended` (`provisional`)                                                                                | `record` + `amend` (via `api.create_amendment`)                            |

### Dataset / Version (`stable`)

| Event                                                                           | Produced by                                                                                                                      |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `dataset.created` / `dataset.updated` / `dataset.archived` / `dataset.restored` | `dataset` + `create` / `update` / `archive` / `restore`                                                                          |
| `dataset.versioned`                                                             | `dataset_version` + `create`. Carries the parent `datasetId`. Consumed by pipeline event schedules (with `datasetId` filtering). |

### Sheet (`stable`, canonical names with wire aliases)

| Canonical event                                                         | Wire alias (still emitted)   | Produced by                                                    |
| ----------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------- |
| `sheet.created` / `sheet.updated` / `sheet.archived` / `sheet.restored` | `sheet_instance.*`           | `sheet_instance` + `create` / `update` / `archive` / `restore` |
| `sheet.definition.created` / `sheet.definition.updated`                 | `sheet_definition.*`         | `sheet_definition` + `create` / `update`                       |
| `sheet.definition.versioned`                                            | `sheet_definition.versioned` | `sheet_definition_version` + `create`                          |

A Sheet Definition is the reusable versioned configuration; a Sheet is the
instantiated working object. Instances stay bound to the definition version
they were created from.

### Notebook / Review (`stable`, one reserved, template aliases)

| Canonical event                                           | Wire alias                    | Produced by                                                                    |
| --------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------ |
| `notebook.submitted`                                      | —                             | `review_submission` + `create`                                                 |
| `notebook.amended` (`reserved`, never emitted)            | `notebook.amended`            | none — the submission trigger is INSERT-only; amendments emit `record.amended` |
| `review.decided`                                          | —                             | `review_decision` + `create` (request-changes / reject / approve / withdraw)   |
| `record.signed`                                           | `notebook.signed`             | `signature` + `create`                                                         |
| `notebook.template.created` / `notebook.template.updated` | `notebook_template.*`         | `notebook_template` + `create` / `update`                                      |
| `notebook.template.versioned`                             | `notebook_template.versioned` | `notebook_template_version` + `create`                                         |

"Notebook" is the block document owned by a record (experiment, protocol
template, report) — not a separate table.

`record.signed` is the canonical name for a signature on a record. The wire
still says `notebook.signed`, so existing receivers keep working, and a
subscription may list either name (they match each other).

### Samples, bookings, imports, approvals, storage and instruments (`stable`, webhook and SSE)

Several events share one `change_events` pair, so the payload picks between
them (`when` in the catalogue).

| Event                                                                                                                                          | Produced by                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sample.received` / `sample.moved` / `sample.consumed` / `sample.released` / `sample.quarantined` / `sample.disposed` / `sample.hold_exceeded` | `sample_event` + `create`, by the event's `operation` (receive, transfer, consume, release, ...)                                                                                       |
| `booking.created`                                                                                                                              | `calendar_booking` + `create`                                                                                                                                                          |
| `booking.updated` / `booking.cancelled`                                                                                                        | `calendar_booking` + `update`, by `status` (`cancelled` or not)                                                                                                                        |
| `import.created`                                                                                                                               | `dataset_import` + `create`                                                                                                                                                            |
| `import.committed` / `import.failed`                                                                                                           | `dataset_import` + `update`, by `status`                                                                                                                                               |
| `approval.requested`                                                                                                                           | `approval_request` + `create`                                                                                                                                                          |
| `approval.approved` / `approval.returned` / `approval.withdrawn`                                                                               | `approval_request` + `update`, by the new `state`                                                                                                                                      |
| `storage.placed` / `storage.moved` / `storage.removed`                                                                                         | `storage_movement` + `create`, by the movement's `operation` (`place`, `move`, `remove`)                                                                                               |
| `storage.alarm.raised` / `storage.alarm.cleared`                                                                                               | `storage_alarm` + `create` / `resolve`; the payload names the `feed`, its `state` (`low`, `high` or `ok`), `value`, `lowLimit`, `highLimit` and the `storageUnitId` or `storageRoomId` |
| `instrument.run.created`                                                                                                                       | `instrument_run` + `create`                                                                                                                                                            |
| `instrument.run.completed` / `instrument.run.failed`                                                                                           | `instrument_run` + `update`, by `status`                                                                                                                                               |

### Lab features: stock, shipping, requests, holds, workflows (`stable`, webhook and SSE)

Added with migration 0099. Every event below is delivered to webhooks and the
live feed, carries the standard envelope, and has the payload keys listed
(`data` in the envelope). The event is picked by the payload key shown, as with
the sample events above. Subscribe with these names; `api.create_webhook_subscription`
accepts them.

| Event                                                                                      | Produced by                                                                                                          | Payload highlights                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reagent.order.requested` / `.placed` / `.received` / `.cancelled`                         | `material` + `update`, by `action` (`reorder-requested`, `reorder-ordered`, `reorder-received`, `reorder-cancelled`) | `orderId`; `quantity`, `unit` (requested); `reference` (placed); `lot`, `newRecordId` (received). `recordId` is the material record.                                                                                                                                   |
| `stocktake.completed`                                                                      | `stocktake` + `update`, when `status` is `completed`                                                                 | `stocktakeId`, `number`, `scopeLevel`, `scopeName`, `scopePath`, `counts` (items by state), `completedByUserId`                                                                                                                                                        |
| `shipment.sent` / `shipment.in_transit` / `shipment.received` / `shipment.cancelled`       | `shipment` + `update`, by `event`                                                                                    | `shipmentId`, `reference` (`SHP-0001`), `direction`, `counterparty`, `status`, `carrier`, `trackingReference`, `expectedOn`, `items`. An outbound shipment going into transit is `shipment.sent`; an inbound one is `shipment.in_transit`.                             |
| `request.submitted`                                                                        | `request` + `create`                                                                                                 | `recordId`, `identifier`, `title`, `model`, `status`, `requestedByUserId`                                                                                                                                                                                              |
| `request.decided`                                                                          | `request` + `update`                                                                                                 | as above plus `decision` (`accepted`, `declined` or `completed`) and `decidedByUserId`                                                                                                                                                                                 |
| `legal_hold.created` / `legal_hold.released`                                               | `workspace_settings` + `create` / `update`, by `effect` (`legal_hold`, `legal_hold_released`)                        | `holdId`, `name`; `projectId` is the held project, if any                                                                                                                                                                                                              |
| `retention.applied`                                                                        | `workspace_settings` + `update`, when `effect` is `retention_applied`                                                | `kind` (null for every kind), `archived` (how many). Sent once per run, and only when something was archived. Each archived record also emits `record.archived`.                                                                                                       |
| `sample.workflow.enrolled` / `.advanced` / `.left`                                         | `sample_workflow_run` + `update`, by `change`                                                                        | `runId`, `recordId`, `workflowId`, `workflow`, `fromStage`, `toStage`, `completed`                                                                                                                                                                                     |
| `incident.reported`                                                                        | `incident` + `create`                                                                                                | `recordId`, `identifier`, `title`, `model`, `status`. Any record of a model with the Incident log box ticked; it also emits `record.created`.                                                                                                                          |
| `registry.entry.created`                                                                   | `registry_entry` + `create`                                                                                          | `recordId`, `identifier`, `title`, `registry` (the model key). Any record of a registry model; it also emits `record.created`.                                                                                                                                         |
| `instrument.reading.out_of_limits` / `instrument.reading.back_in_range`                    | `instrument_feed` + `update`, by `limitState` (not `ok` / `ok`)                                                      | `feedId`, `feed`, `instrumentId`, `instrument`, `limitState` (`low`, `high` or `ok`), `previousState`, `value`, `unit`, `lowLimit`, `highLimit`, `readingAt`. Sent when a feed crosses a limit, not on every reading.                                                  |
| `record.assigned`                                                                          | `record_assignment` + `update`                                                                                       | `recordId`, `identifier`, `title`, `assigneeUserId` (null when unassigned), `previousAssigneeUserId`                                                                                                                                                                   |
| `step.completed` / `step.reopened`                                                         | `step_completion` + `create` / `delete`                                                                              | `blockId`, `recordId`, `identifier`, `title`, `stepNumber`, `step`, `completedByUserId`                                                                                                                                                                                |
| `experiment.part_created`                                                                  | `experiment_part` + `create`                                                                                         | `partId`, `partNumber`, `part`, `recordId`, `identifier`, `title`, `dayOffset`, `assigneeUserId`                                                                                                                                                                       |
| `experiment.part_opened`                                                                   | `part_opened` + `create`                                                                                             | As `experiment.part_created`. Sent when a part becomes the current one: the experiment starts, or the part before it is done.                                                                                                                                          |
| `experiment.part_completed` / `experiment.part_reopened`                                   | `part_completion` + `create` / `delete`                                                                              | As `experiment.part_created`, plus `completedByUserId`. A part is done when its steps are, or when it is marked done.                                                                                                                                                  |
| `step.result_added`                                                                        | `step_result` + `create`                                                                                             | `blockId` (the step), `resultBlockId`, `label`, `recordId`, `identifier`, `title`, `stepNumber`, `step`                                                                                                                                                                |
| `experiment.series_member_added` / `experiment.series_member_removed`                      | `experiment_series_member` + `create` / `delete`                                                                     | `seriesRecordId`, `seriesIdentifier`, `seriesTitle`, `memberRecordId`, `memberIdentifier`, `memberTitle`, `position`. The event belongs to the series record.                                                                                                          |
| `plate_run.created` / `plate_run.analysed` / `plate_run.archived`                          | `plate_run` + `create` / `update`, by `change` (`analysed`, `archived`)                                              | `plateRunId`, `reference`, `name`; `format` on create; `qcStatus`, `zPrime`, `hitSamples`, `testedSamples` on analysed.                                                                                                                                                |
| `plate_worklist.created` / `plate_worklist.completed`                                      | `plate_worklist` + `create` / `update`, by `change` (`completed`)                                                    | `worklistId`, `reference`, `name`, `transfers`; `format` on create; `samplesWithdrawn` on completed.                                                                                                                                                                   |
| `instrument.run.converted`                                                                 | `instrument_run_document` + `create`                                                                                 | `runId`, `instrumentId`, `format`, `technique`, `vendor`, `converter`, `converterVersion`, `measurements`.                                                                                                                                                             |
| `qc.violation`                                                                             | `qc_violation` + `create`                                                                                            | `seriesId`, `name`, `pointId`, `value`, `z`, `rules`, `instrumentId`, `designId`, `plateRunId`, `at`.                                                                                                                                                                  |
| `qc.back_in_control`                                                                       | `qc_series` + `update`, by `change` (`back_in_control`)                                                              | `seriesId`, `name`, `pointId`, `value`, `z`, `instrumentId`, `designId`, `at`.                                                                                                                                                                                         |
| `instrument.job.queued` / `.staged` / `.started` / `.completed` / `.failed` / `.cancelled` | `instrument_job` + `create` / `update`, by `change`                                                                  | `jobId`, `reference` (`IJ-0007`), `instrumentId`, `instrument`, `worklistId`, `recordId`, `status`, `driver`; `error` on failed; `result` (`transfers`, `byStatus`, `withdrawals`) on completed. `staged` is the run waiting on the robot for a person to press Start. |
| `schedule.proposed` / `schedule.accepted` / `schedule.dismissed`                           | `schedule_proposal` + `create` / `update`, by `change`                                                               | `proposalId`, `reference` (`SP-0003`), `recordId`, `reason` (`plan` or `slip`), `status`, `items` (how many slots), `conflicts` (how many have something in the way).                                                                                                  |
| `code_cell.run` / `code_cell.reproduced`                                                   | `code_cell_run` + `create` / `update`, by `change`                                                                   | `runId`, `reference` (`CC-0004`), `recordId`, `blockId`, `language`, `status`, `runtime`; `matches` and `reproducesRunId` on reproduced.                                                                                                                               |
| `experiment.gate_opened`                                                                   | `gate_opening` + `create`                                                                                            | `gateId` (`block:<id>` or `part:<id>`), `gate`, `mode` (`warn` or `block`), `blockId`, `partId`, `partNumber`, `part`, `recordId`, `identifier`, `title`. Sent once when a gate becomes met, and again if it closes and opens later.                                   |
| `experiment.gate_overridden`                                                               | `gate_override` + `create`                                                                                           | As `experiment.gate_opened`, plus `reason`, `missing` (what was still to do, in words) and `userId`. Sent when someone goes on past a gate that warns.                                                                                                                 |

`request.submitted`, `request.decided`, `incident.reported`, `registry.entry.created`, `record.assigned`,
`step.completed`, `step.reopened`, `step.result_added`, `experiment.series_member_added`,
`experiment.series_member_removed`, `experiment.part_created`, `experiment.part_opened`,
`experiment.part_completed`, `experiment.part_reopened`, `experiment.gate_opened` and `experiment.gate_overridden`
are also pipeline trigger events (they sit in the `record` family, like `record.created`).

Booking rules, calendar feeds, step timers, solution preparation and display
settings are personal or configuration changes and are not events.

### Orders, prices, rates and scheduled reports (`stable`, webhook and SSE)

| Event                                               | Produced by                                         |
| --------------------------------------------------- | --------------------------------------------------- |
| `order.priced` / `order.price_removed`              | `reagent_order_price` + `update` / `delete`         |
| `instrument.rate_set` / `instrument.rate_removed`   | `instrument_rate` + `update` / `delete`             |
| `report.schedule.created` / `.updated` / `.deleted` | `scheduled_report` + `create` / `update` / `delete` |

Price and rate events carry the order or instrument id and the currency, never
the amount: the amount is read with the calls in
[`spend-and-usage-api.md`](spend-and-usage-api.md), which needs the right to
see it. A schedule's own bookkeeping (next run, last result) does not emit.

### Trusted timestamps (`stable`, webhook and SSE)

| Event                            | Produced by                                                           | Payload highlights                                                             |
| -------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `signature.timestamped`          | `signature_timestamp` + `create`                                      | `signatureId`, `revisionId`, `authority`, `genTime`. `recordId` is the record. |
| `signature.timestamp_failed`     | `signature_timestamp` + `update`, when `action` is `timestamp-failed` | `signatureId`, `revisionId`, `error`. Sent once, after the sixth failed try.   |
| `workspace.timestamping.updated` | `signature_timestamp` + `update`, when `action` is `timestamping-set` | `enabled`, `authority` (`dfn`, `digicert`, `custom` or null)                   |

The token itself is on the `signature_timestamps` resource; see
[`trusted-timestamps-api.md`](trusted-timestamps-api.md).

### Validation (`stable`, webhook and SSE)

| Event                      | Produced by                 | Payload highlights                                             |
| -------------------------- | --------------------------- | -------------------------------------------------------------- |
| `validation.run_completed` | `validation_run` + `create` | `runId`, `status`, `passed`, `failed`, `skipped`, `appVersion` |

The full results are on the `validation_runs` resource; see
[`validation-api.md`](validation-api.md).

### Data contracts (`stable`, webhook, SSE and pipeline triggers)

| Event                      | Produced by                          | Payload highlights                                                                               |
| -------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `contract.created`         | `data_contract` + `create`           | `contractId`, `name`, `version`, `lifecycle`                                                     |
| `contract.updated`         | `data_contract` + `update`           | `contractId`, `name`, `version`, `lifecycle`                                                     |
| `contract.deleted`         | `data_contract` + `delete`           | `contractId`, `name`                                                                             |
| `contract.check.completed` | `data_contract_run` + `create`       | `runId`, `contractId`, `status`, `trigger`, `datasetId`, `rowsChecked`, `failedRules`, `blocked` |
| `contract.breached`        | `data_contract_standing` + `update`  | `contractId`, `status`, `previousStatus`, `datasetId`, `runId`                                   |
| `contract.restored`        | `data_contract_standing` + `restore` | `contractId`, `status`, `previousStatus`, `datasetId`, `runId`                                   |

`contract.breached` fires once when a contract's standing gets worse and
`contract.restored` once when it passes again, not on every failing check. The
findings of each check are on the `data_contract_runs` resource; see
[`data-contracts-api.md`](data-contracts-api.md).

### Pipeline (`provisional`, SSE only)

`pipeline.created` / `pipeline.updated` / `pipeline.deleted`
(from `pipeline_definition`),
`pipeline.version.created` / `pipeline.version.updated`
(from `pipeline_definition_version`; publish/retire arrive as `updated`),
`pipeline.run.created` / `pipeline.run.updated`
(from `pipeline_run`; fine-grained outcomes live in the run rows),
`pipeline.schedule.created` / `pipeline.schedule.updated`
(from `pipeline_schedule`),
`pipeline.run.reproduced` (from `pipeline_reproduction`; stable, delivered to webhooks),
`lineage.endpoint.created` / `lineage.endpoint.updated` / `lineage.delivery_failed`
(from `lineage_target`; the last two are stable and delivered to webhooks).

Pipeline lifecycle events are intentionally not pipeline triggers (triggers
must not fan out to themselves). The triggerable set is the stable
record/dataset/sheet/review events above — pinned in code by
`PIPELINE_TRIGGER_EVENTS` (`src/lib/pipeline-schedule.ts`).

See [`pipelines.md`](../subsystems/pipelines.md) for the trigger model
(manual / schedule / event) and at-least-once cursor semantics.

### Administration (`stable` for projects, `provisional` for the rest, SSE only for provisional)

`project.created` / `project.updated` / `project.deleted` / `project.archived` /
`project.restored` (`stable`, webhook-surfaced),
`workspace.invitation.created` / `.updated` / `.deleted`,
`workspace.settings.created` / `.updated`,
`project.access.granted` / `.updated` / `.revoked`,
`workspace.credential.created` / `workspace.credential.revoked`
(rotation emits the pair so it is reconstructable; payloads carry display
metadata only, never secrets).

### Agent permissions, checks and watchers (`provisional`, SSE; `watcher.finding.created` also webhook and pipeline trigger)

`agent.policy.changed` (an admin changed what agents may do with an action),
`agent.action.requested` (an agent asked to take an action),
`agent.action.decided` (`event=decided`: a person approved or rejected it),
`agent.action.completed` (`event=completed`: it ran and succeeded or failed),
`ai.eval.completed` (a Checks run finished, with how many passed) and
`watcher.finding.created` (a watcher found something; payload carries the
finding kind, title and record, and starts a pipeline set to that event).

### People and sign-in (`stable`, webhook and SSE)

`member.work_handed_over` (counts of what moved and what stayed, by kind of
work), `member.absence_set` (dates and the delegate), `member.absence_cancelled`,
`workspace.group_role.mapped` / `.removed` / `.adopted` (sign-in group to role
mappings), `member.role_changed_by_groups` (a role changed at sign-in from the
person's groups), and `member.passkey_added` / `member.passkey_removed` (every
workspace the person belongs to hears about it; the payload carries the
passkey's name and id, never key material).

### Directory sync (`stable`, webhook and SSE)

When an identity provider keeps people and groups in step through SCIM
(see [`scim.md`](scim.md)): `member.provisioned`, `member.directory_updated`,
`member.reactivated` and `member.deprovisioned` (the person is suspended; the
payload's `openWork` counts what is still in their name so a lead can hand it
over), `workspace.scim_group.created` / `.updated` / `.deleted`, and
`workspace.scim_token.created` / `.revoked` (the token's name only, never the
secret). A role that changes because of the provider's groups is announced as
`member.role_changed_by_groups`.

## Webhook delivery notes

- Subscribe via `api.create_webhook_subscription`; filter with `event_types`
  (empty = all). A name nobody emits is refused (`unknown event type`); the
  accepted names are the catalogue's canonical and wire names, held in
  `internal.webhook_event_names` and pinned to the catalogue by a test. Payloads are HMAC-SHA256 signed
  (`X-Sheetbase-Signature: sha256=<hex>`); verify with a timing-safe
  compare and deduplicate on the event id — retries reuse the same id and
  must not duplicate downstream effects.
- Every delivery also carries `X-Sheetbase-Event-Id` (the same event id in
  a header) so receivers can deduplicate without parsing the body. Replays
  reuse the original body/signature, hence the same idempotency key.
- Deliveries run through the engine in `src/lib/webhook-delivery.ts` with
  exponential backoff, per-endpoint rate budgets (`rate_limit_per_minute`;
  over-budget attempts defer, never drop), and auto-disablement on
  consecutive failures.
- Recovery reconciles **all retained events since each subscription's
  creation**, including events older than 24 hours. It pages beyond 500
  events and checks missing deliveries separately for each subscription.
  Startup and reconnect establish `LISTEN` before reconciliation. The
  periodic sweep repairs missed notifications even without a reconnect.
- Recovery uses the subscription's current active state and event filters.
  Reactivation can therefore deliver matching retained events from a paused
  interval. Events before subscription creation are not backfilled. Deleted
  events cannot be recovered. Missing delivery records use reconciliation;
  terminal delivery records use the explicit replay operations below.
- Workers hold a database transaction lock on one delivery and its
  subscription through the HTTP attempt and result commit. Rollback or
  connection loss releases ownership for another worker. A receiver may
  accept a request before the database result commits, so delivery is
  **at-least-once, not exactly-once**. Receivers must store the event ID and
  apply their effect atomically. Independent receiver destinations should
  deduplicate independently. Delivery order across workers is not guaranteed.
- Exhausted backoff lands in the explicit `dead_letter` state — the DLQ
  surface, listing reason (`error_code`/`error_message`) with the payload
  referenced by delivery id. The retry sweep never picks dead letters up;
  recovery is an explicit operator replay.
- Recover with `api.replay_webhook_delivery` (single terminal delivery) or
  `api.replay_webhook_deliveries` (subscription and/or time-window replay
  of `dead_letter`/`failed`/`delivered` originals; re-running a window is
  safe). Replays are audited via `replay_of_delivery_id` lineage plus a
  `webhook_delivery` change event.
- Diagnose with `api.list_webhook_deliveries` (status/event-type/time
  filters) and `api.get_webhook_endpoint_health` (24h success rate, last
  error, consecutive failures, disable state, retry debt). Re-enable a
  disabled endpoint via `api.update_webhook_subscription` with
  `status: 'active'` (resets `consecutive_failures`).
- `api_client` credentials manage subscriptions and replay under
  `webhooks:read` / `webhooks:write` (see [`external-api.md`](external-api.md));
  `change_events` itself is never externally readable.

## Intentionally excluded

Present in `change_events` but not stable events: `dataset`/`sheet_instance`/
`sheet_definition`/`notebook_template` deletes, `*_version` lifecycle-update
rows, `folder`/`block`/`record_link` live-sync churn,
booking deletes, and
`webhook_subscription`/`webhook_delivery` self-observation (delivery
machinery must not fan out to itself). The full closed list with reasons is
`INTENTIONALLY_EXCLUDED` in `src/lib/event-catalogue.ts`.
