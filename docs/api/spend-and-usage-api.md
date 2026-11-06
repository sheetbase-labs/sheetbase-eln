# Spend, instrument usage and scheduled reports API

Everything here goes through the same `/api/db` boundary as the rest of the
data API, with the caller's credential. PostgreSQL and RLS stay authoritative:
the same permissions apply as on the pages. These calls are outside the v0.1
public contract, like the other specialist surfaces.

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

## From pipelines and the assistant

Pipeline actions: `mark_reagent_ordered`, `set_reagent_order_price` and
`set_instrument_rate` (the same arguments as above).

The assistant can propose marking an order placed and setting a rate (each a
card the person confirms), and can read spend and usage for a period.
