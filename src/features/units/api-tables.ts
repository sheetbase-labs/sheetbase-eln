import type { LabTable } from '#/lib/lab-api-surface'

/** The unit table and what people typed, readable with `lab:read`. */
export const UNITS_LAB_TABLES = {
  lab_units: {
    summary:
      'The built-in lab units. A unit converts to its kind’s base as `(value + pre_offset) * factor / divisor`; `aliases` are other spellings it is typed as. Units of the same `dimension` convert to each other.',
    columns: [
      ['symbol', 'text', 1],
      ['aliases', 'text[]', 1],
      ['dimension', 'text', 1],
      ['factor', 'num', 1],
      ['divisor', 'num', 1],
      ['pre_offset', 'num', 1],
      ['display_order', 'int', 1],
    ],
  },
  quantity_entries: {
    summary:
      'Values typed in another unit than the field stores, as typed and as stored: one row each time "2 g" went into an mg field. `object_kind` is `record`, `dataset` or `instance` (a sheet); `row_key` is the dataset row id or sheet row; `field_key` the record field name or the field id.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['object_kind', 'text', 1],
      ['object_id', 'uuid', 1],
      ['row_key', 'text', 0],
      ['field_key', 'text', 1],
      ['entered_value', 'num', 1],
      ['entered_unit', 'text', 1],
      ['stored_value', 'num', 1],
      ['stored_unit', 'text', 1],
      ['actor_user_id', 'text', 0],
      ['actor_credential_id', 'uuid', 0],
      ['created_at', 'ts', 1],
    ],
  },
} satisfies Record<string, LabTable>
