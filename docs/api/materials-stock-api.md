# Material stock API

The stock ledger of each material and the counts the Materials page shows are
reachable with a token, over MCP and in pipelines (see [lab-api.md](lab-api.md)
for scopes and how tokens work).

## Tables

| Table               | What it holds                                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `reagent_movements` | Each receipt, use, quarantine or restore of a material: the change (`quantity_delta`), the quantity after it, lot, expiry, who and why. |

## Actions

### `record_reagent_movement`

Receive or use stock on a material record, or quarantine it and restore it. Pass the record's
`metadata_version` so a stale write is refused. The material record changes, so
webhooks see it as `record.updated`. Also a pipeline action.

Scope: `lab:write`.

| Argument                        | Type    |                                                  |
| ------------------------------- | ------- | ------------------------------------------------ |
| `p_reagent_record_id` *         | uuid    | The material record.                             |
| `p_expected_metadata_version` * | int     | The record's `metadata_version`.                 |
| `p_operation` *                 | text    | `receive`, `consume`, `quarantine` or `restore`. |
| `p_quantity_delta`              | numeric | The change in quantity.                          |
| `p_reason`                      | text    | Why, shown on the ledger.                        |

### `reagent_attention_summary`

How many materials are in stock, low, expiring soon or expired. Personal tokens
only: a service token has no workspace membership, so it gets zeros.

Scope: `lab:read`.

| Argument                | Type |                                             |
| ----------------------- | ---- | ------------------------------------------- |
| `p_expiry_warning_days` | int  | Days before expiry that count as soon (30). |
