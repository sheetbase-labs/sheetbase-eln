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
  switches on in Settings > AI. It is off by default, because these actions
  happen straight away rather than waiting for approval.

## Tables

| Table                          | What it holds                                                                                                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reagent_orders`               | A reagent order: requested from a material that is running low, placed with the supplier, then received as a new lot. `status` is requested, ordered, received or cancelled. |
| `recurring_schedules`          | A recurring experiment or booking. `kind` is `booking` or `experiment`; `status` is active, paused or ended.                                                                 |
| `recurring_occurrences`        | One planned run of a recurring schedule and what became of it (`outcome`).                                                                                                   |
| `instrument_service_log`       | A service, repair, calibration or other visit logged against an instrument.                                                                                                  |
| `step_timers`                  | A timer started on a protocol step. Personal tokens only: you see your own timers.                                                                                           |
| `material_safety`              | Chemical safety information for a material: hazard pictograms, signal word, hazard statements and the safety data sheet file.                                                |
| `material_ingredients`         | What went into a prepared solution: one row per ingredient lot, with quantity and unit.                                                                                      |
| `stocktakes`                   | A stocktake of a freezer, shelf or box. `status` is in_progress, completed or cancelled.                                                                                     |
| `stocktake_items`              | One item expected in or found during a stocktake, with where it should be, where it was found and how a mismatch was resolved.                                               |
| `instrument_feeds`             | A live measurement series on an instrument (temperature, pressure and so on), with its alert limits and last value.                                                          |
| `instrument_readings`          | One reading in an instrument feed. Large; filter by `feed_id` and `taken_at`, or use `list_instrument_feed_series` for charts.                                               |
| `sample_workflows`             | A sample workflow: the stages a sample moves through. `status` is draft, active or archived.                                                                                 |
| `sample_workflow_stages`       | A stage in a sample workflow, with its turnaround time, required fields and actions.                                                                                         |
| `sample_workflow_transitions`  | Which stage a sample may move to from another stage.                                                                                                                         |
| `sample_workflow_runs`         | A sample's journey through a workflow: its current stage, when it entered and when it is due.                                                                                |
| `sample_workflow_events`       | The history of moves a sample made through a workflow.                                                                                                                       |
| `request_forms`                | Which record models accept requests, their intro text and who handles them.                                                                                                  |
| `shipments`                    | A sample shipment in or out. `direction` is inbound or outbound; `status` is draft, in_transit, received or cancelled.                                                       |
| `shipment_items`               | An item on a shipment, with whether it arrived and in what condition.                                                                                                        |
| `instrument_booking_rules`     | Booking limits on an instrument: longest booking and how far ahead people may book.                                                                                          |
| `instrument_required_training` | Training protocols a person must hold before booking an instrument.                                                                                                          |
| `field_spec_limits`            | Specification and alert limits for a numeric field on a record kind.                                                                                                         |
| `model_incident_logs`          | Record models that are used as incident logs.                                                                                                                                |
| `legal_holds`                  | A legal hold keeping records from deletion or archiving until it is released.                                                                                                |
| `legal_hold_records`           | A record placed on a legal hold.                                                                                                                                             |
| `retention_rules`              | How many months each kind of record is kept before it comes up for archiving.                                                                                                |
| `request_details`              | What was asked and how it was decided, for each request record.                                                                                                              |
| `record_spec_results`          | Each record's value for a field with result limits, and whether it is within spec, in the alert band or out. Personal tokens only.                                           |
| `my_work_items`                | What is waiting on the person: reviews, tasks, assigned records and so on. Personal tokens only.                                                                             |
| `inbox_work_items`             | The person's Inbox items with tab and type. Personal tokens only.                                                                                                            |
| `project_follows`              | Projects a person follows. Personal tokens only: you see your own follows.                                                                                                   |
| `plate_runs`                   | Plate runs: one plate read on an instrument, with its layout, readout, analysis settings and the last analysis (normalised values, Z-prime, hits and curves).                |
| `plate_worklists`              | Liquid handler worklists: the transfers from a source plate to a destination plate, and what the robot log said was moved.                                                   |

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

| Argument       | Type |                                                        |
| -------------- | ---- | ------------------------------------------------------ |
| `p_block_id` * | uuid | The protocol step block (a `procedure_step` block).    |
| `p_done`       | bool | true to finish the step (default), false to reopen it. |
| `p_note`       | text | A note.                                                |

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

List the steps of an experiment with their status. Every protocol step in order. `status` comes from the evidence on the notebook: `done` when ticked, `in_progress` when it has a note, a result or a running timer of yours, otherwise `not_started`. `is_current` marks the first step that is not done.

Scope: `lab:read`.

| Argument        | Type |            |
| --------------- | ---- | ---------- |
| `p_record_id` * | uuid | Record id. |

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

Add a registry entry. Creates an entry of a registry model (such as a cell line or construct). Refuses a likely duplicate unless `p_allow_duplicate` is true.

Scope: `lab:write`.

| Argument            | Type |                                             |
| ------------------- | ---- | ------------------------------------------- |
| `p_project_id` *    | uuid | Project id.                                 |
| `p_kind` *          | text | Kind, as listed in the app.                 |
| `p_title` *         | text | Title.                                      |
| `p_custom_fields`   | json | Field values, keyed by field name.          |
| `p_allow_duplicate` | bool | Create it even when a similar entry exists. |

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
