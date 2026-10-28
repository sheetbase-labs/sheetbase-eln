/**
 * Demo subtypes: a "Cell culture run" kind of Experiment with fields of its
 * own and one run recorded with it, and a "ViCell BLU" measurement table that
 * keeps every ViCell column and adds one. Idempotent: each piece is created
 * only when it is missing.
 */
import { sql } from 'drizzle-orm'

import { withDesignClaims } from './claims'
import type { SeedStep } from './run'

type Db = Parameters<SeedStep['run']>[0]

const PROCESS = '00000000-0000-4000-8000-000000000300'
const AAV9_PROJECT = '00000000-0000-4000-8000-000000000320'
const GARETH = '00000000-0000-4000-8000-000000000310'
const CULTURE_MODEL = '00000000-0000-4000-8000-000000000a01'
const CULTURE_VERSION = '00000000-0000-4000-8000-000000000a02'

function field(
  id: string,
  name: string,
  label: string,
  type: string,
  order: number,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    field_name: name,
    label,
    logical_type: type,
    nullable: true,
    display_order: order,
    lifecycle: 'active',
    default_value: null,
    validation: {},
    cardinality: 'one',
    options: [],
    ...extra,
  }
}

const CULTURE_FIELDS = [
  field(
    '00000000-0000-4000-8000-000000000a11',
    'cell_line',
    'Cell line',
    'text',
    1,
  ),
  field(
    '00000000-0000-4000-8000-000000000a12',
    'seeding_density',
    'Seeding density',
    'decimal',
    2,
    { unit: 'cells/mL' },
  ),
  field(
    '00000000-0000-4000-8000-000000000a13',
    'culture_vessel',
    'Vessel',
    'text',
    3,
  ),
  field(
    '00000000-0000-4000-8000-000000000a14',
    'harvest_day',
    'Harvest day',
    'integer',
    4,
  ),
]

export async function seedDesignSubtypes(db: Db): Promise<void> {
  await db.execute(sql`
    insert into api.record_models(id, workspace_id, key, name, description,
      identifier_prefix, parent_key, lifecycle, current_version,
      created_by_user_id, updated_by_user_id)
    values (${CULTURE_MODEL}, ${PROCESS}, 'cell_culture_run', 'Cell culture run',
      'An experiment that grows cells, with the culture conditions recorded.',
      'CCR', 'experiment', 'published', 1, ${GARETH}, ${GARETH})
    on conflict do nothing`)
  // Published versions are immutable, so a reseed keeps the one it has.
  await db.execute(sql`
    insert into api.record_model_versions(id, workspace_id, model_id, version,
      revision, lifecycle, definition, reason, published_at,
      created_by_user_id, updated_by_user_id)
    values (${CULTURE_VERSION}, ${PROCESS}, ${CULTURE_MODEL}, 1, 1, 'published',
      ${JSON.stringify({ fields: CULTURE_FIELDS, migrationScope: 'new-records-only' })}::jsonb,
      'Culture conditions for expansion runs', now(), ${GARETH}, ${GARETH})
    on conflict do nothing`)

  const existing = await db.execute(sql`
    select 1 from api.records
     where workspace_id = ${PROCESS} and model_version_id = ${CULTURE_VERSION}
     limit 1`)
  if (!existing.rows.length) {
    await withDesignClaims(db, GARETH, PROCESS, async (client) => {
      const created = await client.query<{ id: string }>(
        `select id from api.create_model_record($1,'experiment',$2,'draft','{}','{}','{}')`,
        [AAV9_PROJECT, 'HEK293 shake flask expansion'],
      )
      await client.query(
        `select api.set_model_type('records',$1,'cell_culture_run',$2)`,
        [
          created.rows[0].id,
          JSON.stringify({
            cell_line: 'HEK293-F',
            seeding_density: 300000,
            culture_vessel: '1 L shake flask',
            harvest_day: 6,
          }),
        ],
      )
    })
  }

  const vicell = await db.execute(sql`
    select id from api.dataset_schema_definitions
     where workspace_id = ${PROCESS} and key = 'vicell_viability'`)
  const parentId = (vicell.rows[0] as { id: string } | undefined)?.id
  const blu = await db.execute(sql`
    select id from api.dataset_schema_definitions
     where workspace_id = ${PROCESS} and key = 'vicell_blu'`)
  if (!parentId || blu.rows.length) return
  await withDesignClaims(db, GARETH, PROCESS, async (client) => {
    const created = await client.query<{
      result: { schema_version_id: string }
    }>(
      `select api.create_dataset_schema_subtype($1,'vicell_blu','ViCell BLU',$2) as result`,
      [parentId, 'ViCell readings from the BLU, with the mean cell diameter.'],
    )
    const versionId = created.rows[0].result.schema_version_id
    const inherited = await client.query<Record<string, unknown>>(
      `select field_id, key, label, logical_type, nullable, quantity, validation,
              category, cardinality, display_order
         from api.dataset_schema_version_fields
        where schema_version_id = $1 order by display_order`,
      [versionId],
    )
    await client.query(
      'select api.replace_dataset_schema_version_fields($1,$2::jsonb)',
      [
        versionId,
        JSON.stringify([
          ...inherited.rows,
          {
            key: 'mean_diameter',
            label: 'Mean diameter',
            logical_type: 'decimal',
            nullable: true,
            quantity: {
              kind: 'quantity',
              symbol: 'µm',
              dimension: 'µm',
              storageUnit: 'µm',
            },
            display_order: inherited.rows.length + 1,
          },
        ]),
      ],
    )
    await client.query('select api.publish_dataset_schema_version($1)', [
      versionId,
    ])
  })
}
