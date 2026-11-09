/**
 * Demo chemical safety: hazard pictograms, statements and a safety data sheet on the
 * materials that carry them, and the protocols that use those materials. Goes
 * through the same RPCs the app does. Idempotent: skipped once a material has
 * safety information.
 */
import { sql } from 'drizzle-orm'

import { withDesignClaims } from './claims'
import { DESIGN_SESSION_IDS } from './identities'
import type { SeedStep } from './run'

type Db = Parameters<SeedStep['run']>[0]

const PROCESS = '00000000-0000-4000-8000-000000000300'
const PROJECT = '00000000-0000-4000-8000-000000000320'
const GARETH = '00000000-0000-4000-8000-000000000310'

const MATERIALS = [
  {
    identifier: 'MAT-0371',
    pictograms: ['GHS07', 'GHS09'],
    signalWord: 'warning',
    statements: ['H302', 'H315', 'H319', 'H410'],
    sheet: {
      fileObjectId: '00000000-0000-4000-8000-0000000007b1',
      name: 'SDS_PEI_transfection_reagent.pdf',
      storageKey: 'a'.padStart(32, 'b'),
    },
  },
  {
    identifier: 'MAT-0402',
    pictograms: ['GHS02'],
    signalWord: 'warning',
    statements: ['H226'],
    sheet: {
      fileObjectId: '00000000-0000-4000-8000-0000000007b2',
      name: 'SDS_AEX_resin_20pct_ethanol.pdf',
      storageKey: 'a'.padStart(32, 'c'),
    },
  },
  {
    identifier: 'MAT-0377',
    pictograms: ['GHS05'],
    signalWord: 'warning',
    statements: ['H290'],
    sheet: null,
  },
] as const

/** The protocols that use them: protocol, material. */
const PROTOCOL_USES = [
  ['PRT-006', 'MAT-0371'],
  ['PRT-006', 'MAT-0366'],
  ['PRT-022', 'MAT-0402'],
  ['PRT-012', 'MAT-0377'],
] as const

export async function seedDesignSafety(db: Db): Promise<void> {
  const present = await db.execute(sql`
    select 1 from api.material_safety where workspace_id = ${PROCESS} limit 1`)

  if (present.rows.length) return

  await withDesignClaims(
    db,
    GARETH,
    PROCESS,
    async (client) => {
      const idOf = async (identifier: string): Promise<string | null> => {
        const found = await client.query<{ id: string }>(
          `select id from api.records where identifier = $1 and workspace_id = $2`,
          [identifier, PROCESS],
        )

        return found.rows.at(0)?.id ?? null
      }

      for (const material of MATERIALS) {
        const id = await idOf(material.identifier)

        if (!id) continue
        await client.query(
          'select api.set_material_safety($1,$2::text[],$3,$4::text[],false)',
          [id, material.pictograms, material.signalWord, material.statements],
        )

        if (material.sheet) {
          // The sheet is a file in the lot's project, uploaded through the same
          // RPC the app uses; its bytes arrive with the demo file step.
          await client.query(
            'select api.create_file_upload($1,$2,$3,$4,$5,$6,$7,$8)',
            [
              PROJECT,
              material.sheet.name,
              'application/pdf',
              61_000,
              `${PROCESS}/${material.sheet.fileObjectId}/${material.sheet.storageKey}`,
              null,
              'local',
              material.sheet.fileObjectId,
            ],
          )
          await client.query('select api.set_material_sds($1,$2,false)', [
            id,
            material.sheet.fileObjectId,
          ])
        }
      }

      for (const [protocol, material] of PROTOCOL_USES) {
        const source = await idOf(protocol)
        const target = await idOf(material)

        if (!source || !target) continue
        await client.query(
          `insert into api.record_links
             (source_record_id, target_record_id, target_kind, target_identifier,
              link_type, created_by_user_id)
           values ($1,$2,'material',$3,'material',$4)
           on conflict (source_record_id, target_identifier, link_type) do nothing`,
          [source, target, material, GARETH],
        )
      }
    },
    DESIGN_SESSION_IDS.gareth,
  )
}
