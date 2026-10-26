/**
 * The registry the Instruments boards show: eleven instruments with their
 * makes, places, owners, how each one delivers data and when each falls due for
 * calibration. The two fixture instruments (PR-01 and the Ambr 250) keep their
 * ids and move to their INS numbers; the rest are added. Calibration dates are
 * set from the design clock, not the wall clock the fixture used.
 */
import { eq } from 'drizzle-orm'

import * as schema from '../schema'
import { withDesignClaims } from './claims'
import type { SeedStep } from './run'

type Db = Parameters<SeedStep['run']>[0]

// design.ts imports this file, so its user ids are repeated here, not imported.
const DESIGN_USER_IDS = {
  gareth: '00000000-0000-4000-8000-000000000310',
  priya: '00000000-0000-4000-8000-000000000311',
  mei: '00000000-0000-4000-8000-000000000312',
  tom: '00000000-0000-4000-8000-000000000313',
} as const

const PROCESS = '00000000-0000-4000-8000-000000000300'
const PR01 = '00000000-0000-4000-8000-0000000003e0'
const AMBR = '00000000-0000-4000-8000-0000000003e1'
const INS = (n: number) =>
  `00000000-0000-4000-8000-0000000003${(0xa0 + n).toString(16)}`

const CLOCK = new Date('2026-09-25T09:40:00+01:00')
const day = (iso: string) => new Date(`${iso}T09:00:00+01:00`)

interface Spec {
  id: string
  displayId: string
  name: string
  type: 'qpcr' | 'sequencer' | 'spectrophotometer' | 'other'
  model: string
  vendor: string
  serial: string
  location: string
  owner: string
  intake: 'filedrop' | 'webhook' | 'manual' | 'none'
  connection: 'connected' | 'disconnected' | 'error'
  lastConnected: string | null
  qualifiedFor: string | null
  /** ISO date the calibration falls due; null when none is required. */
  due: string | null
}

const SPECS: Spec[] = [
  {
    id: AMBR,
    displayId: 'INS-0002',
    name: 'Ambr 250, bay 2',
    type: 'other',
    model: 'Ambr 250 HT',
    vendor: 'Sartorius',
    serial: 'AMB-118',
    location: 'Lab 2, bay 2',
    owner: DESIGN_USER_IDS.tom,
    intake: 'filedrop',
    connection: 'connected',
    lastConnected: '2026-09-25T09:12:00+01:00',
    qualifiedFor: 'GxP use',
    due: '2026-12-01',
  },
  {
    id: PR01,
    displayId: 'INS-0003',
    name: 'Plate reader PR-01',
    type: 'spectrophotometer',
    model: 'CLARIOstar Plus',
    vendor: 'BMG Labtech',
    serial: 'PR01-2291',
    location: 'Lab 1, bench 1',
    owner: DESIGN_USER_IDS.mei,
    intake: 'webhook',
    connection: 'connected',
    lastConnected: '2026-09-25T10:11:00+01:00',
    qualifiedFor: 'GxP use',
    due: '2026-11-14',
  },
  {
    id: INS(4),
    displayId: 'INS-0004',
    name: 'ÄKTA system',
    type: 'other',
    model: 'ÄKTA avant 150',
    vendor: 'Cytiva',
    serial: 'AKT-4410',
    location: 'Lab 1, bench 6',
    owner: DESIGN_USER_IDS.tom,
    intake: 'filedrop',
    connection: 'connected',
    lastConnected: '2026-09-11T10:00:00+01:00',
    qualifiedFor: 'Development use',
    due: '2026-09-18',
  },
  {
    id: INS(5),
    displayId: 'INS-0005',
    name: 'ViCell BLU',
    type: 'other',
    model: 'Vi-CELL BLU',
    vendor: 'Beckman Coulter',
    serial: 'VCB-0207',
    location: 'Lab 2, bench 3',
    owner: DESIGN_USER_IDS.priya,
    intake: 'filedrop',
    connection: 'connected',
    lastConnected: '2026-09-24T16:30:00+01:00',
    qualifiedFor: 'Development use',
    due: '2026-10-08',
  },
  {
    id: INS(6),
    displayId: 'INS-0006',
    name: 'Balance BAL-03',
    type: 'other',
    model: 'XPR205',
    vendor: 'Supplier B',
    serial: 'BAL-0305',
    location: 'Lab 2, bench 2',
    owner: DESIGN_USER_IDS.mei,
    intake: 'manual',
    connection: 'disconnected',
    lastConnected: null,
    qualifiedFor: 'GxP use',
    due: '2026-09-30',
  },
  {
    id: INS(7),
    displayId: 'INS-0007',
    name: 'Turbidimeter TB-02',
    type: 'other',
    model: 'TB-2 v3',
    vendor: 'Supplier H',
    serial: 'TB2-40917',
    location: 'Lab 2, bench 4',
    owner: DESIGN_USER_IDS.gareth,
    intake: 'filedrop',
    connection: 'error',
    lastConnected: '2026-09-25T09:58:00+01:00',
    qualifiedFor: 'GxP use',
    due: '2026-10-03',
  },
  {
    id: INS(8),
    displayId: 'INS-0008',
    name: 'pH meter PH-02',
    type: 'other',
    model: 'SevenExcellence',
    vendor: 'Mettler Toledo',
    serial: 'PH2-7731',
    location: 'Lab 2, bench 3',
    owner: DESIGN_USER_IDS.priya,
    intake: 'manual',
    connection: 'disconnected',
    lastConnected: null,
    qualifiedFor: 'Development use',
    due: '2026-09-22',
  },
  {
    id: INS(9),
    displayId: 'INS-0009',
    name: 'ddPCR reader',
    type: 'qpcr',
    model: 'QX600',
    vendor: 'Bio-Rad',
    serial: 'QX6-0182',
    location: 'Lab 3, bench 2',
    owner: DESIGN_USER_IDS.tom,
    intake: 'filedrop',
    connection: 'connected',
    lastConnected: '2026-09-24T14:00:00+01:00',
    qualifiedFor: 'Development use',
    due: '2027-01-20',
  },
  {
    id: INS(10),
    displayId: 'INS-0010',
    name: 'Osmometer OS-01',
    type: 'other',
    model: 'OsmoPRO Max',
    vendor: 'Advanced Instruments',
    serial: 'OSM-5560',
    location: 'Lab 2, bench 5',
    owner: DESIGN_USER_IDS.gareth,
    intake: 'none',
    connection: 'disconnected',
    lastConnected: null,
    qualifiedFor: null,
    due: '2027-02-12',
  },
  {
    id: INS(11),
    displayId: 'INS-0011',
    name: 'Pressure logger',
    type: 'other',
    model: 'PL-8',
    vendor: 'Supplier K',
    serial: 'PL8-2201',
    location: 'Lab 1, TFF rig',
    owner: DESIGN_USER_IDS.tom,
    intake: 'filedrop',
    connection: 'error',
    lastConnected: '2026-09-18T11:00:00+01:00',
    qualifiedFor: null,
    due: null,
  },
  {
    id: INS(12),
    displayId: 'INS-0012',
    name: 'BSC 3',
    type: 'other',
    model: 'Class II A2',
    vendor: 'Supplier B',
    serial: 'BSC-0303',
    location: 'Lab 3, suite B',
    owner: DESIGN_USER_IDS.tom,
    intake: 'manual',
    connection: 'disconnected',
    lastConnected: null,
    qualifiedFor: 'GxP use',
    due: '2027-03-02',
  },
]

export async function seedDesignInstruments(db: Db) {
  for (const [position, spec] of SPECS.entries()) {
    const values = {
      name: spec.name,
      instrumentType: spec.type,
      model: spec.model,
      vendor: spec.vendor,
      serialNumber: spec.serial,
      location: spec.location,
      ownerId: spec.owner,
      intakeMethod: spec.intake,
      connectionStatus: spec.connection,
      lastConnectedAt: spec.lastConnected ? new Date(spec.lastConnected) : null,
      qualifiedFor: spec.qualifiedFor,
      displayId: spec.displayId,
      position,
    }
    // TB-02 was first registered as "Turbidimeter 2" in another room; the
    // rename and the move below are the identity history the record page shows.
    const earlier =
      spec.id === INS(7)
        ? { name: 'Turbidimeter 2', location: 'Lab 1, bench 2' }
        : {}
    const existing = await db
      .select({ id: schema.instruments.id })
      .from(schema.instruments)
      .where(eq(schema.instruments.id, spec.id))
    if (existing.length) {
      await db
        .update(schema.instruments)
        .set(values)
        .where(eq(schema.instruments.id, spec.id))
    } else {
      await db.insert(schema.instruments).values({
        id: spec.id,
        workspaceId: PROCESS,
        createdByUserId: DESIGN_USER_IDS.gareth,
        ...values,
        ...earlier,
      })
    }

    // One calibration per instrument, due on the design's date and performed
    // six months before it; an instrument with no requirement has none.
    await db
      .delete(schema.instrumentCalibrations)
      .where(eq(schema.instrumentCalibrations.instrumentId, spec.id))
    if (spec.due) {
      const dueAt = day(spec.due)
      await db.insert(schema.instrumentCalibrations).values({
        workspaceId: PROCESS,
        instrumentId: spec.id,
        performedAt: new Date(dueAt.getTime() - 182 * 86_400_000),
        dueAt,
        performedByUserId: spec.owner,
        createdByUserId: DESIGN_USER_IDS.gareth,
      })
    }
    for (const userId of [
      DESIGN_USER_IDS.gareth,
      DESIGN_USER_IDS.priya,
      DESIGN_USER_IDS.mei,
      DESIGN_USER_IDS.tom,
    ])
      await db
        .insert(schema.instrumentQualifications)
        .values({
          workspaceId: PROCESS,
          instrumentId: spec.id,
          userId,
          validUntil: new Date(CLOCK.getTime() + 365 * 86_400_000),
          grantedByUserId: DESIGN_USER_IDS.gareth,
        })
        .onConflictDoNothing()
  }

  // The history on TB-02: the move, then the rename. Through the app's own
  // claims so the instrument trigger records who did it.
  const [tb] = await db
    .select({ name: schema.instruments.name })
    .from(schema.instruments)
    .where(eq(schema.instruments.id, INS(7)))
  if (tb?.name === 'Turbidimeter 2')
    await withDesignClaims(db, DESIGN_USER_IDS.tom, PROCESS, async (client) => {
      await client.query(
        'update api.instruments set location = $2 where id = $1',
        [INS(7), 'Lab 2, bench 4'],
      )
      await client.query('update api.instruments set name = $2 where id = $1', [
        INS(7),
        'Turbidimeter TB-02',
      ])
    })
}
