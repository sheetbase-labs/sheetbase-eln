/**
 * The demo's day-to-day lab operations: shipments in and out, analysis
 * requests, reagent orders, stocktakes and saved searches. Every row goes
 * through the same RPCs the pages call, as the person who would have done it,
 * so statuses, events and notifications are the real ones.
 */
import { sql } from 'drizzle-orm'
import type { Client } from 'pg'

import { withDesignClaims } from './claims'
import { DESIGN_SESSION_IDS } from './identities'
import type { SeedStep } from './run'

type Db = Parameters<SeedStep['run']>[0]

export const PROCESS = '00000000-0000-4000-8000-000000000300'

export const PEOPLE = {
  gareth: '00000000-0000-4000-8000-000000000310',
  priya: '00000000-0000-4000-8000-000000000311',
  mei: '00000000-0000-4000-8000-000000000312',
  tom: '00000000-0000-4000-8000-000000000313',
  sam: '00000000-0000-4000-8000-000000000314',
  anna: '00000000-0000-4000-8000-000000000315',
} as const

const DESIGN_DAY = new Date('2026-09-25T09:40:00+01:00')

/** An instant `days` before (or, negative, after) the design day. */
export const daysBefore = (days: number, hour = 0) =>
  new Date(
    DESIGN_DAY.getTime() - days * 86_400_000 + hour * 3_600_000,
  ).toISOString()

export const dayOnly = (days: number) => daysBefore(days).slice(0, 10)

/** Run `fn` in one transaction as `actor`, so a failure leaves nothing behind. */
export async function inTransaction<T>(
  db: Db,
  actor: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  // The people with a design session act as a signed-in person would; what a
  // token or pipeline may not do (a lab-wide AI preference) needs one.
  const session = Object.entries({
    [PEOPLE.gareth]: DESIGN_SESSION_IDS.gareth,
    [PEOPLE.priya]: DESIGN_SESSION_IDS.priya,
    [PEOPLE.mei]: DESIGN_SESSION_IDS.mei,
    [PEOPLE.sam]: DESIGN_SESSION_IDS.sam,
    [PEOPLE.tom]: DESIGN_SESSION_IDS.tom,
  }).find(([id]) => id === actor)?.[1]

  return withDesignClaims(
    db,
    actor,
    PROCESS,
    async (client) => {
      await client.query('begin')

      try {
        const result = await fn(client)
        await client.query('commit')

        return result
      } catch (error) {
        await client.query('rollback')
        throw error
      }
    },
    session,
  )
}

/** The value a query was sure to return, or a plain error naming what is missing. */
export function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`seed: no ${what}`)

  return value
}

/** Record ids by identifier, for the identifiers the demo names. */
export async function recordIds(
  db: Db,
  identifiers: readonly string[],
): Promise<Map<string, string>> {
  const found = await db.execute<{ id: string; identifier: string }>(sql`
    select id, identifier from api.records
     where workspace_id = ${PROCESS}
       and identifier in (${sql.join(
         identifiers.map((i) => sql`${i}`),
         sql`, `,
       )})`)

  return new Map(found.rows.map((r) => [r.identifier, r.id]))
}

// Shipments ------------------------------------------------------------------

interface ShipmentSeed {
  direction: 'inbound' | 'outbound'
  counterparty: string
  carrier: string | null
  tracking: string | null
  notes: string
  /** Days before the design day it was created. */
  daysAgo: number
  items: ReadonlyArray<{
    record?: string
    title?: string
    quantity: number
    unit: string
    note?: string
  }>
  project: string | null
  end:
    | { kind: 'draft' }
    | { kind: 'transit'; shippedAgo: number; expectedIn: number }
    | {
        kind: 'received'
        shippedAgo: number
        receivedAgo: number
        condition: string
        short?: ReadonlyArray<{ index: number; note: string }>
      }
    | { kind: 'cancelled'; reason: string }
}

const SHIPMENTS: readonly ShipmentSeed[] = [
  {
    direction: 'outbound',
    counterparty: 'AAV Vector Partners (CL-017)',
    carrier: 'World Courier',
    tracking: 'WC-88213450',
    notes:
      'Tool vector for the client’s in vivo pilot. Ship on dry ice, sign on delivery.',
    daysAgo: 4,
    project: '00000000-0000-4000-8000-000000000320',
    items: [
      {
        record: 'VL-0002',
        quantity: 4,
        unit: 'vials',
        note: '100 µL per vial, 4.6e13 vg/mL',
      },
      {
        record: 'VL-0001',
        quantity: 2,
        unit: 'vials',
        note: '100 µL per vial, 3.1e13 vg/mL',
      },
    ],
    end: { kind: 'transit', shippedAgo: 2, expectedIn: 1 },
  },
  {
    direction: 'outbound',
    counterparty: 'Capsid Analytics Ltd (CL-011)',
    carrier: 'Marken',
    tracking: 'MK-4471920',
    notes: 'Filtrates for the cross-lab capsid ELISA comparison.',
    daysAgo: 21,
    project: '00000000-0000-4000-8000-00000000032b',
    items: [
      { record: 'SMP-2240', quantity: 1, unit: 'tube' },
      { record: 'SMP-2241', quantity: 1, unit: 'tube' },
      { record: 'SMP-2242', quantity: 1, unit: 'tube' },
      { record: 'SMP-2243', quantity: 1, unit: 'tube' },
      { record: 'SMP-2244', quantity: 1, unit: 'tube' },
      { record: 'SMP-2245', quantity: 1, unit: 'tube' },
    ],
    end: {
      kind: 'received',
      shippedAgo: 19,
      receivedAgo: 17,
      condition:
        'Delivered on dry ice with the logger in range (−71 °C minimum).',
    },
  },
  {
    direction: 'outbound',
    counterparty: 'Lentigen Therapeutics (CL-009)',
    carrier: null,
    tracking: null,
    notes: 'Waiting on the client’s import licence before booking a courier.',
    daysAgo: 2,
    project: '00000000-0000-4000-8000-000000000329',
    items: [
      {
        record: 'SMP-2201',
        quantity: 2,
        unit: 'vials',
        note: 'Drug product, −150 °C',
      },
      { record: 'SMP-2236', quantity: 1, unit: 'vial' },
    ],
    end: { kind: 'draft' },
  },
  {
    direction: 'outbound',
    counterparty: 'Eurofins BioPharma Product Testing',
    carrier: 'Marken',
    tracking: 'MK-4473308',
    notes: 'Endotoxin and sterility testing for lot 2, release panel.',
    daysAgo: 12,
    project: '00000000-0000-4000-8000-000000000320',
    items: [
      {
        record: 'VL-0004',
        quantity: 3,
        unit: 'vials',
        note: '100 µL per vial',
      },
    ],
    end: { kind: 'transit', shippedAgo: 9, expectedIn: -3 },
  },
  {
    direction: 'inbound',
    counterparty: 'ATCC',
    carrier: 'FedEx Priority',
    tracking: '7743 8812 9034',
    notes: 'Working stocks for the Vero titration assay and the T-cell line.',
    daysAgo: 38,
    project: null,
    items: [
      { title: 'Vero, CCL-81', quantity: 2, unit: 'vials' },
      { title: 'Jurkat Clone E6-1, TIB-152', quantity: 2, unit: 'vials' },
    ],
    end: {
      kind: 'received',
      shippedAgo: 36,
      receivedAgo: 35,
      condition:
        'Dry ice remained at delivery. Temperature indicator in range.',
    },
  },
  {
    direction: 'inbound',
    counterparty: 'Addgene',
    carrier: 'UPS Ground',
    tracking: '1Z 84A 420 03 9918 4412',
    notes: 'Lentiviral packaging plasmids, agar stabs.',
    daysAgo: 52,
    project: '00000000-0000-4000-8000-000000000329',
    items: [
      {
        record: 'CON-0009',
        quantity: 1,
        unit: 'stab',
        note: 'psPAX2, Addgene 12260',
      },
      {
        record: 'CON-0010',
        quantity: 1,
        unit: 'stab',
        note: 'pMD2.G, Addgene 12259',
      },
    ],
    end: {
      kind: 'received',
      shippedAgo: 50,
      receivedAgo: 48,
      condition: 'Both stabs intact.',
    },
  },
  {
    direction: 'inbound',
    counterparty: 'Progen Biotechnik',
    carrier: 'DHL Express',
    tracking: 'JD01 4600 0238 5517',
    notes: 'Capsid antibodies for the ELISA method transfer.',
    daysAgo: 6,
    project: '00000000-0000-4000-8000-00000000032b',
    items: [
      { record: 'AB-0001', quantity: 2, unit: 'vials', note: '100 µg each' },
      { record: 'AB-0003', quantity: 1, unit: 'vial', note: '100 µg' },
    ],
    end: { kind: 'transit', shippedAgo: 3, expectedIn: 1 },
  },
  {
    direction: 'inbound',
    counterparty: 'Cygnus Technologies',
    carrier: 'FedEx Priority',
    tracking: '7743 8890 1176',
    notes: 'HEK293 host cell protein ELISA kits for release testing.',
    daysAgo: 26,
    project: null,
    items: [
      { title: 'HEK293 HCP ELISA kit, 3G (F650)', quantity: 2, unit: 'kits' },
      { title: 'HCP assay diluent', quantity: 1, unit: 'bottle' },
    ],
    end: {
      kind: 'received',
      shippedAgo: 25,
      receivedAgo: 23,
      condition: 'One kit box crushed in transit, plates inside intact.',
      short: [
        {
          index: 1,
          note: 'Bottle leaked in the box. Supplier sending a replacement.',
        },
      ],
    },
  },
  {
    direction: 'outbound',
    counterparty: 'T-Cell Engineering Co (CL-022)',
    carrier: null,
    tracking: null,
    notes:
      'Sample shipment no longer needed after the client moved the study in-house.',
    daysAgo: 30,
    project: '00000000-0000-4000-8000-000000000323',
    items: [{ record: 'SMP-1002', quantity: 1, unit: 'vial' }],
    end: { kind: 'cancelled', reason: 'Client moved the study in-house.' },
  },
]

export async function seedDesignShipments(db: Db): Promise<void> {
  const done = await db.execute(sql`
    select 1 from api.shipments where workspace_id = ${PROCESS} limit 1`)

  if (done.rows.length) return

  const lookup = await recordIds(
    db,
    SHIPMENTS.flatMap((s) =>
      s.items.flatMap((i) => (i.record ? [i.record] : [])),
    ),
  )

  const created: Array<{ id: string; seed: ShipmentSeed }> = []

  await inTransaction(db, PEOPLE.gareth, async (client) => {
    for (const s of SHIPMENTS) {
      const items = s.items.map((i) => {
        const id = i.record ? lookup.get(i.record) : undefined

        if (i.record && !id) throw new Error(`shipment record ${i.record}`)

        return {
          record_id: id,
          title: id ? undefined : i.title,
          quantity: i.quantity,
          unit: i.unit,
          note: i.note,
        }
      })

      const made = await client.query<{ id: string }>(
        'select id from api.create_shipment($1,$2,$3::jsonb,$4,$5,null,$6,$7)',
        [
          s.direction,
          s.counterparty,
          JSON.stringify(items),
          s.carrier,
          s.tracking,
          s.notes,
          s.project,
        ],
      )

      const id = made.rows[0]?.id

      if (!id) throw new Error(`shipment not created: ${s.counterparty}`)
      created.push({ id, seed: s })

      const end = s.end

      if (end.kind === 'transit' || end.kind === 'received') {
        await client.query(
          'select api.mark_shipment_in_transit($1,$2::date,$3,$4,$5::date)',
          [
            id,
            dayOnly(end.shippedAgo),
            s.carrier,
            s.tracking,
            dayOnly(end.kind === 'transit' ? -end.expectedIn : end.receivedAgo),
          ],
        )
      }

      if (end.kind === 'received') {
        const rows = await client.query<{ id: string; position: number }>(
          'select id, position from api.shipment_items where shipment_id = $1 order by position',
          [id],
        )

        const results = (end.short ?? []).flatMap((short) => {
          const row = rows.rows[short.index]

          return row
            ? [{ item_id: row.id, received: false, note: short.note }]
            : []
        })

        await client.query('select api.receive_shipment($1,$2::jsonb,$3)', [
          id,
          JSON.stringify(results),
          end.condition,
        ])
      }

      if (end.kind === 'cancelled') {
        await client.query('select api.cancel_shipment($1,$2)', [
          id,
          end.reason,
        ])
      }
    }
  })

  // The RPCs stamp the wall clock; the design's shipments keep their own dates.
  for (const { id, seed } of created) {
    const end = seed.end

    await db.execute(sql`
      update api.shipments
         set created_at = ${daysBefore(seed.daysAgo)}::timestamptz,
             updated_at = ${daysBefore(
               end.kind === 'received'
                 ? end.receivedAgo
                 : end.kind === 'transit'
                   ? end.shippedAgo
                   : Math.max(0, seed.daysAgo - 1),
             )}::timestamptz,
             received_at = case when status = 'received'
               then ${daysBefore(end.kind === 'received' ? end.receivedAgo : 0, 10)}::timestamptz end,
             cancelled_at = case when status = 'cancelled'
               then ${daysBefore(Math.max(0, seed.daysAgo - 1))}::timestamptz end
       where id = ${id}`)
  }
}

// Analysis requests ----------------------------------------------------------

const REQUEST_MODEL = {
  key: 'analysis_request',
  name: 'Analysis request',
  prefix: 'REQ',
  description: 'Ask the analytical team to run an assay on your samples.',
  intro:
    'Tell us which assay you need, which samples, and when you need the answer. We reply within one working day.',
  fields: [
    { field_name: 'assay', label: 'Assay', show_in_list: true },
    { field_name: 'samples', label: 'Samples', show_in_list: true },
    { field_name: 'priority', label: 'Priority', show_in_list: true },
    { field_name: 'needed_by', label: 'Needed by', logical_type: 'date' },
    { field_name: 'comments', label: 'Comments' },
  ],
} as const

const REQUESTS: ReadonlyArray<{
  by: string
  title: string
  fields: Record<string, string>
  note: string
  daysAgo: number
  decision?: {
    by: string
    decision: 'accepted' | 'declined' | 'completed'
    note: string
    daysAgo: number
  }
}> = [
  {
    by: PEOPLE.tom,
    title: 'Full/empty ratio on harvest lot HL-0934',
    fields: {
      assay: 'AUC full/empty ratio',
      samples: 'SMP-2231',
      priority: 'High',
      needed_by: dayOnly(-3),
      comments: 'Needed before we commit the lot to TFF.',
    },
    note: 'Harvest lot is on ice at the bench.',
    daysAgo: 3,
  },
  {
    by: PEOPLE.sam,
    title: 'Capsid titre by ELISA, clarification train filtrates',
    fields: {
      assay: 'Capsid ELISA',
      samples: 'SMP-2240 to SMP-2248',
      priority: 'Normal',
      needed_by: dayOnly(-7),
      comments: 'Nine filtrates, two plates please.',
    },
    note: 'Filtrates are frozen in box BX-7B.',
    daysAgo: 5,
    decision: {
      by: PEOPLE.priya,
      decision: 'accepted',
      note: 'Booked on plate reader PR-01 for Tuesday.',
      daysAgo: 4,
    },
  },
  {
    by: PEOPLE.sam,
    title: 'Genome titre by ddPCR, transfection sweep',
    fields: {
      assay: 'ddPCR genome titre',
      samples: 'SMP-2232 to SMP-2239',
      priority: 'Normal',
      needed_by: dayOnly(-10),
      comments: '',
    },
    note: 'Eight flasks, harvested together.',
    daysAgo: 9,
    decision: {
      by: PEOPLE.gareth,
      decision: 'accepted',
      note: 'Running on the QX200 Thursday.',
      daysAgo: 8,
    },
  },
  {
    by: PEOPLE.tom,
    title: 'Residual host cell DNA, TFF retentate',
    fields: {
      assay: 'qPCR residual HEK293 DNA',
      samples: 'SMP-2250',
      priority: 'Low',
      needed_by: dayOnly(-21),
      comments: 'Fine to batch with other work.',
    },
    note: 'Single retain.',
    daysAgo: 14,
    decision: {
      by: PEOPLE.priya,
      decision: 'completed',
      note: 'Result 4.2 ng/dose. Report attached to the experiment.',
      daysAgo: 6,
    },
  },
  {
    by: PEOPLE.sam,
    title: 'Mycoplasma test on the new CHO-K1 bank',
    fields: {
      assay: 'Mycoplasma PCR',
      samples: 'SMP-2227',
      priority: 'High',
      needed_by: dayOnly(-1),
      comments: 'Bank is in quarantine until this is clear.',
    },
    note: 'Bank CB-0007.',
    daysAgo: 10,
    decision: {
      by: PEOPLE.gareth,
      decision: 'completed',
      note: 'Negative. Certificate saved on the cell bank.',
      daysAgo: 7,
    },
  },
  {
    by: PEOPLE.sam,
    title: 'Endotoxin on lot 2, ahead of shipment',
    fields: {
      assay: 'LAL endotoxin',
      samples: 'VL-0004',
      priority: 'High',
      needed_by: dayOnly(1),
      comments: 'Client shipment depends on this.',
    },
    note: 'Aliquots in rack C.',
    daysAgo: 1,
  },
  {
    by: PEOPLE.gareth,
    title: 'Particle size by DLS, harvest lot HL-0934',
    fields: {
      assay: 'DLS particle size',
      samples: 'SMP-2231',
      priority: 'Normal',
      needed_by: dayOnly(-4),
      comments: 'Aggregation check before TFF.',
    },
    note: 'Single aliquot, kept on ice.',
    daysAgo: 2,
  },
  {
    by: PEOPLE.gareth,
    title: 'Residual plasmid DNA on lot 2',
    fields: {
      assay: 'qPCR residual plasmid',
      samples: 'VL-0004',
      priority: 'Normal',
      needed_by: dayOnly(-9),
      comments: 'Needed for the release panel.',
    },
    note: 'Three vials in rack C.',
    daysAgo: 7,
    decision: {
      by: PEOPLE.priya,
      decision: 'accepted',
      note: 'On the qPCR run for Thursday.',
      daysAgo: 6,
    },
  },
  {
    by: PEOPLE.tom,
    title: 'SEC-MALS on AAV8 capsid, repeat',
    fields: {
      assay: 'SEC-MALS',
      samples: 'VL-0005',
      priority: 'Low',
      needed_by: dayOnly(-30),
      comments: 'Only if the instrument has a free week.',
    },
    note: 'Repeat of a run from July.',
    daysAgo: 12,
    decision: {
      by: PEOPLE.priya,
      decision: 'declined',
      note: 'The SEC-MALS column is out for repacking until November. Use AUC instead.',
      daysAgo: 11,
    },
  },
]

export async function seedDesignRequests(db: Db): Promise<void> {
  const done = await db.execute(sql`
    select 1 from api.records
     where workspace_id = ${PROCESS} and kind = ${REQUEST_MODEL.key} limit 1`)

  if (done.rows.length) return

  const ids: string[] = []

  const hasModel = await db.execute(sql`
    select 1 from api.record_models
     where workspace_id = ${PROCESS} and key = ${REQUEST_MODEL.key} limit 1`)

  if (!hasModel.rows.length)
    await inTransaction(db, PEOPLE.gareth, async (client) => {
      await client.query(
        'select api.create_request_model($1,$2,$3,$4,$5::jsonb,$6)',
        [
          REQUEST_MODEL.key,
          REQUEST_MODEL.name,
          REQUEST_MODEL.prefix,
          REQUEST_MODEL.description,
          JSON.stringify(REQUEST_MODEL.fields),
          REQUEST_MODEL.intro,
        ],
      )
      await client.query('select api.set_request_form($1,true,$2,$3::text[])', [
        REQUEST_MODEL.key,
        REQUEST_MODEL.intro,
        [PEOPLE.priya, PEOPLE.gareth],
      ])
    })

  for (const r of REQUESTS) {
    const id = await inTransaction(db, r.by, async (client) => {
      const made = await client.query<{ id: string }>(
        'select id from api.submit_request($1,$2,$3::jsonb,null,$4)',
        [REQUEST_MODEL.key, r.title, JSON.stringify(r.fields), r.note],
      )

      return made.rows[0]?.id
    })

    if (!id) throw new Error(`request not created: ${r.title}`)
    ids.push(id)

    if (r.decision) {
      await inTransaction(db, r.decision.by, async (client) => {
        await client.query('select api.decide_request($1,$2,$3)', [
          id,
          r.decision?.decision,
          r.decision?.note,
        ])
      })
    }
  }

  for (const [i, r] of REQUESTS.entries()) {
    await db.execute(sql`
      update api.records
         set created_at = ${daysBefore(r.daysAgo)}::timestamptz
       where id = ${ids[i]}`)
    await db.execute(sql`
      update api.request_details
         set decided_at = ${daysBefore(r.decision?.daysAgo ?? 0)}::timestamptz
       where record_id = ${ids[i]} and decided_at is not null`)
  }
}

// Reagent orders -------------------------------------------------------------

export async function seedDesignReagentOrders(db: Db): Promise<void> {
  const done = await db.execute(sql`
    select 1 from api.reagent_orders where workspace_id = ${PROCESS} limit 1`)

  if (done.rows.length) return

  const m = await recordIds(db, [
    'MAT-0342',
    'MAT-0355',
    'MAT-0366',
    'MAT-0371',
    'MAT-0377',
    'MAT-0402',
  ])

  const need = (key: string) => {
    const id = m.get(key)

    if (!id) throw new Error(`material ${key}`)

    return id
  }

  const orders: Array<{ id?: string; key: string; daysAgo: number }> = []

  await inTransaction(db, PEOPLE.tom, async (client) => {
    const request = async (
      key: string,
      quantity: number,
      unit: string,
      note: string,
      daysAgo: number,
    ) => {
      const made = await client.query<{ id: string }>(
        'select id from api.request_reagent_order($1,$2,$3,$4)',
        [need(key), quantity, unit, note],
      )

      orders.push({ id: made.rows[0]?.id, key, daysAgo })

      return required(made.rows[0]?.id, 'request')
    }

    // Requested, waiting for someone to place it.
    await request(
      'MAT-0377',
      4,
      'kits',
      'Method transfer runs three plates a week from November.',
      2,
    )

    // Ordered, on its way.
    const pei = await request(
      'MAT-0371',
      500,
      'g',
      'Stock is down to one bottle.',
      11,
    )

    // Received.
    const medium = await request(
      'MAT-0366',
      20,
      'L',
      'Four flasks a week at scale.',
      40,
    )

    const pluronic = await request(
      'MAT-0355',
      1,
      'L',
      'The open bottle expired last month.',
      33,
    )

    // Cancelled.
    const tff = await request(
      'MAT-0342',
      2,
      'cassettes',
      'For the second TFF train.',
      25,
    )

    await withLead(client, async () => {
      await client.query(
        `select api.mark_reagent_ordered($1,'PO-2026-0457',$2::date,'Polysciences',null,1180,'GBP')`,
        [pei, dayOnly(-4)],
      )
      await client.query(
        `select api.mark_reagent_ordered($1,'PO-2026-0412',$2::date,'Thermo Fisher Scientific',null,2640,'GBP')`,
        [medium, dayOnly(30)],
      )
      await client.query(
        `select api.receive_reagent_order($1,'2411-B07',$2::date,20)`,
        [medium, dayOnly(-330)],
      )
      await client.query(
        `select api.mark_reagent_ordered($1,'PO-2026-0420',$2::date,'Sigma-Aldrich',null,96,'GBP')`,
        [pluronic, dayOnly(26)],
      )
      await client.query(
        `select api.receive_reagent_order($1,'SLCQ4417',$2::date,1)`,
        [pluronic, dayOnly(-540)],
      )
      await client.query('select api.cancel_reagent_order($1,$2)', [
        tff,
        'Existing cassettes passed the integrity test.',
      ])
    })
  })

  for (const o of orders) {
    await db.execute(sql`
      update api.reagent_orders
         set requested_at = ${daysBefore(o.daysAgo)}::timestamptz,
             ordered_at = case when ordered_at is not null
               then ${daysBefore(Math.max(0, o.daysAgo - 1))}::timestamptz end,
             received_at = case when received_at is not null
               then ${daysBefore(Math.max(0, o.daysAgo - 8))}::timestamptz end,
             cancelled_at = case when cancelled_at is not null
               then ${daysBefore(Math.max(0, o.daysAgo - 2))}::timestamptz end,
             updated_at = ${daysBefore(Math.max(0, o.daysAgo - 8))}::timestamptz
       where id = ${o.id}`)
  }
}

/** Ordering and receiving need the lab lead, not the person who asked. */
async function withLead(
  client: Client,
  fn: () => Promise<void>,
): Promise<void> {
  await client.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({
      sub: PEOPLE.gareth,
      workspace_id: PROCESS,
      role: 'authenticated',
    }),
  ])
  await fn()
}

// Stocktakes -----------------------------------------------------------------

export async function seedDesignStocktakes(db: Db): Promise<void> {
  const done = await db.execute(sql`
    select 1 from api.stocktakes where workspace_id = ${PROCESS} limit 1`)

  if (done.rows.length) return

  const boxes = await db.execute<{ id: string; code: string }>(sql`
    select b.id, b.code from api.storage_boxes b
     where b.workspace_id = ${PROCESS} and b.code in ('CB-1', 'BX-7B')`)

  const box = (code: string) => {
    const id = boxes.rows.find((b) => b.code === code)?.id

    if (!id) throw new Error(`storage box ${code}`)

    return id
  }

  const ids: string[] = []

  await inTransaction(db, PEOPLE.priya, async (client) => {
    // A finished count of the cell bank box: every vial found but one.
    const first = await client.query<{ id: string }>(
      `select id from api.start_stocktake('box',$1,$2)`,
      [box('CB-1'), 'Quarterly count of the working cell banks.'],
    )

    const firstId = required(first.rows[0]?.id, 'first stocktake')
    ids.push(firstId)

    const expected = await client.query<{ id: string; record_id: string }>(
      `select id, record_id from api.stocktake_items
        where stocktake_id = $1 and state = 'expected' order by identifier`,
      [firstId],
    )

    for (const item of expected.rows.slice(
      0,
      Math.max(1, expected.rows.length - 1),
    )) {
      await client.query('select api.record_stocktake_scan($1,$2,null)', [
        firstId,
        item.record_id,
      ])
    }

    const missing = await client.query<{ id: string }>(
      `select id from api.stocktake_items where stocktake_id = $1 and state = 'expected'`,
      [firstId],
    )

    for (const item of missing.rows) {
      await client.query(
        `select api.resolve_stocktake_item($1,'mark_lost',$2)`,
        [
          item.id,
          'Vial not in the box. Searched the neighbouring rack, not found.',
        ],
      )
    }

    await client.query('select api.complete_stocktake($1)', [firstId])

    // A count in progress: half of the filtrate box scanned so far.
    const second = await client.query<{ id: string }>(
      `select id from api.start_stocktake('box',$1,$2)`,
      [box('BX-7B'), 'Clear-out before the freezer defrost.'],
    )

    const secondId = required(second.rows[0]?.id, 'second stocktake')
    ids.push(secondId)

    const open = await client.query<{ record_id: string }>(
      `select record_id from api.stocktake_items
        where stocktake_id = $1 and state = 'expected' order by identifier`,
      [secondId],
    )

    for (const item of open.rows.slice(0, Math.ceil(open.rows.length / 2))) {
      await client.query('select api.record_stocktake_scan($1,$2,null)', [
        secondId,
        item.record_id,
      ])
    }
  })

  await db.execute(sql`
    update api.stocktakes
       set started_at = ${daysBefore(18)}::timestamptz,
           completed_at = case when status = 'completed' then ${daysBefore(18, 2)}::timestamptz end
     where id = ${ids[0]}`)
  await db.execute(sql`
    update api.stocktakes set started_at = ${daysBefore(1)}::timestamptz where id = ${ids[1]}`)
}

// Saved searches -------------------------------------------------------------

const SAVED_SEARCHES: ReadonlyArray<{
  by: string
  name: string
  query: string
  visibility: 'private' | 'workspace'
  args: Record<string, string | boolean>
}> = [
  {
    by: PEOPLE.gareth,
    name: 'Quarantined samples',
    query: '',
    visibility: 'workspace',
    args: { p_kind: 'sample', p_status: 'quarantined' },
  },
  {
    by: PEOPLE.gareth,
    name: 'Approved experiments, AAV9 transfer',
    query: 'AAV9',
    visibility: 'workspace',
    args: { p_kind: 'experiment', p_status: 'approved' },
  },
  {
    by: PEOPLE.gareth,
    name: 'Expired or quarantined materials',
    query: '',
    visibility: 'workspace',
    args: { p_kind: 'material', p_status: 'expired' },
  },
  {
    by: PEOPLE.gareth,
    name: 'Drafts older than a fortnight',
    query: '',
    visibility: 'private',
    args: { p_status: 'draft', p_date_to: '2026-09-11' },
  },
  {
    by: PEOPLE.priya,
    name: 'ELISA runs',
    query: 'ELISA',
    visibility: 'workspace',
    args: { p_kind: 'experiment' },
  },
  {
    by: PEOPLE.priya,
    name: 'Harvest filtrates',
    query: 'filtrate',
    visibility: 'private',
    args: { p_kind: 'sample' },
  },
  {
    by: PEOPLE.mei,
    name: 'Stability pulls',
    query: 'stability pull',
    visibility: 'workspace',
    args: { p_kind: 'experiment' },
  },
  {
    by: PEOPLE.tom,
    name: 'LVV transfection',
    query: 'transfection',
    visibility: 'private',
    args: { p_kind: 'experiment' },
  },
]

export async function seedDesignSavedSearches(db: Db): Promise<void> {
  const done = await db.execute(sql`
    select 1 from api.saved_searches where workspace_id = ${PROCESS} limit 1`)

  if (done.rows.length) return

  for (const [i, s] of SAVED_SEARCHES.entries()) {
    await db.execute(sql`
      insert into api.saved_searches
        (workspace_id, user_id, name, query, facets, visibility, arguments, created_at, updated_at)
      values (${PROCESS}, ${s.by}, ${s.name}, ${s.query}, '{}'::jsonb, ${s.visibility},
              ${JSON.stringify({ p_query: s.query, ...s.args })}::jsonb,
              ${daysBefore(60 - i * 6)}::timestamptz, ${daysBefore(30 - i * 3)}::timestamptz)`)
  }
}
