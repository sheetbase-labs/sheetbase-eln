# Data contracts API

A data contract says what good data looks like on a table model (a dataset
schema) or a record model: values that must be there, unique values, ranges,
allowed units, how complete the data is, how many rows there should be and how
fresh it is. Sheetbase checks the contract when data is imported, when a
pipeline writes a dataset, when a record is saved (advisory), on a schedule and
when someone asks. Every check is kept.

Everything here is on the lab surface: the tables are read with
`GET /api/db/<table>` and the actions are `POST /api/db/rpc/<name>`. Tokens need
`lab:read` for reads and `lab:write` for actions. Changing a contract needs an
owner, admin or steward; anyone in the workspace can read standings. The same
calls are available over MCP (`sheetbase.lab.read`, `sheetbase.lab.act`), from
the assistant and in the Python SDK. The full argument lists are in
[lab-api.md](lab-api.md) and the OpenAPI document.

## Rules

A contract holds a list of rules. Every rule has an `id` (made if you leave it
out), a `kind`, a `mode` and the settings its kind needs.

| `kind`         | Settings                    | Asks for                                          |
| -------------- | --------------------------- | ------------------------------------------------- |
| `required`     | `field`                     | Every row has a value in the field                |
| `unique`       | `field`                     | No value appears twice in the field               |
| `range`        | `field`, `min` and/or `max` | Numbers stay between the limits                   |
| `units`        | `field`, `units`            | The field is measured in one of the listed units  |
| `completeness` | `field`, `threshold`        | At least `threshold` percent of rows have a value |
| `row_count`    | `min` and/or `max`          | The dataset holds that many rows                  |
| `freshness`    | `maxAgeMinutes`             | New data arrives at least that often              |

`field` is the field key. `mode` is `warn` (keep the data, show a warning) or
`block` (refuse an import or pipeline commit that breaks the rule). Block never
stops someone typing into a notebook; record saves only ever warn.

A contract is `draft` (kept but not enforced), `active` or `retired`. Its
standing, `last_status`, is `pass`, `warning` (only warn rules are broken) or
`fail` (a block rule is broken). Changing the rules makes a new `version`.

## Tables

- `data_contracts`: one per model. `dataset_schema_id` or `record_model_key`
  says which model, `owner_user_id` and `schedule_minutes` (null for no schedule)
  say who owns it and how often it is checked.
- `data_contract_runs`: one row per check. `trigger` is `import`, `pipeline`,
  `manual` or `schedule`; `scope` is `stored` (data already kept) or `batch`
  (rows about to be committed); `blocked` means a commit was refused; `results`
  says what each rule found, with a few example rows.
- `data_contract_dataset_status`: each dataset's latest full check under its
  schema's contract.

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/db/data_contract_dataset_status?status=neq.pass"
```

## Actions

```bash
# Start a contract and add a rule
curl -X POST "$BASE/api/db/rpc/save_data_contract" -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"p_dataset_schema_id":"<schema id>","p_lifecycle":"active"}'
curl -X POST "$BASE/api/db/rpc/add_contract_rule" -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"p_contract_id":"<contract id>","p_rule":{"kind":"range","field":"od600","min":0,"max":4,"mode":"block"}}'

# Check the stored data now
curl -X POST "$BASE/api/db/rpc/run_contract_check" -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"p_contract_id":"<contract id>"}'
```

- `save_data_contract`, `add_contract_rule`, `remove_contract_rule`,
  `delete_data_contract` change contracts.
- `run_contract_check` checks the stored data and keeps the runs.
- `preview_contract_rules` says what a set of rules would find in the data as it
  is now, without saving anything. Use it before a stricter rule.
- `check_dataset_contract` checks rows in the shape of `commit_dataset_row_batch`
  before they are committed. If `blocked` is true, do not commit. Imports and
  pipelines do this themselves.
- `check_record_contract` and `check_record_batch_contract` are the advisory
  checks for records.
- `export_data_contract_odcs` and `import_data_contract_odcs` move a contract as
  an [Open Data Contract Standard](https://bitol-io.github.io/open-data-contract-standard/)
  v3.1 document. Only what a Sheetbase rule can say is written; on import
  anything else is left out and named in `ignored`.

## Events

Webhooks, the live stream and pipeline triggers carry:

| Event                      | Sent when                                               |
| -------------------------- | ------------------------------------------------------- |
| `contract.created`         | A contract is made                                      |
| `contract.updated`         | Its rules, owner, schedule or state change              |
| `contract.deleted`         | It is deleted                                           |
| `contract.check.completed` | A check finished, with its standing                     |
| `contract.breached`        | A contract's standing got worse, to `warning` or `fail` |
| `contract.restored`        | A contract is back to `pass`                            |

## Pipelines

The **Check contract** action (`run_contract_check`) checks a contract inside a
pipeline. A pipeline that writes a dataset is also held to the contract on that
dataset's schema before it commits: if a block rule is broken nothing is
written and the run fails with `contract_blocked`. A pipeline can start on
`contract.breached`.
