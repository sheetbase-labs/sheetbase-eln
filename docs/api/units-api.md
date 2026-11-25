# Units API

A number field can have a unit: a measurement table column stored in `mg`, a
record field stored in `µL`. A value typed in another unit of the same kind is
converted to the field's unit as it is written. `2 g` in an `mg` field is
stored as `2000`. What was typed is kept as well. A unit of another kind
(`2 mL` in an `mg` field) is refused.

This works the same in the app, the API, MCP, the assistant, imports and
pipelines, because the database does the conversion (see
[lab-api.md](lab-api.md) for scopes and how tokens work). It sends no webhook
events of its own. The write it belongs to sends its usual event, and a dataset
row's change event says what was typed (see below).

## Writing a value in another unit

Wherever a number goes into a field with a unit, it may be written three ways:

| Value                          | Means                                  |
| ------------------------------ | -------------------------------------- |
| `2000`                         | A number, already in the field's unit. |
| `"2 g"`, `"1.5 ×10⁶ cells/mL"` | Typed text: a number and a unit.       |
| `{ "value": 2, "unit": "g" }`  | The same, as an object.                |

This applies to:

- dataset rows: `validate_dataset_row_batch`, `commit_dataset_row_batch` and
  `commit_dataset_row_batch_atomic` (see [datasets-api.md](datasets-api.md));
- a sheet's own columns: `mutate_sheet_instance_local_state`;
- record fields (`custom_fields`): creating a record, `update_record_custom_fields`
  and any other write of the record's fields.

The field's unit is its quantity's `storageUnit`, or for an older record field
its `unit.symbol`. A number field with no unit takes plain numbers only.

A unit of another kind is refused:

- by `validate_dataset_row_batch` and `commit_dataset_row_batch` with the cell
  code `wrong_unit` (nothing is written);
- by a sheet cell with `invalid local cell: wrong_unit`;
- by a record write with the error `SB071`, such as
  `Sample mass: 2 mL can't be stored in mg`.

A whole-number field still needs a whole number after converting: `1 µg` in an
integer `mg` field is refused.

## Units

The built-in table is `lab_units` (read it with `lab:read`):

| Kind                | Units                                                    |
| ------------------- | -------------------------------------------------------- |
| mass                | kg, g, mg, µg, ng, pg                                    |
| volume              | L, mL, µL, nL                                            |
| amount              | mol, mmol, µmol, nmol, pmol                              |
| molar concentration | M, mM, µM, nM, pM                                        |
| mass concentration  | g/mL, g/L, mg/mL, ng/µL, mg/L, µg/mL, µg/L, ng/mL, pg/mL |
| time                | ms, s, min, h, day, week                                 |
| temperature         | K, °C, °F                                                |
| length              | m, cm, mm, µm, nm                                        |
| pressure            | Pa, kPa, MPa, bar, mbar, psi, atm, mmHg, Torr            |
| flow rate           | L/min, mL/min, µL/min, L/h, mL/h                         |
| cell concentration  | cells/mL, cells/µL                                       |

Each row lists other spellings in `aliases` (`ug`, `uL`, `ml`, `degC` …). The
Greek letter μ is read as the micro sign µ.

A scale in front of a unit multiplies it: `×10⁶ cells/mL`, `x10^6 cells/mL`
and `10^6 cells/mL` are a million cells per mL. Two units that differ only in
scale convert even when the table doesn't list them, so `×10¹¹ cp/mL` and
`×10¹⁰ cp/mL` convert. Any other unit converts only to itself.

Converted values are rounded to 12 significant figures (of the larger of the
value and a temperature's offset), so `-40 °C` is `-40 °F`.

## What was typed: `quantity_entries`

Each value converted from another unit adds a row to `quantity_entries` (read
with `lab:read`; you see the rows of what you may see):

| Column                                 | Notes                                                    |
| -------------------------------------- | -------------------------------------------------------- |
| `object_kind`                          | `record`, `dataset` or `instance` (a sheet).             |
| `object_id`                            | The record, dataset or sheet.                            |
| `row_key`                              | The dataset row id or the sheet row; null for a record.  |
| `field_key`                            | The record field name, or the dataset or sheet field id. |
| `entered_value`, `entered_unit`        | What was typed: `2`, `g`.                                |
| `stored_value`, `stored_unit`          | What was stored: `2000`, `mg`.                           |
| `actor_user_id`, `actor_credential_id` | Who wrote it.                                            |
| `created_at`                           | When.                                                    |

A dataset row's `dataset.updated` change event also carries it: each changed
field in `changes` has `entered: { "value": 2, "unit": "g" }` beside its `from`
and `to` when it was converted.

## `convert_quantity`

`POST /api/db/rpc/convert_quantity`, `sheetbase.lab.act` over MCP, a pipeline
action, or the assistant's `sheetbase.units.convert` tool. Needs `lab:read` and
changes nothing.

| Argument         | Type    | Notes                                 |
| ---------------- | ------- | ------------------------------------- |
| `p_value` \*     | numeric | The number to convert.                |
| `p_from_unit` \* | text    | Its unit, such as `g`.                |
| `p_to_unit` \*   | text    | The unit to convert to, such as `mg`. |

```json
{
  "value": 2000,
  "unit": "mg",
  "from": { "value": 2, "unit": "g" },
  "dimension": "mass"
}
```

Units of different kinds are refused with `SB071`. In a pipeline, use it to
bring two columns to one unit before comparing or joining them: a value is only
ever converted within its own kind.
