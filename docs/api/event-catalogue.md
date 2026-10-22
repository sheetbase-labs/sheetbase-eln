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
| `notebook.signed`                                         | —                             | `signature` + `create`                                                         |
| `notebook.template.created` / `notebook.template.updated` | `notebook_template.*`         | `notebook_template` + `create` / `update`                                      |
| `notebook.template.versioned`                             | `notebook_template.versioned` | `notebook_template_version` + `create`                                         |

"Notebook" is the block document owned by a record (experiment, protocol
template, report) — not a separate table.

### Pipeline (`provisional`, SSE only)

`pipeline.created` / `pipeline.updated` / `pipeline.deleted`
(from `pipeline_definition`),
`pipeline.version.created` / `pipeline.version.updated`
(from `pipeline_definition_version`; publish/retire arrive as `updated`),
`pipeline.run.created` / `pipeline.run.updated`
(from `pipeline_run`; fine-grained outcomes live in the run rows),
`pipeline.schedule.created` / `pipeline.schedule.updated`
(from `pipeline_schedule`).

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

## Webhook delivery notes

- Subscribe via `api.create_webhook_subscription`; filter with `event_types`
  (empty = all). Payloads are HMAC-SHA256 signed
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
`storage_movement`/`calendar_booking` operational detail, and
`webhook_subscription`/`webhook_delivery` self-observation (delivery
machinery must not fan out to itself). The full closed list with reasons is
`INTENTIONALLY_EXCLUDED` in `src/lib/event-catalogue.ts`.
