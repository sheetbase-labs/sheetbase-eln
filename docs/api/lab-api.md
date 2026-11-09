# Lab API

Everything the lab runs on day to day is reachable the same way as the core
API: with a token, from the assistant, over MCP and through webhooks. This page
covers the token and MCP side. Webhook events are in
[event-catalogue.md](event-catalogue.md), and the full request and response
shapes are in [openapi/external-api-v0.json](openapi/external-api-v0.json) under
the **Lab** tag.

## Scopes and tokens

| Scope       | Lets you                                         |
| ----------- | ------------------------------------------------ |
| `lab:read`  | Read the tables below, and call the lookup RPCs. |
| `lab:write` | Call the action RPCs below.                      |

- **Reads** work with a service credential (it sees the whole workspace) or a
  personal token (it sees what that person sees). Step timers, follows, the
  person's work and Inbox and result-limit verdicts are about one person, so
  only a personal token can read them.
- **Actions** run as the person a **personal token** belongs to, with their
  role and the same checks as the app. A service credential has no person, so
  the database refuses it.
- Tables are read through `GET /api/db/<table>` with the usual PostgREST
  filters. Actions are `POST /api/db/rpc/<name>` with the `p_` arguments.
  Dates are `YYYY-MM-DD`.
- Deciding a request, releasing a legal hold, applying retention and editing
  models stay with people in the app, so they are not here.

```bash
# Reagent orders still waiting to be placed
curl -H "Authorization: Bearer $TOKEN" \
  "https://app.example/api/db/reagent_orders?status=eq.requested&select=number,material_title,quantity"

# Ask for more of a material
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  https://app.example/api/db/rpc/request_reagent_order \
  -d '{"p_material_record_id":"<material id>","p_quantity":2,"p_unit":"bottle"}'
```

## MCP

- Every table below is readable with `sheetbase.canonical.read` (pass the table
  name as `resource`) when the credential holds `lab:read`.
- Every action below is one call to `sheetbase.lab.act` with `action` and
  `arguments`. It needs a personal token, `lab:write` (or `lab:read` for
  lookups) and the workspace setting **Agents can act in the lab**, which an owner
  switches on in Settings > AI. It is off by default.
- What happens to a change depends on the permission set for that action in
  Settings > AI > Agent permissions: **Auto** runs it straight away, **Ask**
  returns `waiting_for_approval` with a request id and puts the request in a
  person's Inbox, **Never** refuses it. With nothing set the answer is Ask.
  Signing, submitting for review, amending, locking and deleting are always
  Never. Lookups are never held back.

## Tables

| Table                               | What it holds                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reagent_orders`                    | A reagent order: requested from a material that is running low, placed with the supplier, then received as a new lot. `status` is requested, ordered, received or cancelled.                                                                                                                                                                    |
| `recurring_schedules`               | A recurring experiment or booking. `kind` is `booking` or `experiment`; `status` is active, paused or ended.                                                                                                                                                                                                                                    |
| `recurring_occurrences`             | One planned run of a recurring schedule and what became of it (`outcome`).                                                                                                                                                                                                                                                                      |
| `instrument_service_log`            | A service, repair, calibration or other visit logged against an instrument.                                                                                                                                                                                                                                                                     |
| `experiment_series`                 | An experiment that heads a series: it groups other experiments that run as separate pieces of one piece of work.                                                                                                                                                                                                                                |
| `experiment_series_members`         | An experiment in a series, with where it sits (`position`) and the day it is planned (`planned_on`). An experiment is in one series at most.                                                                                                                                                                                                    |
| `experiment_parts`                  | A part of an experiment that runs over several days: its own page of the notebook, on a day counted from the start of the experiment. Parts run in `position` order. A part is done when all its steps are, or when it was marked done by hand.                                                                                                 |
| `gate_check_results`                | What a plugin check answered for a table on an experiment: `pass`, `warn` or `fail` with its message, and a fingerprint of the table when it ran. A gate reads this; when the table has changed since, the answer is out of date and the gate is not met. Written only by the app when someone runs the check.                                  |
| `registry_sameness_rules`           | Which plugin rule decides when two entries of a registry model are the same thing. `plugin_item` is `plugin.<plugin>.<rule>`.                                                                                                                                                                                                                   |
| `registry_sameness_values`          | The key a plugin rule worked out for a registry entry. Entries of one model with the same `value` are the same thing.                                                                                                                                                                                                                           |
| `plugin_notes`                      | Notes a plugin left in someone’s Inbox in answer to an event. Each person sees their own; they stay for 14 days.                                                                                                                                                                                                                                |
| `plugin_flags`                      | Holds and sign-off steps a plugin raised on a record after a save or an event. A `flag` is a hold the plugin raises and clears; a `sign_off` is a step a person with one of its `roles` presses (`approvals_needed` of them, and not the person who made the change if `independent`). `state` is `open` or `cleared`. A gate can wait on them. |
| `plugin_flag_sign_offs`             | Who pressed a plugin sign-off step, in which role, when, and what they said.                                                                                                                                                                                                                                                                    |
| `plugin_record_outputs`             | The one-line summary a plugin hook wrote on a record. One per hook; a new one replaces the last.                                                                                                                                                                                                                                                |
| `experiment_part_signoffs`          | A signature on a part of an experiment. `meaning` is `signed` (the person who did the part) or `witnessed` (a countersign of that signature, named in `countersigns_id`). `snapshot` is the part as it was frozen when signed, and `snapshot_digest` its SHA-256. Rows are never changed or removed.                                            |
| `experiment_part_requests`          | A request to sign a finished part (`kind` is `sign`) or to countersign a signed one (`countersign`). `fulfilled_at` is set when it was done or no longer applies.                                                                                                                                                                               |
| `experiment_part_amendments`        | A signed part was reopened to amend it. `signoff_id` is the signature set aside, which stays on record. Rows are never changed or removed.                                                                                                                                                                                                      |
| `step_timers`                       | A timer started on a protocol step. Personal tokens only: you see your own timers.                                                                                                                                                                                                                                                              |
| `material_safety`                   | Chemical safety information for a material: hazard pictograms, signal word, hazard statements and the safety data sheet file.                                                                                                                                                                                                                   |
| `material_ingredients`              | What went into a prepared solution: one row per ingredient lot, with quantity and unit.                                                                                                                                                                                                                                                         |
| `stocktakes`                        | A stocktake of a freezer, shelf or box. `status` is in_progress, completed or cancelled.                                                                                                                                                                                                                                                        |
| `stocktake_items`                   | One item expected in or found during a stocktake, with where it should be, where it was found and how a mismatch was resolved.                                                                                                                                                                                                                  |
| `instrument_feeds`                  | A live measurement series on an instrument (temperature, pressure and so on), with its alert limits and last value.                                                                                                                                                                                                                             |
| `instrument_readings`               | One reading in an instrument feed. Large; filter by `feed_id` and `taken_at`, or use `list_instrument_feed_series` for charts.                                                                                                                                                                                                                  |
| `sample_workflows`                  | A sample workflow: the stages a sample moves through. `status` is draft, active or archived.                                                                                                                                                                                                                                                    |
| `sample_workflow_stages`            | A stage in a sample workflow, with its turnaround time, required fields and actions.                                                                                                                                                                                                                                                            |
| `sample_workflow_transitions`       | Which stage a sample may move to from another stage.                                                                                                                                                                                                                                                                                            |
| `sample_workflow_runs`              | A sample's journey through a workflow: its current stage, when it entered and when it is due.                                                                                                                                                                                                                                                   |
| `sample_workflow_events`            | The history of moves a sample made through a workflow.                                                                                                                                                                                                                                                                                          |
| `request_forms`                     | Which record models accept requests, their intro text and who handles them.                                                                                                                                                                                                                                                                     |
| `shipments`                         | A sample shipment in or out. `direction` is inbound or outbound; `status` is draft, in_transit, received or cancelled.                                                                                                                                                                                                                          |
| `shipment_items`                    | An item on a shipment, with whether it arrived and in what condition.                                                                                                                                                                                                                                                                           |
| `instrument_booking_rules`          | Booking limits on an instrument: longest booking and how far ahead people may book.                                                                                                                                                                                                                                                             |
| `instrument_required_training`      | Training protocols a person must hold before booking an instrument.                                                                                                                                                                                                                                                                             |
| `field_spec_limits`                 | Specification and alert limits for a numeric field on a record kind.                                                                                                                                                                                                                                                                            |
| `model_incident_logs`               | Record models that are used as incident logs.                                                                                                                                                                                                                                                                                                   |
| `legal_holds`                       | A legal hold keeping records from deletion or archiving until it is released.                                                                                                                                                                                                                                                                   |
| `legal_hold_records`                | A record placed on a legal hold.                                                                                                                                                                                                                                                                                                                |
| `retention_rules`                   | How many months each kind of record is kept before it comes up for archiving.                                                                                                                                                                                                                                                                   |
| `request_details`                   | What was asked and how it was decided, for each request record.                                                                                                                                                                                                                                                                                 |
| `record_spec_results`               | Each record's value for a field with result limits, and whether it is within spec, in the alert band or out. Personal tokens only.                                                                                                                                                                                                              |
| `my_work_items`                     | What is waiting on the person: reviews, tasks, assigned records and so on. Personal tokens only.                                                                                                                                                                                                                                                |
| `inbox_work_items`                  | The person's Inbox items with tab and type. Personal tokens only.                                                                                                                                                                                                                                                                               |
| `project_follows`                   | Projects a person follows. Personal tokens only: you see your own follows.                                                                                                                                                                                                                                                                      |
| `plate_runs`                        | Plate runs: one plate read on an instrument, with its layout, readout, analysis settings and the last analysis (normalised values, Z-prime, hits and curves).                                                                                                                                                                                   |
| `plate_worklists`                   | Liquid handler worklists: the transfers from a source plate to a destination plate, and what the robot log said was moved.                                                                                                                                                                                                                      |
| `data_contracts`                    | A data contract: rules for what good data looks like on a dataset schema or a record model. `last_status` is `pass`, `warning` or `fail`; `rules` is the list of rules.                                                                                                                                                                         |
| `data_contract_runs`                | One check of a data contract. `status` is `pass`, `warning` or `fail`; `trigger` is `import`, `pipeline`, `manual` or `schedule`; `blocked` means an import or pipeline commit was refused. `results` says what each rule found.                                                                                                                |
| `data_contract_dataset_status`      | Where each dataset stands under its schema's contract: the latest full check.                                                                                                                                                                                                                                                                   |
| `instrument_run_documents`          | Instrument files converted to the Allotrope Simple Model (ASM): one vendor-neutral document per instrument run, with the converter, its version and the image that ran it.                                                                                                                                                                      |
| `qc_series`                         | Quality control series: a value tracked across runs (a plate assay metric, or any value sent in), with its limits, the Westgard rules and whether it is in control.                                                                                                                                                                             |
| `qc_points`                         | Quality control points: each value of a series with its distance from the mean in SD, the Westgard rules it broke and whether someone has acknowledged it.                                                                                                                                                                                      |
| `agent_action_requests`             | An action an agent asked to take: what it was, what the workspace had set for it (`level`), and how it ended (`status`). A token sees only its own requests.                                                                                                                                                                                    |
| `lab_watchers`                      | A scheduled review the lab turned on: stock expiring, stock low, work overdue, data missing or results off.                                                                                                                                                                                                                                     |
| `lab_watcher_findings`              | Something a watcher found, with the record it is about and a suggested action. `status` is open, snoozed, dismissed or resolved.                                                                                                                                                                                                                |
| `pipeline_reproductions`            | Pipeline runs run again from their pinned version, parameters and inputs and compared with the original: matches, differs or failed, and the first differences. Start one with `POST /api/pipelines/reproduce`.                                                                                                                                 |
| `lineage_targets`                   | Where lineage events (OpenLineage) are sent: address, namespace, header name and whether it is on. The header value is never shown. People who manage integrations only.                                                                                                                                                                        |
| `lineage_deliveries`                | Each lineage event waiting to go to, or sent to, an endpoint, with its attempts and last error. People who manage integrations only.                                                                                                                                                                                                            |
| `instrument_robot_settings`         | An instrument that is a robot: how it is reached (`driver` is opentrons or file), the worklist file format it reads and the labware that file names.                                                                                                                                                                                            |
| `instrument_jobs`                   | A worklist sent to a robot. `status` goes queued, staged (on the robot, waiting for a person to press Start), starting, running, then complete, failed or cancelled. `log` is what happened, and `result` the transfers the robot reported; completing a job completes the worklist and records the stock it used.                              |
| `scheduler_settings`                | The lab’s working day for the scheduler: time zone, the minutes after midnight it starts and ends, and the ISO weekdays that are worked.                                                                                                                                                                                                        |
| `part_plans`                        | How long a part of an experiment takes: the hands-on minutes and the wait after it before the next part can start.                                                                                                                                                                                                                              |
| `part_resource_needs`               | An instrument a part needs and for how many minutes. `resource_id` is the instrument id.                                                                                                                                                                                                                                                        |
| `schedule_proposals`                | A proposed schedule for an experiment’s parts. `status` is requested, planning, proposed, accepted, dismissed, superseded or failed. `items` lists each slot with its instrument, person, times and what stands in its way. Nothing is booked until `accept_schedule_proposal`.                                                                 |
| `code_cell_runs`                    | Every run of a notebook code cell, kept with its code, the digests of the dataset versions it read, the first rows of the output and its digest, and the runtime it ran in (an image digest for Python). A run that reproduces another has `reproduces_run_id` and says whether the output `matches`.                                           |
| `field_plugin_types`                | Which model fields have a plugin’s field type: the model (`kind`), the field, the plugin and the type id. The type adds a display and checks to the field; what the database stores does not change.                                                                                                                                            |
| `gate_overrides`                    | Someone went on past a gate that warns, with a reason: who, when, what the gate was and what was still missing. The reviewer sees these.                                                                                                                                                                                                        |
| `instruments`                       | An instrument: its name, type, model, serial number, where it is, who owns it, whether it is retired or out of service, and how its data arrives (`intake_method`).                                                                                                                                                                             |
| `calendar_resources`                | Something that can be booked on the calendar, such as an instrument or a room.                                                                                                                                                                                                                                                                  |
| `calendar_bookings`                 | A booking of an instrument or other resource. `status` is `tentative`, `confirmed` or `cancelled`; times are UTC instants with the booking’s own time zone beside them.                                                                                                                                                                         |
| `calendar_booking_participants`     | A person on a booking.                                                                                                                                                                                                                                                                                                                          |
| `calendar_booking_samples`          | A sample a booking is for, with the amount.                                                                                                                                                                                                                                                                                                     |
| `instrument_runs`                   | A run on an instrument. `status` goes `queued`, `running`, then `completed`, `failed` or `cancelled`.                                                                                                                                                                                                                                           |
| `instrument_run_stages`             | A stage of an instrument run (for example a PCR step), with its progress.                                                                                                                                                                                                                                                                       |
| `instrument_run_links`              | The experiments and records a run is linked to.                                                                                                                                                                                                                                                                                                 |
| `instrument_observations`           | A reading an instrument sent during a run, as the instrument reported it.                                                                                                                                                                                                                                                                       |
| `instrument_calibrations`           | A calibration of an instrument: when it was done, when the next is due and any notes.                                                                                                                                                                                                                                                           |
| `instrument_qualifications`         | A person qualified to use an instrument, and until when.                                                                                                                                                                                                                                                                                        |
| `instrument_qualification_requests` | A person’s request to be qualified on an instrument, and whether it is still open.                                                                                                                                                                                                                                                              |
| `instrument_qc_checks`              | A check the run’s data was put through, and what it found.                                                                                                                                                                                                                                                                                      |
| `instrument_plate_snapshots`        | The wells of a plate at one moment of a run.                                                                                                                                                                                                                                                                                                    |
| `dataset_imports`                   | An import of instrument or file data into a dataset: which dataset version it made, which parser read it and what was imported.                                                                                                                                                                                                                 |
| `parsers`                           | A way of reading an instrument’s files into rows.                                                                                                                                                                                                                                                                                               |
| `parser_versions`                   | A version of a parser. `status` is `draft`, `approved` or `retired`; regulated datasets only take approved versions.                                                                                                                                                                                                                            |
| `parser_mappings`                   | How a parser’s columns map onto a dataset or model’s fields.                                                                                                                                                                                                                                                                                    |
| `connectors`                        | A connector that brings data in from, or sends it to, another system. Its `config` holds only non-secret settings.                                                                                                                                                                                                                              |
| `connector_runs`                    | One run of a connector: how it started, whether it worked and what it did.                                                                                                                                                                                                                                                                      |
| `calendar_feeds`                    | Your calendar subscription links: what each covers (`scope`), the label, when it was last used and whether it is revoked. The link itself is never kept; it comes back once from `create_calendar_feed`.                                                                                                                                        |
| `connector_run_logs`                | The log lines of a connector run.                                                                                                                                                                                                                                                                                                               |

## Actions

Each action is `POST /api/db/rpc/<name>`. Arguments marked * are required.

### `request_reagent_order`

Request a reagent order. Asks for more of a material that is running low. A steward places the order.

Scope: `lab:write`.

| Argument                 | Type |                                 |
| ------------------------ | ---- | ------------------------------- |
| `p_material_record_id` * | uuid | The material record to reorder. |
| `p_quantity` *           | num  | Amount.                         |
| `p_unit`                 | text | Unit of the quantity.           |
| `p_note`                 | text | A note.                         |

### `mark_reagent_ordered`

Mark a reagent order as placed. Records that the order was placed with the supplier. Needs an owner, admin or steward.

Scope: `lab:write`.

| Argument            | Type |                                      |
| ------------------- | ---- | ------------------------------------ |
| `p_order_id` *      | uuid | Reagent order id.                    |
| `p_order_reference` | text | The supplier's order number.         |
| `p_expected_on`     | date | Expected delivery date (YYYY-MM-DD). |
| `p_supplier`        | text | Supplier name.                       |

### `receive_reagent_order`

Receive a reagent order. Registers the delivery as a new lot of the material and closes the order. `p_quantity` defaults to the quantity ordered.

Scope: `lab:write`.

| Argument       | Type |                           |
| -------------- | ---- | ------------------------- |
| `p_order_id` * | uuid | Reagent order id.         |
| `p_lot` *      | text | Lot number.               |
| `p_expiry` *   | date | Expiry date (YYYY-MM-DD). |
| `p_quantity`   | num  | Amount.                   |

### `cancel_reagent_order`

Cancel a reagent order. Cancels an order that has not been received.

Scope: `lab:write`.

| Argument       | Type |                     |
| -------------- | ---- | ------------------- |
| `p_order_id` * | uuid | Reagent order id.   |
| `p_reason`     | text | Why, in a sentence. |

### `create_recurring_schedule`

Create a recurring booking or experiment. Plans repeating bookings or experiments. Returns the schedule and what was created.

Scope: `lab:write`.

| Argument                 | Type  |                                                         |
| ------------------------ | ----- | ------------------------------------------------------- |
| `p_kind` *               | text  | Kind, as listed in the app.                             |
| `p_title` *              | text  | Title.                                                  |
| `p_frequency` *          | text  | `daily`, `weekly`, `monthly` or `yearly`.               |
| `p_starts_on` *          | date  | First date (YYYY-MM-DD).                                |
| `p_timezone` *           | text  | IANA time zone, such as `Europe/London`.                |
| `p_interval_count`       | int   | Every N periods (default 1).                            |
| `p_weekdays`             | int[] | Days of the week, 1 (Monday) to 7 (Sunday).             |
| `p_offsets_days`         | int[] | Days after the start for each occurrence.               |
| `p_ends_on`              | date  | Last date (YYYY-MM-DD).                                 |
| `p_max_occurrences`      | int   | Stop after this many runs.                              |
| `p_resource_id`          | uuid  | The instrument to book.                                 |
| `p_start_time`           | time  | Start time (HH:MM).                                     |
| `p_end_time`             | time  | End time (HH:MM).                                       |
| `p_notebook_template_id` | uuid  | Template an experiment is made from.                    |
| `p_lead_days`            | int   | Create the experiment this many days ahead (default 0). |
| `p_project_id`           | uuid  | Project id.                                             |
| `p_notes`                | text  | Notes.                                                  |

### `set_recurring_schedule_paused`

Pause or resume a recurring schedule. Stops or restarts new runs without losing the schedule.

Scope: `lab:write`.

| Argument          | Type |                                 |
| ----------------- | ---- | ------------------------------- |
| `p_schedule_id` * | uuid | Recurring schedule id.          |
| `p_paused` *      | bool | `true` pauses, `false` resumes. |

### `end_recurring_schedule`

End a recurring schedule. Ends the schedule; optionally cancels bookings already made.

Scope: `lab:write`.

| Argument            | Type |                                        |
| ------------------- | ---- | -------------------------------------- |
| `p_schedule_id` *   | uuid | Recurring schedule id.                 |
| `p_cancel_upcoming` | bool | Also cancel the bookings already made. |

### `materialise_recurring_schedule`

Create the next runs of a schedule now. Makes the bookings or experiments that are due within the schedule's lead time.

Scope: `lab:write`.

| Argument          | Type |                        |
| ----------------- | ---- | ---------------------- |
| `p_schedule_id` * | uuid | Recurring schedule id. |

### `set_instrument_out_of_service`

Take an instrument out of service, or return it. Takes it out of service with a reason, or returns it to service with the work done. Needs an owner, admin or steward.

Scope: `lab:write`.

| Argument             | Type |                                                     |
| -------------------- | ---- | --------------------------------------------------- |
| `p_instrument_id` *  | uuid | Instrument id.                                      |
| `p_out_of_service` * | bool | `true` takes it out of service, `false` returns it. |
| `p_reason`           | text | Why, in a sentence.                                 |
| `p_expected_back_on` | date | When it should be back (YYYY-MM-DD).                |
| `p_work_done`        | text | What was done to put it right.                      |

### `log_instrument_service`

Log a service visit. Adds a service, repair or calibration visit to the instrument's log.

Scope: `lab:write`.

| Argument            | Type |                                 |
| ------------------- | ---- | ------------------------------- |
| `p_instrument_id` * | uuid | Instrument id.                  |
| `p_kind` *          | text | Kind, as listed in the app.     |
| `p_visited_on` *    | date | Date of the visit (YYYY-MM-DD). |
| `p_summary` *       | text | One-line summary.               |
| `p_details`         | text | Details.                        |
| `p_performed_by`    | text | Who did the work.               |

### `set_instrument_booking_rules`

Set booking rules and required training for an instrument. Replaces the instrument's booking limits and required training. Needs an owner, admin or steward.

Scope: `lab:write`.

| Argument                  | Type   |                                                         |
| ------------------------- | ------ | ------------------------------------------------------- |
| `p_instrument_id` *       | uuid   | Instrument id.                                          |
| `p_required_protocol_ids` | uuid[] | Training protocols required before booking.             |
| `p_max_booking_minutes`   | int    | Longest single booking, in minutes. Omit for no limit.  |
| `p_max_advance_days`      | int    | How many days ahead people may book. Omit for no limit. |

### `record_instrument_readings`

Record instrument readings. Adds readings to the instrument's feeds, creating a feed for a new name. Returns how many were stored and any alerts raised.

Scope: `lab:write`.

| Argument            | Type |                                                                          |
| ------------------- | ---- | ------------------------------------------------------------------------ |
| `p_instrument_id` * | uuid | Instrument id.                                                           |
| `p_readings` *      | json | JSON array of `{ feed, value, at }`; `at` is optional (defaults to now). |

### `query_storage_readings`

Read freezer and room readings. Returns the readings kept for freezers, fridges, incubators and rooms: each measurement with its latest value, alarm limits and whether it is inside them (`state` is `ok`, `low` or `high`). Name a unit or a room, or leave both out for all of them.

Scope: `lab:read`.

| Argument              | Type |                                                 |
| --------------------- | ---- | ----------------------------------------------- |
| `p_unit_id`           | uuid | Storage unit (freezer, fridge or incubator) id. |
| `p_room_id`           | uuid | Storage room id.                                |
| `p_out_of_range_only` | bool | Only measurements outside their limits.         |
| `p_limit`             | int  | Page size, 1 to 500 (default 100).              |

### `record_storage_readings`

Record freezer or room readings. Adds readings to one storage unit or room (name exactly one), creating a measurement for a new name. A temperature starts with that place's own range as its limits. Going outside the limits, or coming back, tells the people who manage storage and sends `storage.alarm.raised` or `storage.alarm.cleared` to webhooks. Returns how many were stored.

Scope: `lab:write`.

| Argument       | Type |                                                                          |
| -------------- | ---- | ------------------------------------------------------------------------ |
| `p_unit_id`    | uuid | Storage unit id.                                                         |
| `p_room_id`    | uuid | Storage room id.                                                         |
| `p_readings` * | json | JSON array of `{ feed, value, at }`; `at` is optional (defaults to now). |

### `set_instrument_feed_limits`

Set a feed's alert limits. Sets the low and high limits that raise alerts for a feed.

Scope: `lab:write`.

| Argument      | Type |                       |
| ------------- | ---- | --------------------- |
| `p_feed_id` * | uuid | Instrument feed id.   |
| `p_low` *     | num  | Low alert limit.      |
| `p_high` *    | num  | High alert limit.     |
| `p_unit`      | text | Unit of the quantity. |

### `remove_instrument_feed`

Remove an instrument feed. Deletes a feed and its readings.

Scope: `lab:write`.

| Argument      | Type |                     |
| ------------- | ---- | ------------------- |
| `p_feed_id` * | uuid | Instrument feed id. |

### `list_instrument_feed_series`

Chart data for an instrument feed. Returns min, average and max per time bucket, ready to chart.

Scope: `lab:read`.

| Argument      | Type |                                       |
| ------------- | ---- | ------------------------------------- |
| `p_feed_id` * | uuid | Instrument feed id.                   |
| `p_since` *   | ts   | Start of the window.                  |
| `p_until`     | ts   | End of the window (default now).      |
| `p_buckets`   | int  | Number of time buckets (default 240). |

### `my_instrument_training_gaps`

Training the caller still needs for an instrument. Lists required protocols the person has not yet been trained on.

Scope: `lab:read`.

| Argument            | Type |                |
| ------------------- | ---- | -------------- |
| `p_instrument_id` * | uuid | Instrument id. |

### `start_step_timer`

Start a step timer. Starts a countdown on a protocol step for the person the token belongs to (needs a personal token).

Scope: `lab:write`.

| Argument       | Type |                                                           |
| -------------- | ---- | --------------------------------------------------------- |
| `p_block_id` * | uuid | The protocol step block (a `procedure_step` block).       |
| `p_seconds`    | int  | Duration in seconds. Omit to use the step's own duration. |

### `end_step_timer`

End a step timer. Stops a running timer.

Scope: `lab:write`.

| Argument       | Type |                |
| -------------- | ---- | -------------- |
| `p_timer_id` * | uuid | Step timer id. |

### `set_step_done`

Finish or reopen a protocol step. Ticks a protocol step as done, or reopens it, with an optional note. The step records who finished it and when. Returns the step.

Scope: `lab:write`.

| Argument       | Type |                                                     |
| -------------- | ---- | --------------------------------------------------- |
| `p_block_id` * | uuid | The protocol step block (a `procedure_step` block). |
| `p_done`       | bool | true to finish it (default), false to reopen it.    |
| `p_note`       | text | A note.                                             |

Finishing a step sends `step.completed`, reopening it `step.reopened` (see the [event catalogue](event-catalogue.md)). A submitted or signed notebook refuses the change, as it does on the page.

### `add_step_result`

Record a result on a protocol step. Adds a measurement to the notebook straight after the step, so it reads in order and goes to review with the record. Returns the new block. Sends `step.result_added`.

Scope: `lab:write`.

| Argument       | Type |                                                     |
| -------------- | ---- | --------------------------------------------------- |
| `p_block_id` * | uuid | The protocol step block (a `procedure_step` block). |
| `p_label` *    | text | What was measured.                                  |
| `p_value` *    | text | The measured value, as a number or text.            |
| `p_unit`       | text | Unit of the quantity.                               |

### `record_steps`

List the steps of an experiment with their status. Every protocol step in order. `status` comes from the evidence on the notebook: `done` when ticked, `in_progress` when it has a note, a result or a running timer of yours, otherwise `not_started`. `is_current` marks the first step that is not done. In an experiment with parts, `step_number` is the place in the part.

Scope: `lab:read`.

| Argument        | Type |            |
| --------------- | ---- | ---------- |
| `p_record_id` * | uuid | Record id. |

### `start_experiment_series`

Make an experiment a series. Marks an experiment as the head of a series so members can be added. Adding the first member does this by itself. Safe to repeat.

Scope: `lab:write`.

| Argument        | Type |            |
| --------------- | ---- | ---------- |
| `p_record_id` * | uuid | Record id. |

### `add_series_member`

Add an experiment to a series. Puts an experiment in a series, at the end unless a position is given, and makes the series if it is not one yet. The experiment keeps its own owner, review and signature and is not changed, even when approved. An experiment is in one series at most and a series cannot sit inside another. Returns the membership. Sends `experiment.series_member_added` (see the [event catalogue](event-catalogue.md)).

Scope: `lab:write`.

| Argument               | Type |                                                           |
| ---------------------- | ---- | --------------------------------------------------------- |
| `p_series_record_id` * | uuid | The experiment that heads the series.                     |
| `p_member_record_id` * | uuid | The experiment that is, or is to become, a member.        |
| `p_position`           | num  | Where it sits in the series. Omit for the end.            |
| `p_planned_on`         | date | The day it is planned to run (YYYY-MM-DD). Omit for none. |

### `remove_series_member`

Take an experiment out of its series. Removes an experiment from the series it is in. The experiment is not changed. Sends `experiment.series_member_removed`.

Scope: `lab:write`.

| Argument               | Type |                                                    |
| ---------------------- | ---- | -------------------------------------------------- |
| `p_member_record_id` * | uuid | The experiment that is, or is to become, a member. |

### `move_series_member`

Move an experiment within its series. Changes where a member sits. Positions are numbers and members are ordered by them; use a number between two neighbours to go between them.

Scope: `lab:write`.

| Argument               | Type |                                                    |
| ---------------------- | ---- | -------------------------------------------------- |
| `p_member_record_id` * | uuid | The experiment that is, or is to become, a member. |
| `p_position` *         | num  | Where it sits in the series. Omit for the end.     |

### `set_series_member_day`

Plan the day a series member runs. Sets the day a member of a series is planned for, or clears it when `p_planned_on` is left out. The series counts its days from the earliest planned day.

Scope: `lab:write`.

| Argument               | Type |                                                           |
| ---------------------- | ---- | --------------------------------------------------------- |
| `p_member_record_id` * | uuid | The experiment that is, or is to become, a member.        |
| `p_planned_on`         | date | The day it is planned to run (YYYY-MM-DD). Omit for none. |

### `dissolve_experiment_series`

Stop treating an experiment as a series. Removes the series, which frees its members. Neither the head nor the members are changed otherwise. Sends `experiment.series_member_removed` for each member.

Scope: `lab:write`.

| Argument        | Type |            |
| --------------- | ---- | ---------- |
| `p_record_id` * | uuid | Record id. |

### `series_members`

List the experiments in a series. The members of a series in order, as you may see them: an experiment you cannot read is left out. Each row has the experiment, its status, owner, reviewer, planned day, steps done out of total and how many samples it links.

Scope: `lab:read`.

| Argument               | Type |                                       |
| ---------------------- | ---- | ------------------------------------- |
| `p_series_record_id` * | uuid | The experiment that heads the series. |

### `series_rollup`

What a series adds up to. How many experiments the series has and how many are approved, in review and in progress, the next one due, the samples across all of them and the first and last planned days.

Scope: `lab:read`.

| Argument               | Type |                                       |
| ---------------------- | ---- | ------------------------------------- |
| `p_series_record_id` * | uuid | The experiment that heads the series. |

### `record_series`

Which series an experiment is in. The series an experiment belongs to, where it sits ("3 of 5") and the experiments either side of it. No row when it is in no series.

Scope: `lab:read`.

| Argument        | Type |            |
| --------------- | ---- | ---------- |
| `p_record_id` * | uuid | Record id. |

### `record_parts`

List the parts of an experiment with where each stands. Every part in order, with `due_on` (the day it falls on) and its steps. `status` is `done`, `now` (the first part that is not done) or `later`. Empty for an experiment with no parts.

Scope: `lab:read`.

| Argument        | Type |            |
| --------------- | ---- | ---------- |
| `p_record_id` * | uuid | Record id. |

### `parts_in_range`

List the parts of running experiments that fall in a range of days. Parts of experiments that are in progress or returned, whose day falls from `p_from` up to (not including) `p_to`, in date order. `due_on` is the day. `status` is `done`, `now` or `later`. At most 500 rows.

Scope: `lab:read`.

| Argument   | Type | Notes                            |
| ---------- | ---- | -------------------------------- |
| `p_from` * | date | First day (YYYY-MM-DD).          |
| `p_to` *   | date | Day to stop before (YYYY-MM-DD). |

### `create_experiment_part`

Add a part to an experiment. Adds a part after `p_after_part_id`, or at the end. The first part takes the blocks already on the page. Returns the part. Sends `experiment.part_created`.

Scope: `lab:write`.

| Argument          | Type | Notes                                                                                     |
| ----------------- | ---- | ----------------------------------------------------------------------------------------- |
| `p_record_id` *   | uuid | Record id.                                                                                |
| `p_title` *       | text | Title.                                                                                    |
| `p_day_offset`    | int  | The day the part falls on, counted from the start of the experiment (0 is the first day). |
| `p_after_part_id` | uuid | Put it after this part. Leave out to put it first or last.                                |

### `update_experiment_part`

Change a part of an experiment. Changes the title, the day or who does it. Pass `p_clear_assignee` to clear the person. Returns the part.

Scope: `lab:write`.

| Argument             | Type | Notes                                                                                     |
| -------------------- | ---- | ----------------------------------------------------------------------------------------- |
| `p_part_id` *        | uuid | The part of the experiment.                                                               |
| `p_title`            | text | Title.                                                                                    |
| `p_day_offset`       | int  | The day the part falls on, counted from the start of the experiment (0 is the first day). |
| `p_assignee_user_id` | text | The person to assign it to.                                                               |
| `p_clear_assignee`   | bool | true to clear who does the part.                                                          |

### `move_experiment_part`

Reorder the parts of an experiment. Moves a part to sit after `p_after_part_id`, or first when that is left out. Its blocks move with it. Returns the part.

Scope: `lab:write`.

| Argument          | Type | Notes                                                      |
| ----------------- | ---- | ---------------------------------------------------------- |
| `p_part_id` *     | uuid | The part of the experiment.                                |
| `p_after_part_id` | uuid | Put it after this part. Leave out to put it first or last. |

### `delete_experiment_part`

Delete a part of an experiment. A part that still has blocks needs `p_move_blocks_to`, the part that takes them. Returns how many blocks moved.

Scope: `lab:write`.

| Argument           | Type | Notes                                                     |
| ------------------ | ---- | --------------------------------------------------------- |
| `p_part_id` *      | uuid | The part of the experiment.                               |
| `p_move_blocks_to` | uuid | The part that takes the blocks of the part being deleted. |

### `set_part_done`

Mark a part of an experiment done or open. For a part with no steps; a part with steps is done when its steps are. Finishing the current part opens the next. Returns the part. Finishing a part sends `experiment.part_completed` and reopening it `experiment.part_reopened`; the next part opening sends `experiment.part_opened` (see the [event catalogue](event-catalogue.md)).

Scope: `lab:write`.

| Argument      | Type | Notes                                  |
| ------------- | ---- | -------------------------------------- |
| `p_part_id` * | uuid | The part of the experiment.            |
| `p_done` *    | bool | true to finish it, false to reopen it. |

### `pin_protocol_reference`

Pin a protocol to an experiment and copy its steps and gates. Pins the exact protocol version into the experiment's empty protocol block, copies its procedure steps in, and brings the protocol's gate blocks across in their place. Gates from the protocol cannot be changed or removed on the experiment. Returns the block, the pinned revision, `copied_steps` and `copied_gates`.

| Parameter                        | Type | Notes                                      |
| -------------------------------- | ---- | ------------------------------------------ |
| `p_block_id` *                   | uuid | The empty protocol block.                  |
| `p_protocol_record_id` *         | uuid | The protocol to pin.                       |
| `p_expected_block_version` *     | int  | The block version you read.                |
| `p_expected_structure_version` * | int  | The experiment structure version you read. |

### `record_gates`

List the gates of an experiment and what each still waits on. Every gate in page order: the "opens when" rule of each part, then the gate blocks. `met` is true when every condition holds. `blocking` is true when the gate holds work back now: it is unmet, set to `block`, and not only waiting on a date. `missing` says what is still to do, in words, and `conditions` has the answer for each condition. `overridden` is true when someone went on past a gate that warns. A protocol can hold gate blocks too: they hold nothing while the protocol is written, and come across with its steps when the protocol is pinned to an experiment, as gates from the protocol that cannot be changed or removed there.

Scope: `lab:read`.

| Argument        | Type |            |
| --------------- | ---- | ---------- |
| `p_record_id` * | uuid | Record id. |

### `set_part_gate`

Set the rule that opens a part of an experiment. Sets, changes or clears the conditions that open a part, whether the gate warns or blocks, and whether the steps of the part are done in order. A gate that came from a template cannot be changed. Returns the part. A gate that blocks is enforced by the database: writes in the part, and finishing it, are refused with error code `SB150` until the conditions hold.

`p_conditions` is a list of conditions, all of which must hold. Each has a `kind`: `table_filled` (`blockId`, optionally `column` and `minRows`), `step_done` (`blockId`), `part_done` (`partId`), `samples_linked` (optionally `min`), `field_set` (`field`), `date_reached` (`date`, which only warns and never blocks) `qc_in_control` (optionally `seriesId`; unmet while a tracked quality control series has a breach nobody has acknowledged) or `plugin_flag` (`extensionKey`, optionally `flagKey` and `label`; met while the plugin has nothing open on the experiment, such as a hold or a sign-off step it asked for). Leave it out to take the rule off the part.

Scope: `lab:write`.

| Argument           | Type | Notes                                             |
| ------------------ | ---- | ------------------------------------------------- |
| `p_part_id` *      | uuid | The part of the experiment.                       |
| `p_conditions`     | json | The conditions that open the part.                |
| `p_gate_mode`      | text | `warn` (the default) or `block`.                  |
| `p_steps_in_order` | bool | true to make the steps of the part wait in order. |

### `set_field_plugin_type`

Give a model field a plugin field type, or take it away. Pass the plugin key and type id to give the field that type, or leave both out to clear it. Needs permission to edit models. The plugin has to be installed, on, with its field types switched on, and declare the type. Returns true when a type was applied. Sends `extension.field_type.applied` or `extension.field_type.removed` (see the [event catalogue](event-catalogue.md)).

Scope: `lab:write`.

| Argument         | Type | Notes                           |
| ---------------- | ---- | ------------------------------- |
| `p_kind` *       | text | The model key.                  |
| `p_field_name` * | text | The field to change.            |
| `p_plugin_key`   | text | The plugin; leave out to clear. |
| `p_type_id`      | text | The type the plugin declares.   |

### `override_gate`

Go on past a gate that warns, with a reason. Name the gate block or the part. The reason (1 to 2000 characters) is kept with the experiment and shown to the reviewer. A gate that blocks cannot be gone past (`SB155`), and one that is already open needs no going past (`SB156`). Returns the override. Sends `experiment.gate_overridden` (see the [event catalogue](event-catalogue.md)).

Scope: `lab:write`.

| Argument          | Type | Notes                             |
| ----------------- | ---- | --------------------------------- |
| `p_gate_block_id` | uuid | The gate block. Or the part:      |
| `p_gate_part_id`  | uuid | The part whose rule is not met.   |
| `p_reason` *      | text | Why work goes on before it opens. |

### `set_block_part`

Move a block to another part. Puts any block of the notebook at the end of that part. Returns the block, its part and its new order.

Scope: `lab:write`.

| Argument       | Type | Notes                       |
| -------------- | ---- | --------------------------- |
| `p_block_id` * | uuid | The block.                  |
| `p_part_id` *  | uuid | The part of the experiment. |

### `set_link_part`

Move a sample, dataset or other link to another part. Links made from an experiment that has parts land in the part being worked on. This moves one to another part of the same experiment. Returns the link and its part.

Scope: `lab:write`.

| Argument      | Type | Notes                         |
| ------------- | ---- | ----------------------------- |
| `p_link_id` * | uuid | The link between two records. |
| `p_part_id` * | uuid | The part of the experiment.   |

### `split_record_into_parts`

Split an experiment into parts. Divides a notebook that has no parts at the blocks you name. Returns the parts.

Scope: `lab:write`.

| Argument        | Type | Notes                                                                                                                         |
| --------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------- |
| `p_record_id` * | uuid | Record id.                                                                                                                    |
| `p_parts` *     | json | The parts to make, in order: each `{title, first_block_id, day_offset}`. A part runs from its first block to the next part's. |

### `part_signoff_preview`

Show what signing a part would cover. The SHA-256 digest of the part as it is now, how many blocks and steps it holds, whether it needs a signature, is finished and is signed. A signature is bound to this digest. Signing itself is done by a person in the app with a fresh password, never over the API.

Scope: `lab:read`.

| Argument      | Type | Notes                       |
| ------------- | ---- | --------------------------- |
| `p_part_id` * | uuid | The part of the experiment. |

### `search_plugin_index`

Search what a plugin put in one of its indexes. Ranks the entries a plugin’s hooks added to one of its search indexes, by the words given, by a vector, or both, among the records this person can see. Best first, with a snippet.

Scope: `lab:read`.

| Argument            | Type | Notes                                                                                               |
| ------------------- | ---- | --------------------------------------------------------------------------------------------------- |
| `p_extension_key` * | text | The plugin’s key.                                                                                   |
| `p_index_name` *    | text | The name of one of the plugin’s search indexes.                                                     |
| `p_query`           | text | Words to look for.                                                                                  |
| `p_vector`          | json | A list of numbers to rank by closeness. Entries kept with a different number of values are skipped. |
| `p_limit`           | int  | How many to return (default 50).                                                                    |

### `registry_sameness_matches`

Find registry entries that a plugin rule says are the same thing. Entries of the model whose stored key equals the one given, that this person can see. Work the key out with the plugin (POST /api/plugins/data, kind `sameness-key`) first.

Scope: `lab:read`.

| Argument        | Type | Notes                                          |
| --------------- | ---- | ---------------------------------------------- |
| `p_model_key` * | text | Record model key.                              |
| `p_value` *     | text | The key the plugin rule gave.                  |
| `p_exclude_id`  | uuid | Ignore this entry when looking for duplicates. |

### `record_part_signoffs`

List where each part of an experiment stands on signatures. Every part in order: whether it needs a signature, is finished and waiting (`awaiting_sign_off`), who signed and when, who has countersigned or been asked to, and how often it was amended (with the last reason). Empty for an experiment with no parts.

Scope: `lab:read`.

| Argument        | Type | Notes      |
| --------------- | ---- | ---------- |
| `p_record_id` * | uuid | Record id. |

### `set_parts_sign_off`

Require a signature on the parts of an experiment, or stop requiring it. Applies to the parts that are not signed yet, and to parts added later. When a part needs a signature it counts as finished only once it is signed, and the parts after it cannot be worked until then. Returns how many parts changed.

Scope: `lab:write`.

| Argument        | Type | Notes                                                  |
| --------------- | ---- | ------------------------------------------------------ |
| `p_record_id` * | uuid | Record id.                                             |
| `p_required` *  | bool | `true` if each part needs a signature, `false` if not. |

### `request_part_signoff`

Ask someone to sign or countersign a part of an experiment. For a finished part that is waiting, asks the person to sign it; for a signed part, asks them to countersign. They get a notification. Nothing is signed on their behalf: signing needs the person, in the app, with a fresh password.

Scope: `lab:write`.

| Argument      | Type | Notes                                                  |
| ------------- | ---- | ------------------------------------------------------ |
| `p_part_id` * | uuid | The part of the experiment.                            |
| `p_user_id` * | text | The person (their user id).                            |
| `p_note`      | text | A note.                                                |
| `p_due_at`    | ts   | When it is wanted by (an ISO date and time). Optional. |

### `amend_experiment_part`

Reopen a signed part of an experiment to amend it. Needs a reason. Only that part is reopened; the signature stays on record and the part has to be signed again before the parts after it can go on. Returns the amendment. Sends `experiment.part_amended`.

Scope: `lab:write`.

| Argument      | Type | Notes                       |
| ------------- | ---- | --------------------------- |
| `p_part_id` * | uuid | The part of the experiment. |
| `p_reason` *  | text | Why, in a sentence.         |

### `set_material_safety`

Set chemical safety information. Sets pictograms, signal word and hazard statements for a material, on every lot unless `p_all_lots` is false. Returns how many records changed.

Scope: `lab:write`.

| Argument                | Type   |                                                    |
| ----------------------- | ------ | -------------------------------------------------- |
| `p_record_id` *         | uuid   | Record id.                                         |
| `p_pictograms` *        | text[] | GHS pictogram codes, such as `GHS02`.              |
| `p_signal_word` *       | text   | `Danger` or `Warning`.                             |
| `p_hazard_statements` * | text[] | Hazard statements, such as `H225`.                 |
| `p_all_lots`            | bool   | Apply to every lot of the material (default true). |

### `register_replacement_lot`

Register a replacement lot. Adds a new lot of a reagent that replaces the one in use. Returns the new lot.

Scope: `lab:write`.

| Argument                | Type |                                 |
| ----------------------- | ---- | ------------------------------- |
| `p_reagent_record_id` * | uuid | The reagent or material record. |
| `p_lot` *               | text | Lot number.                     |
| `p_expiry` *            | date | Expiry date (YYYY-MM-DD).       |
| `p_quantity` *          | num  | Amount.                         |
| `p_unit`                | text | Unit of the quantity.           |
| `p_reason`              | text | Why, in a sentence.             |

### `start_stocktake`

Start a stocktake. Starts a stocktake of a freezer, shelf, rack or box and lists what should be there.

Scope: `lab:write`.

| Argument          | Type |                                                                  |
| ----------------- | ---- | ---------------------------------------------------------------- |
| `p_scope_level` * | text | `freezer`, `shelf`, `rack` or `box`, matching the storage level. |
| `p_scope_id` *    | uuid | Storage location id.                                             |
| `p_note`          | text | A note.                                                          |

### `record_stocktake_scan`

Record a scanned item. Marks an item as found, in the box given or where it was expected.

Scope: `lab:write`.

| Argument           | Type |                           |
| ------------------ | ---- | ------------------------- |
| `p_stocktake_id` * | uuid | Stocktake id.             |
| `p_record_id` *    | uuid | Record id.                |
| `p_box_id`         | uuid | Where the item was found. |

### `resolve_stocktake_item`

Resolve a stocktake mismatch. Closes a missing or misplaced item with an action and a note.

Scope: `lab:write`.

| Argument      | Type |                              |
| ------------- | ---- | ---------------------------- |
| `p_item_id` * | uuid | Stocktake item id.           |
| `p_action` *  | text | How to resolve the mismatch. |
| `p_notes`     | text | Notes.                       |

### `complete_stocktake`

Complete a stocktake. Finishes the stocktake; items not found stay flagged.

Scope: `lab:write`.

| Argument           | Type |               |
| ------------------ | ---- | ------------- |
| `p_stocktake_id` * | uuid | Stocktake id. |

### `cancel_stocktake`

Cancel a stocktake. Cancels a stocktake that is in progress.

Scope: `lab:write`.

| Argument           | Type |               |
| ------------------ | ---- | ------------- |
| `p_stocktake_id` * | uuid | Stocktake id. |

### `prepare_solution`

Prepare a solution from lots. Makes a new solution record from ingredient lots and takes the quantities from stock. Returns the new record and what was used.

Scope: `lab:write`.

| Argument          | Type |                                                |
| ----------------- | ---- | ---------------------------------------------- |
| `p_project_id` *  | uuid | Project id.                                    |
| `p_title` *       | text | Title.                                         |
| `p_lot` *         | text | Lot number.                                    |
| `p_quantity` *    | num  | Amount.                                        |
| `p_unit` *        | text | Unit of the quantity.                          |
| `p_ingredients` * | json | JSON array of `{ record_id, quantity, unit }`. |
| `p_expiry`        | date | Expiry date (YYYY-MM-DD).                      |
| `p_storage`       | text | Where the solution is stored.                  |
| `p_note`          | text | A note.                                        |

### `pool_samples`

Pool samples. Combines samples into a new pooled sample for an experiment and records where each part came from.

Scope: `lab:write`.

| Argument                    | Type |                                                  |
| --------------------------- | ---- | ------------------------------------------------ |
| `p_sources` *               | json | JSON array of `{ record_id, quantity }` to pool. |
| `p_purpose_experiment_id` * | uuid | The experiment the pool is for.                  |
| `p_unit`                    | text | Unit of the quantity.                            |
| `p_notes`                   | text | Notes.                                           |
| `p_new_container`           | json | JSON describing the new container. Optional.     |

### `save_sample_workflow`

Create or update a sample workflow. Saves a workflow definition (stages and transitions). Omit `p_workflow_id` to create. Returns the workflow id.

Scope: `lab:write`.

| Argument          | Type |                                                                                   |
| ----------------- | ---- | --------------------------------------------------------------------------------- |
| `p_workflow_id` * | uuid | Sample workflow id. Omit to create a workflow.                                    |
| `p_definition` *  | json | JSON workflow definition: name, description, sample type, stages and transitions. |

### `set_sample_workflow_status`

Publish or archive a sample workflow. Sets a workflow to draft, active or archived.

Scope: `lab:write`.

| Argument          | Type |                                                |
| ----------------- | ---- | ---------------------------------------------- |
| `p_workflow_id` * | uuid | Sample workflow id. Omit to create a workflow. |
| `p_status` *      | text | New status.                                    |

### `enrol_sample_in_workflow`

Put a sample into a workflow. Starts a run for the sample at the workflow's first stage.

Scope: `lab:write`.

| Argument          | Type |                                                |
| ----------------- | ---- | ---------------------------------------------- |
| `p_record_id` *   | uuid | Record id.                                     |
| `p_workflow_id` * | uuid | Sample workflow id. Omit to create a workflow. |

### `advance_sample_workflow`

Move a sample to another stage. Moves the sample along an allowed transition; checks required fields and runs the stage's actions.

Scope: `lab:write`.

| Argument          | Type |                   |
| ----------------- | ---- | ----------------- |
| `p_run_id` *      | uuid | Workflow run id.  |
| `p_to_stage_id` * | uuid | Stage to move to. |
| `p_notes`         | text | Notes.            |

### `leave_sample_workflow`

Take a sample out of its workflow. Ends the run without finishing the workflow.

Scope: `lab:write`.

| Argument     | Type |                  |
| ------------ | ---- | ---------------- |
| `p_run_id` * | uuid | Workflow run id. |
| `p_notes`    | text | Notes.           |

### `create_registry_entry`

Add a registry entry. Creates an entry of a registry model (such as a cell line or construct). Refuses a likely duplicate unless `p_allow_duplicate` is true. A model with a same-thing rule from a plugin only takes entries that come with the rule’s key (`p_sameness_value`), and refuses one whose key is already registered.

Scope: `lab:write`.

| Argument            | Type |                                             |
| ------------------- | ---- | ------------------------------------------- |
| `p_project_id` *    | uuid | Project id.                                 |
| `p_kind` *          | text | Kind, as listed in the app.                 |
| `p_title` *         | text | Title.                                      |
| `p_custom_fields`   | json | Field values, keyed by field name.          |
| `p_allow_duplicate` | bool | Create it even when a similar entry exists. |
| `p_sameness_value`  | text | The key the model’s same-thing rule gives.  |

### `add_registry_parent`

Link a registry entry to a parent. Records lineage, such as a cell line derived from another.

Scope: `lab:write`.

| Argument        | Type |                                                 |
| --------------- | ---- | ----------------------------------------------- |
| `p_entry_id` *  | uuid | Registry entry id.                              |
| `p_parent_id` * | uuid | Parent entry id.                                |
| `p_role`        | text | How it relates to the entry (default `parent`). |

### `remove_registry_parent`

Remove a registry parent link. Removes the lineage link.

Scope: `lab:write`.

| Argument        | Type |                    |
| --------------- | ---- | ------------------ |
| `p_entry_id` *  | uuid | Registry entry id. |
| `p_parent_id` * | uuid | Parent entry id.   |

### `registry_find_duplicates`

Find similar registry entries. Lists entries that look like the one described.

Scope: `lab:read`.

| Argument          | Type |                                                |
| ----------------- | ---- | ---------------------------------------------- |
| `p_kind` *        | text | Kind, as listed in the app.                    |
| `p_title` *       | text | Title.                                         |
| `p_custom_fields` | json | Field values, keyed by field name.             |
| `p_exclude_id`    | uuid | Ignore this entry when looking for duplicates. |

### `assign_record`

Assign a record to a person. Hands the record to a person. The record must be at the `metadata_version` you read.

Scope: `lab:write`.

| Argument                        | Type |                                                        |
| ------------------------------- | ---- | ------------------------------------------------------ |
| `p_record_id` *                 | uuid | Record id.                                             |
| `p_expected_metadata_version` * | int  | The `metadata_version` last read; refused if it moved. |
| `p_assignee_user_id` *          | text | The person to assign it to.                            |

### `submit_request`

Send a request to the lab. Creates a request from a request form. Deciding it stays with the people who handle requests, in the app.

Scope: `lab:write`.

| Argument          | Type |                                    |
| ----------------- | ---- | ---------------------------------- |
| `p_model_key` *   | text | Record model key.                  |
| `p_title` *       | text | Title.                             |
| `p_custom_fields` | json | Field values, keyed by field name. |
| `p_project_id`    | uuid | Project id.                        |
| `p_note`          | text | A note.                            |

### `create_shipment`

Create a shipment. Starts a draft inbound or outbound shipment with its items.

Scope: `lab:write`.

| Argument               | Type |                                                                    |
| ---------------------- | ---- | ------------------------------------------------------------------ |
| `p_direction` *        | text | `inbound` or `outbound`.                                           |
| `p_counterparty` *     | text | Who it is going to or coming from.                                 |
| `p_items`              | json | JSON array of items: `{ record_id, title, quantity, unit, note }`. |
| `p_carrier`            | text | Carrier.                                                           |
| `p_tracking_reference` | text | Tracking reference.                                                |
| `p_expected_on`        | date | Expected delivery date (YYYY-MM-DD).                               |
| `p_notes`              | text | Notes.                                                             |
| `p_project_id`         | uuid | Project id.                                                        |

### `update_shipment`

Edit a shipment. Changes details or items while it is not yet delivered. Omit a field to keep it.

Scope: `lab:write`.

| Argument               | Type |                                                                    |
| ---------------------- | ---- | ------------------------------------------------------------------ |
| `p_shipment_id` *      | uuid | Shipment id.                                                       |
| `p_counterparty`       | text | Who it is going to or coming from.                                 |
| `p_carrier`            | text | Carrier.                                                           |
| `p_tracking_reference` | text | Tracking reference.                                                |
| `p_expected_on`        | date | Expected delivery date (YYYY-MM-DD).                               |
| `p_notes`              | text | Notes.                                                             |
| `p_items`              | json | JSON array of items: `{ record_id, title, quantity, unit, note }`. |

### `mark_shipment_in_transit`

Mark a shipment as sent. Records that it left, with carrier and tracking.

Scope: `lab:write`.

| Argument               | Type |                                      |
| ---------------------- | ---- | ------------------------------------ |
| `p_shipment_id` *      | uuid | Shipment id.                         |
| `p_shipped_on`         | date | Date shipped (YYYY-MM-DD).           |
| `p_carrier`            | text | Carrier.                             |
| `p_tracking_reference` | text | Tracking reference.                  |
| `p_expected_on`        | date | Expected delivery date (YYYY-MM-DD). |

### `receive_shipment`

Receive a shipment. Records what arrived and its condition.

Scope: `lab:write`.

| Argument           | Type |                                              |
| ------------------ | ---- | -------------------------------------------- |
| `p_shipment_id` *  | uuid | Shipment id.                                 |
| `p_results`        | json | JSON array of `{ item_id, received, note }`. |
| `p_condition_note` | text | Condition on arrival.                        |

### `cancel_shipment`

Cancel a shipment. Cancels a shipment that has not been received.

Scope: `lab:write`.

| Argument          | Type |                     |
| ----------------- | ---- | ------------------- |
| `p_shipment_id` * | uuid | Shipment id.        |
| `p_reason`        | text | Why, in a sentence. |

### `set_field_spec_limits`

Set result limits on a field. Sets specification and alert limits for a numeric field on a record kind. Needs an owner, admin or steward.

Scope: `lab:write`.

| Argument         | Type |                             |
| ---------------- | ---- | --------------------------- |
| `p_kind` *       | text | Kind, as listed in the app. |
| `p_field_name` * | text | Field name.                 |
| `p_lower`        | num  | Lower specification limit.  |
| `p_upper`        | num  | Upper specification limit.  |
| `p_alert_lower`  | num  | Lower alert limit.          |
| `p_alert_upper`  | num  | Upper alert limit.          |
| `p_note`         | text | A note.                     |

### `create_legal_hold`

Place a legal hold. Creates a hold on a project, a record kind or listed records. Held records cannot be deleted or archived.

Scope: `lab:write`.

| Argument       | Type   |                             |
| -------------- | ------ | --------------------------- |
| `p_name` *     | text   | Name.                       |
| `p_reason`     | text   | Why, in a sentence.         |
| `p_project_id` | uuid   | Project id.                 |
| `p_kind`       | text   | Kind, as listed in the app. |
| `p_record_ids` | uuid[] | Record ids.                 |

### `add_records_to_legal_hold`

Add records to a legal hold. Adds records to an open hold. Returns how many were added.

Scope: `lab:write`.

| Argument         | Type   |                |
| ---------------- | ------ | -------------- |
| `p_hold_id` *    | uuid   | Legal hold id. |
| `p_record_ids` * | uuid[] | Record ids.    |

### `is_record_on_hold`

Is a record on legal hold. Returns true when any open hold covers the record.

Scope: `lab:read`.

| Argument        | Type |            |
| --------------- | ---- | ---------- |
| `p_record_id` * | uuid | Record id. |

### `retention_due`

Records past their retention time. Lists records kept longer than their retention rule, optionally for one kind. It only lists; archiving stays with people in the app.

Scope: `lab:read`.

| Argument | Type |                             |
| -------- | ---- | --------------------------- |
| `p_kind` | text | Kind, as listed in the app. |

### `follow_project`

Follow a project. Follows a project for the person the token belongs to (needs a personal token). Returns when.

Scope: `lab:write`.

| Argument         | Type |             |
| ---------------- | ---- | ----------- |
| `p_project_id` * | uuid | Project id. |

### `unfollow_project`

Stop following a project. Needs a personal token.

Scope: `lab:write`.

| Argument         | Type |             |
| ---------------- | ---- | ----------- |
| `p_project_id` * | uuid | Project id. |

### `set_record_favourite`

Pin or unpin something. Pins an instrument, pipeline, analysis, material or record to the person's sidebar (needs a personal token). Returns when it was pinned.

Scope: `lab:write`.

| Argument          | Type |                                                                              |
| ----------------- | ---- | ---------------------------------------------------------------------------- |
| `p_object_kind` * | text | `instrument`, `pipeline`, `analysis`, `record` and the other pinnable kinds. |
| `p_object_id` *   | uuid | Id of the object.                                                            |
| `p_favourite` *   | bool | `true` to pin, `false` to unpin.                                             |

### `create_plate_run`

Create a plate run. Stores a plate: its format (`6_well` to `1536_well`), layout, readout and analysis settings. Returns the run. Sends `plate_run.created`.

Scope: `lab:write`.

| Argument       | Type |                                                                                                        |
| -------------- | ---- | ------------------------------------------------------------------------------------------------------ |
| `p_name` *     | text | Name.                                                                                                  |
| `p_format` *   | text | Plate format, such as `96_well` or `384_well`; or a worklist file format.                              |
| `p_wells`      | json | JSON array of `{ wellCode, role, sampleId, sampleLabel, concentration, concentrationUnit, volumeUl }`. |
| `p_readout`    | json | JSON object of well to reading, such as `{ "A1": 1204.5 }`.                                            |
| `p_config`     | json | JSON analysis settings: normalisation, hit rule, QC limits and curve model.                            |
| `p_project_id` | uuid | Project id.                                                                                            |
| `p_record_id`  | uuid | Record id.                                                                                             |
| `p_design_id`  | uuid | Plate design the layout came from.                                                                     |

### `update_plate_run`

Change a plate run. Renames a run or replaces its layout, readout or settings. Changing the layout, readout or settings clears the saved analysis. Returns the run.

Scope: `lab:write`.

| Argument                      | Type |                                                                                                        |
| ----------------------------- | ---- | ------------------------------------------------------------------------------------------------------ |
| `p_plate_run_id` *            | uuid | Plate run id.                                                                                          |
| `p_name`                      | text | Name.                                                                                                  |
| `p_wells`                     | json | JSON array of `{ wellCode, role, sampleId, sampleLabel, concentration, concentrationUnit, volumeUl }`. |
| `p_readout`                   | json | JSON object of well to reading, such as `{ "A1": 1204.5 }`.                                            |
| `p_config`                    | json | JSON analysis settings: normalisation, hit rule, QC limits and curve model.                            |
| `p_expected_metadata_version` | int  | The `metadata_version` last read; refused if it moved.                                                 |

### `save_plate_run_analysis`

Save the analysis of a plate run. Keeps an analysis beside the run it was computed from, with the plate QC verdict (`pass`, `warn`, `fail` or `not_checked`). Returns the run. Sends `plate_run.analysed`.

Scope: `lab:write`.

| Argument                      | Type |                                                                |
| ----------------------------- | ---- | -------------------------------------------------------------- |
| `p_plate_run_id` *            | uuid | Plate run id.                                                  |
| `p_analysis` *                | json | JSON analysis, as computed from the stored layout and readout. |
| `p_qc_status` *               | text | `pass`, `warn`, `fail` or `not_checked`.                       |
| `p_expected_metadata_version` | int  | The `metadata_version` last read; refused if it moved.         |

### `archive_plate_run`

Archive a plate run. Archives a run so it no longer shows in lists. Returns the run. Sends `plate_run.archived`.

Scope: `lab:write`.

| Argument           | Type |               |
| ------------------ | ---- | ------------- |
| `p_plate_run_id` * | uuid | Plate run id. |

### `create_plate_worklist`

Create a liquid handler worklist. Stores the transfers for a robot: `p_format` is `csv`, `echo`, `tecan_gwl`, `hamilton` or `opentrons`; `p_mode` is `stamp` or `cherry_pick`. `p_transfers` is a JSON array of `{ sourceWell, destWell, volumeUl, label, sampleId }`. Returns the worklist. Sends `plate_worklist.created`.

Scope: `lab:write`.

| Argument            | Type |                                                                           |
| ------------------- | ---- | ------------------------------------------------------------------------- |
| `p_name` *          | text | Name.                                                                     |
| `p_format` *        | text | Plate format, such as `96_well` or `384_well`; or a worklist file format. |
| `p_mode` *          | text | `stamp` (well to well) or `cherry_pick`.                                  |
| `p_source_plate` *  | text | Name or barcode of the source plate.                                      |
| `p_source_format` * | text | Source plate format.                                                      |
| `p_dest_plate` *    | text | Name or barcode of the destination plate.                                 |
| `p_dest_format` *   | text | Destination plate format.                                                 |
| `p_transfers` *     | json | JSON array of `{ sourceWell, destWell, volumeUl, label, sampleId }`.      |
| `p_plate_run_id`    | uuid | Plate run id.                                                             |
| `p_record_id`       | uuid | Record id.                                                                |
| `p_options`         | json | JSON options used to build the worklist.                                  |

### `complete_plate_worklist`

Complete a worklist from the robot log. Records what the robot did: `p_reconciled` is the planned transfers each with a `status` and `movedUl`. By default the volumes moved are withdrawn from the source samples for the experiment, which also links them to it; samples that cannot be withdrawn from are listed in `withdrawals`. Returns the worklist. Sends `plate_worklist.completed`.

Scope: `lab:write`.

| Argument               | Type |                                                                       |
| ---------------------- | ---- | --------------------------------------------------------------------- |
| `p_worklist_id` *      | uuid | Worklist id.                                                          |
| `p_reconciled` *       | json | JSON array of the planned transfers each with `status` and `movedUl`. |
| `p_purpose_record_id`  | uuid | The experiment the samples were used for.                             |
| `p_record_withdrawals` | bool | Withdraw what moved from the source samples (default true).           |

### `cancel_plate_worklist`

Cancel a worklist. Cancels a worklist that has not been completed. Returns the worklist.

Scope: `lab:write`.

| Argument          | Type |              |
| ----------------- | ---- | ------------ |
| `p_worklist_id` * | uuid | Worklist id. |

### `request_agent_action`

Ask to take an action. Records an action an agent wants to take and returns the request. The status comes back `refused` (Never), `pending` (Ask: a person approves it in the Inbox) or `approved` (Auto: the caller runs it now).

Scope: `lab:write`.

| Argument              | Type |                                                  |
| --------------------- | ---- | ------------------------------------------------ |
| `p_workspace_id` *    | uuid | Workspace id.                                    |
| `p_action_key` *      | text | The action, for example `request_reagent_order`. |
| `p_arguments` *       | json | The arguments the action will get.               |
| `p_summary` *         | text | A plain-words line for the approver.             |
| `p_provenance` *      | json | Where the request came from.                     |
| `p_idempotency_key` * | text | The same key returns the same request.           |

### `set_lab_watcher`

Turn a lab watcher on or off. `p_kind` is `stock_expiring`, `stock_low`, `work_overdue`, `data_missing` or `results_off`. Returns the watcher.

Scope: `lab:write`.

| Argument           | Type |                                                            |
| ------------------ | ---- | ---------------------------------------------------------- |
| `p_workspace_id` * | uuid | Workspace id.                                              |
| `p_kind` *         | text | Which review.                                              |
| `p_enabled` *      | bool | On or off.                                                 |
| `p_schedule`       | text | `hourly`, `daily` or `weekly`.                             |
| `p_project_id`     | uuid | Limit it to one project.                                   |
| `p_params`         | json | `days` (how soon counts as soon) or `sigma` (how far off). |

### `run_lab_watcher`

Run a lab watcher now. Looks straight away instead of waiting for the schedule. Returns how many new findings were made.

Scope: `lab:write`.

| Argument         | Type |             |
| ---------------- | ---- | ----------- |
| `p_watcher_id` * | uuid | Watcher id. |

### `set_watcher_finding_status`

Dismiss or snooze a watcher finding. `p_action` is `dismiss`, `snooze` (with `p_until`) or `reopen`. Returns the finding.

Scope: `lab:write`.

| Argument         | Type |                                  |
| ---------------- | ---- | -------------------------------- |
| `p_finding_id` * | uuid | Finding id.                      |
| `p_action` *     | text | `dismiss`, `snooze` or `reopen`. |
| `p_until`        | ts   | When a snoozed finding returns.  |

### `resolve_agent_action_level`

What an agent may do with an action. Returns `auto`, `ask` or `never` for the caller.

Scope: `lab:read`.

| Argument           | Type |                          |
| ------------------ | ---- | ------------------------ |
| `p_workspace_id` * | uuid | Workspace id.            |
| `p_action_key` *   | text | The action.              |
| `p_credential_id`  | uuid | A service credential id. |

### `finish_agent_action`

Record how an agent action ended. Marks an approved request as succeeded or failed once it has been run. Returns the request.

Scope: `lab:write`.

| Argument         | Type |                    |
| ---------------- | ---- | ------------------ |
| `p_request_id` * | uuid | Request id.        |
| `p_ok` *         | bool | Whether it worked. |
| `p_result`       | json | What it returned.  |
| `p_error`        | text | Why it failed.     |

### `record_instrument_run_document`

Keep an Allotrope document with an instrument run. Stores the ASM document an instrument file was converted to, beside the run it came from. One per run; sending it again replaces it. Returns the document. Sends `instrument.run.converted`.

Scope: `lab:write`.

| Argument              | Type |                                                                |
| --------------------- | ---- | -------------------------------------------------------------- |
| `p_run_id` *          | uuid | Run id: the workflow run, or the instrument run.               |
| `p_document` *        | json | The Allotrope Simple Model document, as JSON (at most 16 MiB). |
| `p_converter` *       | text | What made the document, for example `allotropy`.               |
| `p_converter_version` | text | Version of the converter.                                      |
| `p_image_digest`      | text | The immutable image that ran the converter.                    |
| `p_vendor`            | text | The instrument software the file came from.                    |
| `p_technique`         | text | Measurement technique, for example `Plate Reader`.             |
| `p_manifest`          | text | The Allotrope manifest the document follows.                   |
| `p_measurements`      | int  | Number of measurements in the document.                        |
| `p_device`            | json | JSON description of the instrument that wrote the file.        |

### `create_qc_series`

Track a value for quality control. Starts a series. For a value you send in, use `manual` and add points with `record_qc_point`; for a plate assay use `plate_metric` with a `p_design_id` and `p_metric`. Give `p_mean` and `p_sd`, or set a baseline later. Returns the series.

Scope: `lab:write`.

| Argument           | Type   |                                                                                                                                        |
| ------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `p_workspace_id` * | uuid   | Your workspace id.                                                                                                                     |
| `p_name` *         | text   | Name.                                                                                                                                  |
| `p_source_kind`    | text   | `manual` (points are sent in) or `plate_metric` (fed by the plate runs of an assay design).                                            |
| `p_metric`         | text   | For a plate series: `z_prime`, `signal_to_background`, `positive_mean`, `negative_mean`, `blank_mean`, `positive_cv` or `negative_cv`. |
| `p_design_id`      | uuid   | Plate design the layout came from.                                                                                                     |
| `p_instrument_id`  | uuid   | Instrument id.                                                                                                                         |
| `p_unit`           | text   | Unit of the quantity.                                                                                                                  |
| `p_mean`           | num    | Centre line of the control limits.                                                                                                     |
| `p_sd`             | num    | Standard deviation (greater than 0) of the control limits.                                                                             |
| `p_rules`          | text[] | Westgard rules to judge by, from `1-3s`, `2-2s`, `R-4s`, `4-1s` and `10x`.                                                             |

### `track_plate_assay_qc`

Track the controls of a plate assay. Starts a series for each plate quality metric (Z-prime, signal to background, control means) of an assay design, and backfills them from its analysed runs. Returns the series.

Scope: `lab:write`.

| Argument          | Type |                                    |
| ----------------- | ---- | ---------------------------------- |
| `p_design_id` *   | uuid | Plate design the layout came from. |
| `p_instrument_id` | uuid | Instrument id.                     |

### `update_qc_series`

Change a quality control series. Renames a series, changes its rules or unit, or pauses and resumes it. Changing the rules re-judges every point. Returns the series.

Scope: `lab:write`.

| Argument        | Type   |                                                                            |
| --------------- | ------ | -------------------------------------------------------------------------- |
| `p_series_id` * | uuid   | Quality control series id.                                                 |
| `p_name`        | text   | Name.                                                                      |
| `p_rules`       | text[] | Westgard rules to judge by, from `1-3s`, `2-2s`, `R-4s`, `4-1s` and `10x`. |
| `p_enabled`     | bool   | `false` pauses judging new points.                                         |
| `p_unit`        | text   | Unit of the quantity.                                                      |

### `delete_qc_series`

Stop tracking a series. Deletes a series and all of its points.

Scope: `lab:write`.

| Argument        | Type |                            |
| --------------- | ---- | -------------------------- |
| `p_series_id` * | uuid | Quality control series id. |

### `set_qc_baseline`

Set the control limits of a series. Enter `p_mean` and `p_sd`, or give `p_first_n` to take them from the first N points. Every point is judged again. Returns the series. Sends `qc.violation` or `qc.back_in_control` if the state changes.

Scope: `lab:write`.

| Argument        | Type |                                                                                 |
| --------------- | ---- | ------------------------------------------------------------------------------- |
| `p_series_id` * | uuid | Quality control series id.                                                      |
| `p_mean`        | num  | Centre line of the control limits.                                              |
| `p_sd`          | num  | Standard deviation (greater than 0) of the control limits.                      |
| `p_first_n`     | int  | Take the limits from the first N points (mean and SD) instead of entering them. |

### `record_qc_point`

Add a value to a series. Adds a measurement and judges it against the limits and the series rules. Returns the point, with its `z` and any `violations`. Sends `qc.violation` when a rule is broken, and `qc.back_in_control` when the series recovers.

Scope: `lab:write`.

| Argument              | Type |                                          |
| --------------------- | ---- | ---------------------------------------- |
| `p_series_id` *       | uuid | Quality control series id.               |
| `p_value` *           | num  | The measured value, as a number or text. |
| `p_at`                | ts   | When it was measured (default now).      |
| `p_label`             | text | What was measured.                       |
| `p_instrument_run_id` | uuid | The instrument run the value came from.  |

### `acknowledge_qc_point`

Acknowledge a quality control breach. Marks a broken point as seen, with a note, and optionally leaves it out of the limits so the series is judged again. Returns the point.

Scope: `lab:write`.

| Argument       | Type |                                                            |
| -------------- | ---- | ---------------------------------------------------------- |
| `p_point_id` * | uuid | Quality control point id.                                  |
| `p_note`       | text | A note.                                                    |
| `p_exclude`    | bool | Leave the point out of the limits and re-judge the series. |

### `save_lineage_target`

Add or change a lineage endpoint. Adds an endpoint for OpenLineage events (or changes one when `p_id` is set). New endpoints start switched off and send only what happens after they are switched on. The header value is set in Settings, Integrations, because it is stored sealed. Needs permission to manage integrations. Sends `lineage.endpoint.created` or `lineage.endpoint.updated`.

Scope: `lab:write`.

| Argument             | Type |                                                                      |
| -------------------- | ---- | -------------------------------------------------------------------- |
| `p_workspace_id` *   | uuid |                                                                      |
| `p_id`               | uuid |                                                                      |
| `p_name` *           | text | Name.                                                                |
| `p_endpoint_url` *   | text | Where events are posted (http or https).                             |
| `p_namespace`        | text | Groups jobs and datasets in the other service (default `sheetbase`). |
| `p_auth_header_name` | text | Header the secret is sent in (default `Authorization`).              |
| `p_enabled`          | bool | Switch sending on.                                                   |

### `delete_lineage_target`

Remove a lineage endpoint. Removes the endpoint and anything not yet sent to it. Needs permission to manage integrations.

Scope: `lab:write`.

| Argument | Type |     |
| -------- | ---- | --- |
| `p_id` * | uuid |     |

### `retry_lineage_deliveries`

Try failed lineage events again. Puts the failed events for an endpoint back in the queue and returns how many. Needs permission to manage integrations.

Scope: `lab:write`.

| Argument        | Type |     |
| --------------- | ---- | --- |
| `p_target_id` * | uuid |     |

### `set_event_stream_retention`

Set how long the event stream keeps events. Days of history `GET /api/events/stream` can replay, from 1 to 3650 (default 30). Returns the new value. Needs permission to manage integrations.

Scope: `lab:write`.

| Argument           | Type |     |
| ------------------ | ---- | --- |
| `p_workspace_id` * | uuid |     |
| `p_days` *         | int  |     |

### `set_instrument_robot`

Make an instrument a robot, or change how it is reached. Sets how worklists reach the instrument: `opentrons` (the robot is on the network) or `file` (its own software reads a folder), the worklist file it reads and the labware that file names. The folder agent on the lab computer does the rest. Needs permission to manage instruments. Returns the settings.

Scope: `lab:write`.

| Argument            | Type |                                                                                                                                                                                                                      |
| ------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `p_instrument_id` * | uuid | Instrument id.                                                                                                                                                                                                       |
| `p_driver` *        | text | `opentrons` (the robot is on the network) or `file` (its software reads a folder).                                                                                                                                   |
| `p_worklist_format` | text | The worklist file the robot reads: `opentrons` for an Opentrons robot; `csv`, `echo`, `tecan_gwl` or `hamilton` for a file robot. Leave out to use the driver’s own.                                                 |
| `p_labware`         | json | JSON labware for the worklist file: `opentronsSourceLabware`, `opentronsDestLabware`, `opentronsPipette`, `opentronsTiprack`, `opentronsMount`, `liquidClass`, `tecanSourceType`, `tecanDestType`, `echoSourceType`. |

### `clear_instrument_robot`

Stop treating an instrument as a robot. Removes the robot settings. Jobs already sent stay on record. Needs permission to manage instruments.

Scope: `lab:write`.

| Argument            | Type |                |
| ------------------- | ---- | -------------- |
| `p_instrument_id` * | uuid | Instrument id. |

### `queue_instrument_job`

Send a worklist to a robot. Queues a planned worklist for a robot. The folder agent puts it on the robot and the job waits, staged, until a person starts it. A worklist has one open job at a time. Sends `instrument.job.queued`.

Scope: `lab:write`.

| Argument            | Type |                |
| ------------------- | ---- | -------------- |
| `p_instrument_id` * | uuid | Instrument id. |
| `p_worklist_id` *   | uuid | Worklist id.   |
| `p_note`            | text | A note.        |

### `start_instrument_job`

Start a staged robot job. A person starts the job once it is on the robot and the deck is ready. Only a staged job can be started; a script or an assistant cannot start one for you, because the person starting it is at the robot. Sends `instrument.job.started`.

Scope: `lab:write`.

| Argument     | Type |               |
| ------------ | ---- | ------------- |
| `p_job_id` * | uuid | Robot job id. |

### `cancel_instrument_job`

Stop a robot job. Cancels a queued or staged job at once, and asks the agent to stop a running one. Sends `instrument.job.cancelled` when it has stopped.

Scope: `lab:write`.

| Argument     | Type |               |
| ------------ | ---- | ------------- |
| `p_job_id` * | uuid | Robot job id. |

### `set_scheduler_settings`

Set the lab’s working hours. The working day the scheduler places hands-on work in: time zone, start and end (minutes after midnight) and the days worked. Needs access to manage General settings.

Scope: `lab:write`.

| Argument                | Type  |                                                               |
| ----------------------- | ----- | ------------------------------------------------------------- |
| `p_workspace_id` *      | uuid  | Your workspace id.                                            |
| `p_timezone` *          | text  | IANA time zone, such as `Europe/London`.                      |
| `p_work_start_minute` * | int   | Minutes after midnight the working day starts (540 is 09:00). |
| `p_work_end_minute` *   | int   | Minutes after midnight the working day ends (1020 is 17:00).  |
| `p_work_days` *         | int[] | Working days as ISO weekdays: 1 is Monday, 7 is Sunday.       |

### `set_part_plan`

Say how long a part takes and what it needs. Sets a part’s hands-on time, the wait after it, and the instruments it needs (each with minutes). The list replaces the part’s earlier one. The scheduler plans from this.

Scope: `lab:write`.

| Argument               | Type |                                                                                                                        |
| ---------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------- |
| `p_part_id` *          | uuid | The part of the experiment.                                                                                            |
| `p_hands_on_minutes`   | int  | Minutes a person is at the bench for the part (0 to 1440).                                                             |
| `p_wait_after_minutes` | int  | Minutes to wait after the part before the next can start, such as an incubation (0 to 525600).                         |
| `p_needs`              | json | JSON array of the instruments the part needs: each `{ resourceId, minutes }`, where `resourceId` is the instrument id. |

### `request_schedule_proposal`

Ask for a proposed schedule for an experiment. Asks the planner to lay the experiment’s parts out on instruments and people, respecting working hours, absences, each instrument’s booking rules and the waits between parts. Returns a proposal in `requested`; read it again until it is `proposed` (or `failed`). Nothing is booked. Sends `schedule.proposed` when the plan is ready.

Scope: `lab:write`.

| Argument            | Type |                                        |
| ------------------- | ---- | -------------------------------------- |
| `p_record_id` *     | uuid | Record id.                             |
| `p_reason`          | text | Why, in a sentence.                    |
| `p_slipped_part_id` | uuid | For a re-plan: the part that ran late. |

### `accept_schedule_proposal`

Accept a proposed schedule and book it. Books each instrument slot (as the person accepting), replaces the bookings of an earlier accepted plan and moves the parts to the days planned. A slot that cannot be booked is listed in `skipped` with the reason, not hidden. Returns `{ proposalId, booked, skipped }`. Sends `schedule.accepted`.

Scope: `lab:write`.

| Argument          | Type |                       |
| ----------------- | ---- | --------------------- |
| `p_proposal_id` * | uuid | Schedule proposal id. |

### `dismiss_schedule_proposal`

Dismiss a proposed schedule. Leaves the schedule as it is. Sends `schedule.dismissed`.

Scope: `lab:write`.

| Argument          | Type |                       |
| ----------------- | ---- | --------------------- |
| `p_proposal_id` * | uuid | Schedule proposal id. |

### `slip_experiment_part`

A part ran late: re-plan the rest. Moves the part and the parts after it later by a number of days and asks for a new proposal; nothing is booked until it is accepted.

Scope: `lab:write`.

| Argument      | Type |                             |
| ------------- | ---- | --------------------------- |
| `p_part_id` * | uuid | The part of the experiment. |
| `p_days` *    | int  |                             |

### `dataset_version_rows_json`

Read a dataset version as rows. The columns and up to `p_limit` rows (default 50000) of one dataset version, as JSON: `{ versionId, datasetId, label, columns, rowCount, truncated, rows }`. Code cells read their inputs this way.

Scope: `lab:read`.

| Argument         | Type |                     |
| ---------------- | ---- | ------------------- |
| `p_version_id` * | uuid | Dataset version id. |
| `p_limit`        | int  |                     |

### `create_planned_experiment`

Create an experiment from a plan, in one step. Creates the experiment (from the protocol when the plan names one) with its parts, the plate and worklist, the sample reservations and, when the plan asks for it, a schedule proposal. All of it happens together or none of it does. Needs permission to create records and edit access to the project. Returns `{ recordId, identifier, plateRunId, worklistId, proposalId, parts, reservations }`.

Scope: `lab:write`.

| Argument         | Type |                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `p_project_id` * | uuid | Project id.                                                                                                                                                                                                                                                                                                                                                                               |
| `p_plan` *       | json | JSON plan: `{ summary, rationale, experiment: { title, templateRecordId }, parts: [{ title, dayOffset, handsOnMinutes, waitAfterMinutes, gate, needs: [{ instrumentId, minutes }] }], plate: { name, format, wells }, worklist: { format, mode, sourcePlate, transfers }, samples: [{ recordId, quantity, unit }], schedule, warnings }`. Every id is checked before anything is created. |

### `save_data_contract`

Make or change a data contract. Makes the contract on a dataset schema or a record model, or changes it. Anything left out keeps its value. A change of rules makes a new version. Needs an owner, admin or steward.

Scope: `lab:write`.

| Argument              | Type |                                                                                                                                                                                                                                                                                                                                    |
| --------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `p_dataset_schema_id` | uuid | Dataset schema (table model) id the contract sits on.                                                                                                                                                                                                                                                                              |
| `p_record_model_key`  | text | Key of the record model the contract sits on.                                                                                                                                                                                                                                                                                      |
| `p_rules`             | json | Westgard rules to judge by, from `1-3s`, `2-2s`, `R-4s`, `4-1s` and `10x`. For a data contract, a JSON array of rules: `{ id, kind, field, mode, min, max, units, threshold, maxAgeMinutes }`, where `kind` is `required`, `unique`, `range`, `units`, `completeness`, `row_count` or `freshness` and `mode` is `warn` or `block`. |
| `p_name`              | text | Name.                                                                                                                                                                                                                                                                                                                              |
| `p_description`       | text | A description.                                                                                                                                                                                                                                                                                                                     |
| `p_owner_user_id`     | text | The member who owns it.                                                                                                                                                                                                                                                                                                            |
| `p_lifecycle`         | text | `draft`, `active` or `retired`.                                                                                                                                                                                                                                                                                                    |
| `p_schedule_minutes`  | int  | Run a check every this many minutes (5 to 525600); 0 turns scheduled checks off.                                                                                                                                                                                                                                                   |

### `add_contract_rule`

Add a rule to a data contract. Adds one rule, such as a required field or a range. An id is made if you leave it out. Needs an owner, admin or steward.

Scope: `lab:write`.

| Argument          | Type |                                         |
| ----------------- | ---- | --------------------------------------- |
| `p_contract_id` * | uuid | Data contract id.                       |
| `p_rule` *        | json | JSON object: one rule, as in `p_rules`. |

### `remove_contract_rule`

Remove a rule from a data contract. Removes one rule by its id. Needs an owner, admin or steward.

Scope: `lab:write`.

| Argument          | Type |                               |
| ----------------- | ---- | ----------------------------- |
| `p_contract_id` * | uuid | Data contract id.             |
| `p_rule_id` *     | text | Id of a rule in the contract. |

### `delete_data_contract`

Delete a data contract. Deletes the contract and its run history. Needs an owner, admin or steward.

Scope: `lab:write`.

| Argument          | Type |                   |
| ----------------- | ---- | ----------------- |
| `p_contract_id` * | uuid | Data contract id. |

### `run_contract_check`

Check a data contract now. Checks the stored data against the contract and keeps the result as a run: every active dataset under a dataset schema contract (or the one named), or the records of a model. Returns the standing and the runs.

Scope: `lab:write`.

| Argument          | Type |                   |
| ----------------- | ---- | ----------------- |
| `p_contract_id` * | uuid | Data contract id. |
| `p_dataset_id`    | uuid | Dataset id.       |

### `preview_contract_rules`

See what a change of rules would find. Checks the data as it stands against rules you are thinking of, without saving them or recording a run. Needs an owner, admin or steward.

Scope: `lab:read`.

| Argument          | Type |                                                                                                                                                                                                                                                                                                                                    |
| ----------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `p_contract_id` * | uuid | Data contract id.                                                                                                                                                                                                                                                                                                                  |
| `p_rules` *       | json | Westgard rules to judge by, from `1-3s`, `2-2s`, `R-4s`, `4-1s` and `10x`. For a data contract, a JSON array of rules: `{ id, kind, field, mode, min, max, units, threshold, maxAgeMinutes }`, where `kind` is `required`, `unique`, `range`, `units`, `completeness`, `row_count` or `freshness` and `mode` is `warn` or `block`. |
| `p_dataset_id`    | uuid | Dataset id.                                                                                                                                                                                                                                                                                                                        |

### `check_dataset_contract`

Check rows against a dataset’s contract before committing them. Checks a batch of rows, in the shape of `commit_dataset_row_batch`, against the contract on the dataset’s schema and records a run. If `blocked` is true a block-mode rule found a problem and the rows should not be committed. Imports do this themselves; call it before committing from a pipeline or script.

Scope: `lab:write`.

| Argument         | Type |                                           |
| ---------------- | ---- | ----------------------------------------- |
| `p_dataset_id` * | uuid | Dataset id.                               |
| `p_rows` *       | json | JSON array of rows about to be committed. |
| `p_trigger`      | text | `import` or `pipeline`.                   |

### `check_record_contract`

Does a record meet its model’s contract?. Advisory: lists the rules a record breaks. Nothing is recorded and nothing is blocked.

Scope: `lab:read`.

| Argument        | Type |            |
| --------------- | ---- | ---------- |
| `p_record_id` * | uuid | Record id. |

### `check_record_batch_contract`

Check records about to be created against their model’s contract. Advisory: rows are `{ values: { field_name: value } }`. Nothing is recorded.

Scope: `lab:read`.

| Argument               | Type |                                               |
| ---------------------- | ---- | --------------------------------------------- |
| `p_record_model_key` * | text | Key of the record model the contract sits on. |
| `p_rows` *             | json | JSON array of rows about to be committed.     |

### `export_data_contract_odcs`

Export a data contract as ODCS. Returns the contract as an Open Data Contract Standard (v3.1) document, as JSON. Save it as YAML to keep it in git.

Scope: `lab:read`.

| Argument          | Type |                   |
| ----------------- | ---- | ----------------- |
| `p_contract_id` * | uuid | Data contract id. |

### `import_data_contract_odcs`

Import a data contract from ODCS. Reads an ODCS v3.1 document and makes or replaces the contract it describes. The target is the dataset schema or record model named by the document unless you give one. Returns the contract and a list of what was left out. Needs an owner, admin or steward.

Scope: `lab:write`.

| Argument              | Type |                                                                                             |
| --------------------- | ---- | ------------------------------------------------------------------------------------------- |
| `p_odcs` *            | json | An Open Data Contract Standard (ODCS v3.1) document as JSON. YAML parses to the same thing. |
| `p_dataset_schema_id` | uuid | Dataset schema (table model) id the contract sits on.                                       |
| `p_record_model_key`  | text | Key of the record model the contract sits on.                                               |

### `add_compound_lot`

Add a lot to a compound. Makes a record of the registry’s lot model, linked to the compound, in the compound’s project unless `p_project_id` names another. Sends `compound.lot_added` to webhooks. Returns the lot.

Scope: `lab:write`.

| Argument          | Type |                              |
| ----------------- | ---- | ---------------------------- |
| `p_compound_id` * | uuid | The compound entry.          |
| `p_project_id`    | uuid | Another project for the lot. |
| `p_title`         | text | Name of the lot.             |
| `p_custom_fields` | json | Values for the lot’s fields. |

### `list_compound_lots`

List the lots of a compound. The lots made for a compound, oldest first.

Scope: `lab:read`.

| Argument          | Type |                     |
| ----------------- | ---- | ------------------- |
| `p_compound_id` * | uuid | The compound entry. |

### `create_instrument`

Add an instrument. Adds an instrument to the workspace. Needs permission to manage instruments. Returns the instrument. Sends `instrument.created`.

Scope: `lab:write`.

| Argument            | Type |                                                                                   |
| ------------------- | ---- | --------------------------------------------------------------------------------- |
| `p_workspace_id` *  | uuid | Your workspace id.                                                                |
| `p_name` *          | text | Name.                                                                             |
| `p_instrument_type` | text | Kind of instrument: `qpcr`, `sequencer`, `spectrophotometer` or `other`.          |
| `p_model`           | text | Model name.                                                                       |
| `p_serial_number`   | text | Serial number.                                                                    |
| `p_vendor`          | text | The instrument software the file came from.                                       |
| `p_location`        | text | Where it is.                                                                      |
| `p_owner_id`        | text | The person who looks after it.                                                    |
| `p_config`          | json | JSON analysis settings: normalisation, hit rule, QC limits and curve model.       |
| `p_position`        | int  | Where it sits in the series. Omit for the end.                                    |
| `p_intake_method`   | text | How its data arrives: `filedrop` (a folder agent), `webhook`, `manual` or `none`. |

### `set_instrument_retired`

Retire an instrument, or bring it back. A retired instrument cannot be booked or used for new runs; its history stays. Needs permission to manage instruments. Sends `instrument.retired` or `instrument.reinstated`.

Scope: `lab:write`.

| Argument            | Type |                                                        |
| ------------------- | ---- | ------------------------------------------------------ |
| `p_instrument_id` * | uuid | Instrument id.                                         |
| `p_retired` *       | bool | `true` retires the instrument, `false` brings it back. |

### `record_instrument_calibration`

Record a calibration. Records that an instrument was calibrated and when the next calibration is due. Sends `instrument.calibrated`.

Scope: `lab:write`.

| Argument                | Type |                                                         |
| ----------------------- | ---- | ------------------------------------------------------- |
| `p_instrument_id` *     | uuid | Instrument id.                                          |
| `p_performed_at` *      | ts   | When the calibration was done.                          |
| `p_due_at` *            | ts   | When it is wanted by (an ISO date and time). Optional.  |
| `p_certificate_file_id` | uuid | A file already in Sheetbase that holds the certificate. |
| `p_notes`               | text | Notes.                                                  |

### `set_instrument_qualification`

Qualify a person on an instrument. Says a person may use an instrument until a date. Needs permission to manage instruments. Sends `instrument.qualification_set`.

Scope: `lab:write`.

| Argument            | Type |                                           |
| ------------------- | ---- | ----------------------------------------- |
| `p_instrument_id` * | uuid | Instrument id.                            |
| `p_user_id` *       | text | The person (their user id).               |
| `p_valid_until` *   | ts   | When the qualification ends.              |
| `p_qualified_for`   | text | What the person is qualified to do on it. |

### `revoke_instrument_qualification`

Take a person’s qualification away. Ends a person’s qualification on an instrument. Sends `instrument.qualification_revoked`.

Scope: `lab:write`.

| Argument            | Type |                             |
| ------------------- | ---- | --------------------------- |
| `p_instrument_id` * | uuid | Instrument id.              |
| `p_user_id` *       | text | The person (their user id). |

### `request_instrument_qualification`

Ask to be qualified on an instrument. Adds a request for the caller to be qualified. Sends `instrument.qualification_requested`.

Scope: `lab:write`.

| Argument            | Type |                |
| ------------------- | ---- | -------------- |
| `p_instrument_id` * | uuid | Instrument id. |
| `p_note`            | text | A note.        |

### `dismiss_instrument_qualification_request`

Dismiss a qualification request. Closes the request without qualifying the person.

Scope: `lab:write`.

| Argument         | Type |                           |
| ---------------- | ---- | ------------------------- |
| `p_request_id` * | uuid | Qualification request id. |

### `instrument_qualification_list`

List who is qualified on an instrument. Each person with a qualification: until when, whether it is current and what for.

Scope: `lab:read`.

| Argument            | Type |                |
| ------------------- | ---- | -------------- |
| `p_instrument_id` * | uuid | Instrument id. |

### `instrument_history`

The history of an instrument. Renames, moves and qualification changes of an instrument, newest first.

Scope: `lab:read`.

| Argument            | Type |                |
| ------------------- | ---- | -------------- |
| `p_instrument_id` * | uuid | Instrument id. |

### `update_instrument_connection`

Report whether an instrument is connected. Sets the connection status and when it last connected.

Scope: `lab:write`.

| Argument                | Type |                                                            |
| ----------------------- | ---- | ---------------------------------------------------------- |
| `p_workspace_id` *      | uuid | Your workspace id.                                         |
| `p_instrument_id` *     | uuid | Instrument id.                                             |
| `p_connection_status` * | text | Connection status: `connected`, `disconnected` or `error`. |
| `p_last_connected_at`   | ts   | When it last connected.                                    |

### `set_instrument_intake_method`

Choose how an instrument’s data arrives. Sets who writes the instrument’s data into Sheetbase. Needs permission to manage instruments.

Scope: `lab:write`.

| Argument            | Type |                                                                                   |
| ------------------- | ---- | --------------------------------------------------------------------------------- |
| `p_instrument_id` * | uuid | Instrument id.                                                                    |
| `p_intake_method` * | text | How its data arrives: `filedrop` (a folder agent), `webhook`, `manual` or `none`. |

### `set_instrument_gate_mode`

Choose what happens when someone books without training. Workspace setting: `off`, `warn` or `block` for people who book an instrument they are not trained or qualified on. Returns the workspace settings.

Scope: `lab:write`.

| Argument           | Type |                                          |
| ------------------ | ---- | ---------------------------------------- |
| `p_workspace_id` * | uuid | Your workspace id.                       |
| `p_mode` *         | text | `stamp` (well to well) or `cherry_pick`. |

### `create_calendar_resource`

Add something that can be booked. Adds a bookable resource, such as an instrument, a room or a bench. Needs permission to manage instruments.

Scope: `lab:write`.

| Argument           | Type |                                                   |
| ------------------ | ---- | ------------------------------------------------- |
| `p_workspace_id` * | uuid | Your workspace id.                                |
| `p_name` *         | text | Name.                                             |
| `p_code` *         | text | Short code the resource goes by.                  |
| `p_resource_type`  | text | Kind of resource, such as `instrument` or `room`. |
| `p_location`       | text | Where it is.                                      |
| `p_capacity`       | int  | How many can use it at once.                      |
| `p_timezone`       | text | IANA time zone, such as `Europe/London`.          |
| `p_project_id`     | uuid | Project id.                                       |
| `p_metadata`       | json | JSON metadata.                                    |

### `create_booking`

Book an instrument. Books a resource for a time. Checks the instrument’s booking rules, training and anything already booked, as the person the token belongs to. Sends `booking.created`.

Scope: `lab:write`.

| Argument                        | Type |                                                                                            |
| ------------------------------- | ---- | ------------------------------------------------------------------------------------------ |
| `p_workspace_id` *              | uuid | Your workspace id.                                                                         |
| `p_resource_id` *               | uuid | The instrument to book.                                                                    |
| `p_title` *                     | text | Title.                                                                                     |
| `p_starts_at` *                 | ts   | Start, as a timestamp.                                                                     |
| `p_ends_at` *                   | ts   | End, as a timestamp.                                                                       |
| `p_timezone`                    | text | IANA time zone, such as `Europe/London`.                                                   |
| `p_status`                      | text | New status.                                                                                |
| `p_all_day`                     | bool | Whole-day booking.                                                                         |
| `p_location`                    | text | Where it is.                                                                               |
| `p_color`                       | text | Colour on the calendar.                                                                    |
| `p_notes`                       | text | Notes.                                                                                     |
| `p_project_id`                  | uuid | Project id.                                                                                |
| `p_linked_experiment_record_id` | uuid | The experiment the booking is for.                                                         |
| `p_participants`                | json | JSON array of `{ userId, displayName, role }` for the people on the booking.               |
| `p_samples`                     | json | JSON array of `{ sampleRecordId, quantityValue, quantityUnit }` for the samples it is for. |

### `edit_booking`

Change a booking. Moves or edits a booking. Leave a parameter out to keep what it is. Sends `booking.updated`.

Scope: `lab:write`.

| Argument                        | Type |                                                                                            |
| ------------------------------- | ---- | ------------------------------------------------------------------------------------------ |
| `p_booking_id` *                | uuid | Booking id.                                                                                |
| `p_title`                       | text | Title.                                                                                     |
| `p_starts_at`                   | ts   | Start, as a timestamp.                                                                     |
| `p_ends_at`                     | ts   | End, as a timestamp.                                                                       |
| `p_timezone`                    | text | IANA time zone, such as `Europe/London`.                                                   |
| `p_status`                      | text | New status.                                                                                |
| `p_all_day`                     | bool | Whole-day booking.                                                                         |
| `p_location`                    | text | Where it is.                                                                               |
| `p_color`                       | text | Colour on the calendar.                                                                    |
| `p_notes`                       | text | Notes.                                                                                     |
| `p_project_id`                  | uuid | Project id.                                                                                |
| `p_linked_experiment_record_id` | uuid | The experiment the booking is for.                                                         |
| `p_participants`                | json | JSON array of `{ userId, displayName, role }` for the people on the booking.               |
| `p_samples`                     | json | JSON array of `{ sampleRecordId, quantityValue, quantityUnit }` for the samples it is for. |
| `p_expected_metadata_version`   | int  | The `metadata_version` last read; refused if it moved.                                     |

### `cancel_booking`

Cancel a booking. Cancels a booking; it stays on record. Sends `booking.cancelled`.

Scope: `lab:write`.

| Argument                      | Type |                                                        |
| ----------------------------- | ---- | ------------------------------------------------------ |
| `p_booking_id` *              | uuid | Booking id.                                            |
| `p_expected_metadata_version` | int  | The `metadata_version` last read; refused if it moved. |

### `duplicate_booking`

Copy a booking to another time. Makes a new booking like an existing one. Sends `booking.created`.

Scope: `lab:write`.

| Argument         | Type |                        |
| ---------------- | ---- | ---------------------- |
| `p_booking_id` * | uuid | Booking id.            |
| `p_starts_at` *  | ts   | Start, as a timestamp. |
| `p_ends_at` *    | ts   | End, as a timestamp.   |
| `p_title`        | text | Title.                 |

### `create_instrument_run`

Start recording a run on an instrument. Creates a run in `queued`. Sends `instrument.run.created`.

Scope: `lab:write`.

| Argument                       | Type   |                                                                                       |
| ------------------------------ | ------ | ------------------------------------------------------------------------------------- |
| `p_workspace_id` *             | uuid   | Your workspace id.                                                                    |
| `p_name` *                     | text   | Name.                                                                                 |
| `p_run_identifier` *           | text   | The run’s own number or barcode.                                                      |
| `p_instrument_id` *            | uuid   | Instrument id.                                                                        |
| `p_protocol_name`              | text   | Name of the protocol or method the run follows.                                       |
| `p_project_id`                 | uuid   | Project id.                                                                           |
| `p_plate_format`               | text   | Plate format of the run.                                                              |
| `p_operator`                   | text   | Who is running it.                                                                    |
| `p_estimated_duration_seconds` | int    | How long it should take.                                                              |
| `p_tags`                       | text[] | Tags.                                                                                 |
| `p_stages`                     | json   | JSON array of the run’s stages: `{ name, stageType, cycleCount, targetTemperature }`. |

### `start_instrument_run`

Mark a run as running. Moves a queued run to `running`.

Scope: `lab:write`.

| Argument           | Type |                                                  |
| ------------------ | ---- | ------------------------------------------------ |
| `p_workspace_id` * | uuid | Your workspace id.                               |
| `p_run_id` *       | uuid | Run id: the workflow run, or the instrument run. |

### `complete_instrument_run`

Mark a run as completed. Finishes a run. Sends `instrument.run.completed`, which can start a pipeline.

Scope: `lab:write`.

| Argument           | Type |                                                  |
| ------------------ | ---- | ------------------------------------------------ |
| `p_workspace_id` * | uuid | Your workspace id.                               |
| `p_run_id` *       | uuid | Run id: the workflow run, or the instrument run. |

### `fail_instrument_run`

Mark a run as failed. Ends a run as failed. Sends `instrument.run.failed`.

Scope: `lab:write`.

| Argument           | Type |                                                  |
| ------------------ | ---- | ------------------------------------------------ |
| `p_workspace_id` * | uuid | Your workspace id.                               |
| `p_run_id` *       | uuid | Run id: the workflow run, or the instrument run. |
| `p_error_message`  | text | What went wrong.                                 |

### `link_run_record`

Link a run to an experiment or record. Says which experiment or record a run belongs to.

Scope: `lab:write`.

| Argument               | Type |                                                  |
| ---------------------- | ---- | ------------------------------------------------ |
| `p_workspace_id` *     | uuid | Your workspace id.                               |
| `p_run_id` *           | uuid | Run id: the workflow run, or the instrument run. |
| `p_linked_record_id` * | uuid | The record to link.                              |
| `p_link_type`          | text | How it is linked, such as `experiment`.          |

### `ingest_observation`

Send a reading from a run. Adds one reading the instrument reported during a run.

Scope: `lab:write`.

| Argument               | Type |                                                  |
| ---------------------- | ---- | ------------------------------------------------ |
| `p_workspace_id` *     | uuid | Your workspace id.                               |
| `p_run_id` *           | uuid | Run id: the workflow run, or the instrument run. |
| `p_source_id` *        | text | The instrument’s own id for the reading.         |
| `p_observation_type` * | text | Kind of reading.                                 |
| `p_source_timestamp` * | ts   | When the instrument took it.                     |
| `p_payload`            | json |                                                  |
| `p_stage_id`           | uuid | Stage of the run it belongs to.                  |

### `record_run_sample_results`

Record per-sample results for a run. Attaches each sample’s result to the run.

Scope: `lab:write`.

| Argument           | Type |                                                  |
| ------------------ | ---- | ------------------------------------------------ |
| `p_workspace_id` * | uuid | Your workspace id.                               |
| `p_run_id` *       | uuid | Run id: the workflow run, or the instrument run. |
| `p_results` *      | json | JSON array of `{ item_id, received, note }`.     |

### `dataset_import_list`

List the imports into a dataset. Each import: what read it, when and what came in.

Scope: `lab:read`.

| Argument         | Type |             |
| ---------------- | ---- | ----------- |
| `p_dataset_id` * | uuid | Dataset id. |

### `preview_dataset_import_rows`

Check rows before importing them. Runs the dataset’s checks over the rows and reports problems. Writes nothing.

Scope: `lab:read`.

| Argument             | Type |                                           |
| -------------------- | ---- | ----------------------------------------- |
| `p_dataset_id` *     | uuid | Dataset id.                               |
| `p_rows` *           | json | JSON array of rows about to be committed. |
| `p_control_field_id` | uuid | Field that tells controls from samples.   |
| `p_control_pattern`  | text | Pattern that marks a control.             |

### `commit_dataset_import`

Import rows into a dataset. Commits parsed rows as a new dataset version, with a receipt. Over the API the rows arrive on a running connector run (`start_connector_run`) rather than an uploaded file, and `p_source_provenance` carries the source’s `checksum`. Regulated datasets need an approved parser version. Sends `import.committed`.

Scope: `lab:write`.

| Argument                        | Type   |                                                                                 |
| ------------------------------- | ------ | ------------------------------------------------------------------------------- |
| `p_dataset_id` *                | uuid   | Dataset id.                                                                     |
| `p_expected_dataset_revision` * | bigint | The dataset revision the rows were prepared against.                            |
| `p_rows` *                      | json   | JSON array of rows about to be committed.                                       |
| `p_idempotency_key` *           | text   | Sending the same key again returns the first result instead of importing twice. |
| `p_file_id`                     | uuid   | Import file id.                                                                 |
| `p_mapping` *                   | json   | JSON mapping from the source’s columns to fields.                               |
| `p_outcome` *                   | json   | JSON summary of how the file was read.                                          |
| `p_parser_id`                   | uuid   | Parser id.                                                                      |
| `p_parser_version_id`           | uuid   | Parser version id.                                                              |
| `p_experiment_record_id`        | uuid   | The experiment the data belongs to.                                             |
| `p_instrument_id`               | uuid   | Instrument id.                                                                  |
| `p_connector_run_id`            | uuid   | The running connector run the data came in on.                                  |
| `p_source_provenance`           | json   | JSON describing where the data came from, with its `checksum`.                  |

### `import_scientific_rows`

Import rows into a scientific table. Imports rows into a table, with a duplicate strategy.

Scope: `lab:write`.

| Argument                      | Type |                                                            |
| ----------------------------- | ---- | ---------------------------------------------------------- |
| `p_table_id` *                | uuid | Table id.                                                  |
| `p_expected_schema_version` * | int  | The table schema version you read.                         |
| `p_file` *                    | json |                                                            |
| `p_mappings` *                | json |                                                            |
| `p_rows` *                    | json | JSON array of rows about to be committed.                  |
| `p_duplicate_strategy`        | text | What to do with rows already there, such as `reject_file`. |

### `request_parser_update`

Ask for a parser to be updated for a file. Marks an import file as needing a new parser version.

Scope: `lab:write`.

| Argument      | Type |                 |
| ------------- | ---- | --------------- |
| `p_file_id` * | uuid | Import file id. |

### `create_parser_version`

Add a parser version. Adds a draft version of a parser. Approving it for regulated data is a person’s act in the app and is not offered here.

Scope: `lab:write`.

| Argument           | Type |                                                                           |
| ------------------ | ---- | ------------------------------------------------------------------------- |
| `p_workspace_id` * | uuid | Your workspace id.                                                        |
| `p_key` *          | text | A short unique key.                                                       |
| `p_name` *         | text | Name.                                                                     |
| `p_format` *       | text | Plate format, such as `96_well` or `384_well`; or a worklist file format. |
| `p_version` *      | int  | Version number.                                                           |
| `p_signature` *    | json | JSON description of the files the parser reads.                           |
| `p_mapping`        | json | JSON mapping from the source’s columns to fields.                         |
| `p_instrument_id`  | uuid | Instrument id.                                                            |

### `create_calendar_feed`

Make a calendar subscription link. Makes a link a calendar app can subscribe to: `mine` (your bookings), `instrument` (one instrument, give `p_resource_id`) or `all`. The link secret comes back once as `token` and is not kept, so store it. Up to 20 live links per person.

Scope: `lab:write`.

| Argument        | Type |                                                             |
| --------------- | ---- | ----------------------------------------------------------- |
| `p_scope` *     | text | What a calendar link covers: `mine`, `instrument` or `all`. |
| `p_resource_id` | uuid | The instrument to book.                                     |
| `p_label`       | text | What was measured.                                          |

### `revoke_calendar_feed`

Revoke a calendar subscription link. Stops one of your calendar links working. `p_feed_id` is the id of the link from `calendar_feeds`.

Scope: `lab:write`.

| Argument      | Type |                     |
| ------------- | ---- | ------------------- |
| `p_feed_id` * | uuid | Instrument feed id. |

### `create_converter_parser`

Add a parser that uses a vendor converter. Adds a parser that reads an instrument’s files with a built-in vendor converter. Needs integrations access.

Scope: `lab:write`.

| Argument           | Type |                     |
| ------------------ | ---- | ------------------- |
| `p_workspace_id` * | uuid | Workspace id.       |
| `p_key` *          | text | A short unique key. |
| `p_name` *         | text | Name.               |
| `p_format` *       | text | File format.        |
| `p_version` *      | int  | Version number.     |
| `p_vendor` *       | text | Maker.              |
| `p_instrument_id`  | uuid | Instrument id.      |

### `create_webhook_parser`

Add a parser that is an address elsewhere. Adds a parser that sends files to an outside http or https address to be read. Needs integrations access.

Scope: `lab:write`.

| Argument           | Type |                           |
| ------------------ | ---- | ------------------------- |
| `p_workspace_id` * | uuid | Workspace id.             |
| `p_key` *          | text | A short unique key.       |
| `p_name` *         | text | Name.                     |
| `p_format` *       | text | File format.              |
| `p_version` *      | int  | Version number.           |
| `p_url` *          | text | An http or https address. |
| `p_instrument_id`  | uuid | Instrument id.            |

### `save_parser_mapping`

Save how a parser maps to a model. Saves the mapping a parser uses for a target.

Scope: `lab:write`.

| Argument         | Type |                                                   |
| ---------------- | ---- | ------------------------------------------------- |
| `p_parser_id` *  | uuid | Parser id.                                        |
| `p_target_key` * | text | The model or dataset the mapping is for.          |
| `p_mapping` *    | json | JSON mapping from the source’s columns to fields. |

### `register_connector`

Add a connector. Adds a connector to bring data in from another system. `config` holds non-secret settings only.

Scope: `lab:write`.

| Argument           | Type |                                                                                |
| ------------------ | ---- | ------------------------------------------------------------------------------ |
| `p_workspace_id` * | uuid | Your workspace id.                                                             |
| `p_key` *          | text | A short unique key.                                                            |
| `p_name` *         | text | Name.                                                                          |
| `p_connector_type` | text | Kind of connector: `instrument`, `storage`, `webhook`, `database` or `custom`. |
| `p_direction`      | text | `inbound` or `outbound`.                                                       |
| `p_config`         | json | JSON analysis settings: normalisation, hit rule, QC limits and curve model.    |
| `p_parser_id`      | text | Parser id.                                                                     |

### `update_connector`

Change, pause or archive a connector. Changes a connector’s name, status (`active`, `paused`, `archived`), settings or parser. `config` replaces the old settings as a whole.

Scope: `lab:write`.

| Argument           | Type |                                                                             |
| ------------------ | ---- | --------------------------------------------------------------------------- |
| `p_workspace_id` * | uuid | Your workspace id.                                                          |
| `p_connector_id` * | uuid | Connector id.                                                               |
| `p_name`           | text | Name.                                                                       |
| `p_status`         | text | New status.                                                                 |
| `p_config`         | json | JSON analysis settings: normalisation, hit rule, QC limits and curve model. |
| `p_parser_id`      | text | Parser id.                                                                  |
| `p_clear_parser`   | bool | `true` removes the connector’s parser.                                      |

### `start_connector_run`

Start a connector run. Opens a run that data can be imported on. Finish it with `complete_connector_run` or `fail_connector_run`.

Scope: `lab:write`.

| Argument            | Type |                                               |
| ------------------- | ---- | --------------------------------------------- |
| `p_workspace_id` *  | uuid | Your workspace id.                            |
| `p_connector_id` *  | uuid | Connector id.                                 |
| `p_trigger_kind`    | text | `manual`, `scheduled` or `event`.             |
| `p_request_digest`  | text | Fingerprint of the request, for safe retries. |
| `p_retry_of_run_id` | uuid | The run this retries.                         |
| `p_selector_digest` | text | Fingerprint of what the run will read.        |

### `complete_connector_run`

Finish a connector run. Marks the run as having worked, with its result.

Scope: `lab:write`.

| Argument           | Type |                                                  |
| ------------------ | ---- | ------------------------------------------------ |
| `p_workspace_id` * | uuid | Your workspace id.                               |
| `p_run_id` *       | uuid | Run id: the workflow run, or the instrument run. |
| `p_result`         | json | JSON result.                                     |

### `fail_connector_run`

Mark a connector run as failed. Ends the run with an error.

Scope: `lab:write`.

| Argument           | Type |                                                  |
| ------------------ | ---- | ------------------------------------------------ |
| `p_workspace_id` * | uuid | Your workspace id.                               |
| `p_run_id` *       | uuid | Run id: the workflow run, or the instrument run. |
| `p_error_code` *   | text | Short error code.                                |
| `p_error_message`  | text | What went wrong.                                 |

### `append_connector_run_log`

Add a line to a connector run’s log. Appends a log line.

Scope: `lab:write`.

| Argument           | Type |                                                  |
| ------------------ | ---- | ------------------------------------------------ |
| `p_workspace_id` * | uuid | Your workspace id.                               |
| `p_run_id` *       | uuid | Run id: the workflow run, or the instrument run. |
| `p_level` *        | text | `debug`, `info`, `warn` or `error`.              |
| `p_stage` *        | text | Stage of the run.                                |
| `p_message` *      | text | Message.                                         |
| `p_detail`         | json | JSON detail.                                     |
