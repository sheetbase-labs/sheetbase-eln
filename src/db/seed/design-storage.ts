/**
 * Demo storage and labels: a lab with a -80 °C freezer, a fridge, a liquid
 * nitrogen tank and two cold rooms, the boxes samples are filed in (the sample positions step fills them),
 * and three label templates. Idempotent: skipped once the site exists.
 */
import { sql } from 'drizzle-orm'

import { withDesignClaims } from './claims'
import type { SeedStep } from './run'

type Db = Parameters<SeedStep['run']>[0]

const PROCESS = '00000000-0000-4000-8000-000000000300'
const GARETH = '00000000-0000-4000-8000-000000000310'

type Q = (text: string, values?: unknown[]) => Promise<{ id: string }>

const TEMPLATES = [
  {
    name: 'Sample tube',
    width: 50,
    height: 25,
    barcode: 'qr',
    lot: true,
    type: false,
    condition: true,
    useBy: true,
    isDefault: true,
  },
  {
    name: 'Cryovial',
    width: 25,
    height: 13,
    barcode: 'qr',
    lot: false,
    type: false,
    condition: false,
    useBy: false,
    isDefault: false,
  },
  {
    name: 'Retain bottle',
    width: 76,
    height: 25,
    barcode: 'code128',
    lot: true,
    type: true,
    condition: true,
    useBy: false,
    isDefault: false,
  },
] as const

export async function seedDesignStorage(db: Db): Promise<void> {
  const present = await db.execute(sql`
    select 1 from api.storage_sites
     where workspace_id = ${PROCESS} and code = 'CAM-LAB' limit 1`)
  if (present.rows.length) return

  await withDesignClaims(db, GARETH, PROCESS, async (client) => {
    const one: Q = async (text, values = []) =>
      (await client.query<{ id: string }>(text, values)).rows[0]
    const site = await one(
      `insert into api.storage_sites(workspace_id, name, code)
       values ($1, 'Cambridge lab', 'CAM-LAB') returning id`,
      [PROCESS],
    )
    const room = async (name: string, code: string) =>
      (
        await one(
          `insert into api.storage_rooms(workspace_id, site_id, name, code)
           values ($1, $2, $3, $4) returning id`,
          [PROCESS, site.id, name, code],
        )
      ).id
    const unit = async (
      roomId: string,
      name: string,
      code: string,
      type: string,
      lo: number | null,
      hi: number | null,
    ) =>
      (
        await one(
          `insert into api.storage_units(workspace_id, room_id, name, code, unit_type,
             temperature_min_c, temperature_max_c)
           values ($1, $2, $3, $4, $5, $6, $7) returning id`,
          [PROCESS, roomId, name, code, type, lo, hi],
        )
      ).id
    const shelf = async (unitId: string, name: string, position: number) =>
      (
        await one(
          `insert into api.storage_shelves(workspace_id, unit_id, name, position)
           values ($1, $2, $3, $4) returning id`,
          [PROCESS, unitId, name, position],
        )
      ).id
    const rack = async (shelfId: string, name: string, position: number) =>
      (
        await one(
          `insert into api.storage_racks(workspace_id, shelf_id, name, position)
           values ($1, $2, $3, $4) returning id`,
          [PROCESS, shelfId, name, position],
        )
      ).id
    const box = async (
      rackId: string,
      name: string,
      code: string,
      rows: number,
      cols: number,
    ) =>
      (
        await one(
          `select id from api.create_storage_box($1, $2, $3, $4, $5, $6)`,
          [PROCESS, rackId, name, code, rows, cols],
        )
      ).id

    const lab2 = await room('Lab 2', 'LAB-2')
    const cr1 = await room('Cold room CR-1', 'CR-1')
    const cr2 = await room('Cold room CR-2', 'CR-2')

    const f1 = await unit(lab2, 'Freezer F-1', 'F-1', 'freezer', -85, -75)
    const f1Shelf = await shelf(f1, 'Shelf 1', 1)
    const f1Rack = await rack(f1Shelf, 'Rack A', 1)
    await box(f1Rack, 'Box 3', 'BX-3', 9, 9)
    await box(f1Rack, 'Box 4', 'BX-4', 9, 9)
    const f1Shelf2 = await shelf(f1, 'Shelf 2', 2)
    const f1RackB = await rack(f1Shelf2, 'Rack B', 1)
    await box(f1RackB, 'Box 7', 'BX-7', 9, 9)

    const f2 = await unit(lab2, 'Fridge F-2', 'F-2', 'fridge', 2, 8)
    const f2Shelf = await shelf(f2, 'Shelf 3', 3)
    const f2Rack = await rack(f2Shelf, 'Rack 1', 1)
    await box(f2Rack, 'Box 14', 'BX-14', 9, 9)
    await box(f2Rack, 'Box 15', 'BX-15', 9, 9)

    const ln2 = await unit(lab2, 'LN2 tank 1', 'LN2-1', 'cryo', -196, -150)
    const ln2Shelf = await shelf(ln2, 'Rack A', 1)
    const ln2Rack = await rack(ln2Shelf, 'Canister 1', 1)
    await box(ln2Rack, 'Cell bank box 1', 'CB-1', 10, 10)

    const f3 = await unit(lab2, 'Freezer F-3', 'F-3', 'freezer', -25, -15)
    const f3Rack = await rack(await shelf(f3, 'Shelf 1', 1), 'Rack A', 1)
    await box(f3Rack, 'Box 7', 'BX-7B', 9, 9)

    const f4 = await unit(lab2, 'Freezer F-4', 'F-4', 'freezer', -85, -75)
    const f4Rack = await rack(await shelf(f4, 'Shelf 1', 1), 'Rack A', 1)
    await box(f4Rack, 'Box 2', 'BX-2', 9, 9)

    const ln2b = await unit(lab2, 'LN2 tank 2', 'LN2-2', 'cryo', -196, -150)
    const ln2bRack = await rack(await shelf(ln2b, 'Rack C', 1), 'Canister 1', 1)
    await box(ln2bRack, 'Cell bank box 2', 'CB-2', 10, 10)

    const cr1Unit = await unit(cr1, 'Shelving CR-1', 'SH-CR1', 'cabinet', 2, 8)
    await rack(await shelf(cr1Unit, 'Shelf 3', 3), 'Open shelf', 1)
    const cr2Unit = await unit(cr2, 'Shelving CR-2', 'SH-CR2', 'cabinet', 2, 8)
    await rack(await shelf(cr2Unit, 'Shelf 1', 1), 'Open shelf', 1)

    for (const t of TEMPLATES) {
      await client.query(
        `select api.save_label_template($1, null, $2, 'sample', $3, $4, $5,
           $6, $7, $8, $9, $10)`,
        [
          PROCESS,
          t.name,
          t.width,
          t.height,
          t.barcode,
          t.lot,
          t.type,
          t.condition,
          t.useBy,
          t.isDefault,
        ],
      )
    }
  })
}
