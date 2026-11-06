# Spend, instrument usage and scheduled reports API

Everything here goes through the same `/api/db` boundary as the rest of the
data API. PostgreSQL and RLS stay authoritative: the same permissions apply as
on the pages.

## Credentials and scopes

Two scopes cover this area:

- `facility:read` reads the supplier list and instrument rates (service
  credentials and personal tokens), and calls the spend, usage and project
  status reports. Prices and scheduled reports are rows only a person who may
  see them gets back, so they need a **personal token**.
- `facility:write` calls the writes below. Each acts as a person (an order is
  placed, a rate set), so it needs a **personal token** and the person's own
  permission.

The full request and response shapes are in
[`openapi/external-api-v0.json`](openapi/external-api-v0.json).

Money is kept per currency. There are no exchange rates, so a lab buying in
two currencies sees two totals.

## Suppliers

Suppliers are ordinary records of a model the lab ticks as its supplier list.

| Call                                       | Body                                                                 | Who               |
| ------------------------------------------ | -------------------------------------------------------------------- | ----------------- |
| `POST /api/db/rpc/set_model_supplier_list` | `{ "p_model_key": "supplier", "p_enabled": true }`                   | `schema.edit`     |
| `POST /api/db/rpc/create_supplier_model`   | `{ "p_key", "p_name", "p_prefix", "p_description", "p_fields": [] }` | `schema.edit`     |
| `GET /api/db/supplier_models`              | the model keys ticked as supplier lists                              | any member        |
| `POST /api/db/rpc/create_model_record`     | add a supplier: `p_project_id`, `p_kind` (the model key), `p_title`  | as for any record |

## Order prices

| Call                                       | Body                                                                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/db/rpc/mark_reagent_ordered`    | `{ "p_order_id", "p_order_reference", "p_expected_on", "p_supplier", "p_supplier_record_id", "p_total_price", "p_currency" }` (all but the id optional) |
| `POST /api/db/rpc/set_reagent_order_price` | `{ "p_order_id", "p_total_price": 120.5, "p_currency": "GBP" }`; a null price removes it                                                                |
| `GET /api/db/reagent_order_prices`         | `order_id`, `total_price`, `currency`                                                                                                                   |

Prices are written and read only by people who place orders (`schema.edit`).
A `p_supplier_record_id` must be a record of a model ticked as a supplier
list; its title becomes the order's supplier.

## Instrument recharge rates

| Call                                   | Body                                                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------------------- |
| `POST /api/db/rpc/set_instrument_rate` | `{ "p_instrument_id", "p_rate_per_hour": 18, "p_currency": "GBP" }`; null rate removes it |
| `GET /api/db/instrument_rates`         | `instrument_id`, `rate_per_hour`, `currency`                                              |

Setting a rate needs `instrument.manage`.

## Reports

All three take a half-open period (`p_from` included, `p_to` not) and return
rows already clipped to it. They run with the caller's rights, so people who
cannot see prices get lines with no price.

| Call                                     | Body                                                     | Rows                                                                                                                |
| ---------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `POST /api/db/rpc/report_spend_lines`    | `{ "p_workspace_id", "p_from", "p_to" }`                 | one per order placed: material, supplier, project, quantity, ordered time, price and currency                       |
| `POST /api/db/rpc/report_usage_lines`    | `{ "p_workspace_id", "p_from", "p_to" }`                 | one per booking, hours clipped to the period (cancelled bookings left out), with the instrument's rate and currency |
| `POST /api/db/rpc/report_project_status` | `{ "p_workspace_id", "p_project_id", "p_from", "p_to" }` | experiments by state per project                                                                                    |

Utilisation is booked hours over open hours: the weekdays in the period times
the hours an instrument is open on a weekday.

## Scheduled reports

| Call                                           | Body                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/db/rpc/save_scheduled_report`       | `{ "p_id": null, "p_name", "p_kind": "instrument_usage" \| "spend" \| "project_status", "p_project_id", "p_period": "previous_week" \| "previous_month" \| "last_7_days" \| "last_30_days", "p_open_hours", "p_frequency": "daily" \| "weekly" \| "monthly", "p_weekday", "p_month_day", "p_send_hour", "p_time_zone", "p_recipient_user_ids": [], "p_active": true }` |
| `POST /api/db/rpc/set_scheduled_report_active` | `{ "p_id", "p_active" }`                                                                                                                                                                                                                                                                                                                                               |
| `POST /api/db/rpc/send_scheduled_report_now`   | `{ "p_id" }`: sends within a minute                                                                                                                                                                                                                                                                                                                                    |
| `POST /api/db/rpc/delete_scheduled_report`     | `{ "p_id" }`                                                                                                                                                                                                                                                                                                                                                           |
| `GET /api/db/scheduled_reports`                | the schedules, with the last result                                                                                                                                                                                                                                                                                                                                    |

Pass an existing `p_id` to change a schedule. Recipients must be members of the
workspace, and are checked again at send time. Scheduling needs `schema.edit`,
or `instrument.manage` for the usage report.

## Events

Webhooks, live updates and pipeline triggers carry `order.priced`,
`order.price_removed`, `instrument.rate_set`, `instrument.rate_removed`,
`report.schedule.created`, `report.schedule.updated` and
`report.schedule.deleted`. See the [event catalogue](event-catalogue.md). An
event never carries a price or a rate amount: read it with the calls above.
A supplier is an ordinary record, so adding or changing one is a
`record.created` or `record.updated` event.

## From MCP, pipelines and the assistant

MCP reads: `sheetbase.spend.report` and `sheetbase.usage.report` (need
`facility:read`), and `sheetbase.canonical.read` over `supplier_models`,
`instrument_rates`, `reagent_order_prices` and `scheduled_reports`.

MCP writes are proposals that a person approves, never direct changes. They need
`agent_operations:write` and `facility:write`:

| Tool                                   | Proposal kind                | What a person approves                                        |
| -------------------------------------- | ---------------------------- | ------------------------------------------------------------- |
| `sheetbase.reagent_order.mark_ordered` | `reagent_order.mark_ordered` | A requested order is placed, with optional price and supplier |
| `sheetbase.reagent_order.set_price`    | `reagent_order.set_price`    | An order's price is set, or cleared with `totalPrice: null`   |
| `sheetbase.instrument_rate.set`        | `instrument_rate.set`        | An instrument's rate per hour is set, or cleared with `null`  |

A price or rate needs its currency. The proposal's preview shows the price on
file only to someone who may see prices. Proposing needs the same standing as
doing the work yourself (placing orders, or managing instruments).

Pipeline actions: `mark_reagent_ordered`, `set_reagent_order_price` and
`set_instrument_rate` (the same arguments as above). Each can run, or propose
so that a person decides (`"mode": "propose"`).

The assistant can propose marking an order placed and setting a rate (each a
card the person confirms), and can read spend and usage for a period.

## Bulk import from a pipeline

Any pipeline action can run once for each row of a list, which is how a price
list or a rate sheet is imported. Add `forEach` to the action and take each
value from the current row with `{ "$ref": "row.<column>" }`:

```json
{
  "name": "prices",
  "operation": "set_reagent_order_price",
  "mode": "propose",
  "forEach": { "$ref": "previous" },
  "arguments": {
    "p_order_id": { "$ref": "row.order_id" },
    "p_total_price": { "$ref": "row.price" },
    "p_currency": { "$ref": "row.currency" }
  }
}
```

- `forEach` takes the rows of the step before it (`previous`), a run parameter
  (`parameters.<name>`), the run output, or an earlier action's result. Each
  row must be an object; column names use letters, digits, `_` and `-`.
- A run imports at most 500 rows. Split a larger file into several runs.
- It is all or nothing: if one row fails, the run stops, names the row
  ("Row 12 of 80: ..."), and none of the rows is kept.
- With `"mode": "propose"` each row becomes its own proposal for a person to
  accept or reject. The action's result is the list of each row's result, so a
  later action can refer to `actions.prices.0`.
- Each row gets its own idempotency key, so a retried run does not repeat rows.
