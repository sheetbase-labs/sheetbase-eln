/**
 * The rest of a working lab, so no page opens empty: a fuller materials shelf
 * with the suppliers behind it and a prepared reagent made from others,
 * instrument service history and rates, a calendar with bookings and standing
 * schedules, pending invitations and access requests, and the assistant's
 * saved preferences and past conversations.
 */
import { randomUUID } from 'node:crypto'

import { sql } from 'drizzle-orm'

import {
  PEOPLE,
  PROCESS,
  daysBefore,
  dayOnly,
  inTransaction,
  required,
  recordIds,
} from './design-operations'
import type { SeedStep } from './run'

type Db = Parameters<SeedStep['run']>[0]

const AAV9 = '00000000-0000-4000-8000-000000000320'

// Suppliers and materials ------------------------------------------------------

const SUPPLIER_MODEL = {
  key: 'supplier',
  name: 'Supplier',
  prefix: 'SUP',
  description: 'The companies the lab buys from, with how to reach them.',
  fields: [
    { field_name: 'category', label: 'Supplies', show_in_list: true },
    { field_name: 'contact', label: 'Account manager', show_in_list: true },
    { field_name: 'email', label: 'Email' },
    { field_name: 'account_number', label: 'Account number' },
    {
      field_name: 'lead_time_days',
      label: 'Usual lead time (days)',
      logical_type: 'decimal',
    },
    { field_name: 'website', label: 'Website' },
  ],
} as const

const SUPPLIERS: ReadonlyArray<Record<string, string | number>> = [
  {
    title: 'Thermo Fisher Scientific',
    category: 'Media, serum, consumables',
    contact: 'Hannah Whitcombe',
    email: 'hannah.whitcombe@example.com',
    account_number: 'TFS-204118',
    lead_time_days: 3,
    website: 'thermofisher.com',
  },
  {
    title: 'Sigma-Aldrich (Merck)',
    category: 'Chemicals, buffers, standards',
    contact: 'Daniel Okafor',
    email: 'daniel.okafor@example.com',
    account_number: 'SA-77310',
    lead_time_days: 2,
    website: 'sigmaaldrich.com',
  },
  {
    title: 'Polysciences',
    category: 'PEI and transfection reagents',
    contact: 'Rachel Brandt',
    email: 'rachel.brandt@example.com',
    account_number: 'PS-5519',
    lead_time_days: 7,
    website: 'polysciences.com',
  },
  {
    title: 'Cytiva',
    category: 'Chromatography resins, columns, TFF',
    contact: 'Marcus Lindqvist',
    email: 'marcus.lindqvist@example.com',
    account_number: 'CY-90234',
    lead_time_days: 10,
    website: 'cytiva.com',
  },
  {
    title: 'Bio-Rad',
    category: 'ddPCR reagents and consumables',
    contact: 'Priyanka Rao',
    email: 'priyanka.rao@example.com',
    account_number: 'BR-33907',
    lead_time_days: 5,
    website: 'bio-rad.com',
  },
  {
    title: 'Progen Biotechnik',
    category: 'Capsid antibodies and ELISA kits',
    contact: 'Jonas Keller',
    email: 'jonas.keller@example.com',
    account_number: 'PG-0412',
    lead_time_days: 6,
    website: 'progen.com',
  },
  {
    title: 'Cygnus Technologies',
    category: 'Host cell protein assays',
    contact: 'Elena Marchetti',
    email: 'elena.marchetti@example.com',
    account_number: 'CT-1180',
    lead_time_days: 8,
    website: 'cygnustechnologies.com',
  },
  {
    title: 'Sartorius',
    category: 'Filters, bioreactors, Ambr consumables',
    contact: 'Tomas Novak',
    email: 'tomas.novak@example.com',
    account_number: 'SAR-61442',
    lead_time_days: 9,
    website: 'sartorius.com',
  },
  {
    title: 'Miltenyi Biotec',
    category: 'T-cell activation and flow reagents',
    contact: 'Sofia Berg',
    email: 'sofia.berg@example.com',
    account_number: 'MB-2207',
    lead_time_days: 4,
    website: 'miltenyibiotec.com',
  },
  {
    title: 'Qiagen',
    category: 'Plasmid preparation kits',
    contact: 'Oliver Grant',
    email: 'oliver.grant@example.com',
    account_number: 'QG-48821',
    lead_time_days: 3,
    website: 'qiagen.com',
  },
]

interface MaterialSeed {
  title: string
  supplier: string
  lot: string
  quantity: number
  unit: string
  expiry: string
  storage: string
  status: 'available' | 'expired' | 'quarantined'
  project: string | null
}

const MATERIALS: readonly MaterialSeed[] = [
  {
    title: 'DMEM, high glucose',
    supplier: 'Thermo Fisher Scientific',
    lot: '2418755',
    quantity: 18,
    unit: 'bottles',
    expiry: '2027-03-31',
    storage: 'Cold room, shelf 2',
    status: 'available',
    project: null,
  },
  {
    title: 'Fetal bovine serum, qualified',
    supplier: 'Thermo Fisher Scientific',
    lot: '2397611',
    quantity: 4,
    unit: 'bottles',
    expiry: '2027-09-30',
    storage: 'F-3 (−20 °C)',
    status: 'available',
    project: null,
  },
  {
    title: 'L-glutamine, 200 mM',
    supplier: 'Thermo Fisher Scientific',
    lot: '2362240',
    quantity: 6,
    unit: 'bottles',
    expiry: '2027-01-15',
    storage: 'F-3 (−20 °C)',
    status: 'available',
    project: null,
  },
  {
    title: 'Penicillin–streptomycin, 100×',
    supplier: 'Thermo Fisher Scientific',
    lot: '2410388',
    quantity: 2,
    unit: 'bottles',
    expiry: '2026-12-20',
    storage: 'F-3 (−20 °C)',
    status: 'available',
    project: null,
  },
  {
    title: 'FreeStyle 293 expression medium',
    supplier: 'Thermo Fisher Scientific',
    lot: '2431907',
    quantity: 24,
    unit: 'L',
    expiry: '2027-02-28',
    storage: 'Cold room, shelf 1',
    status: 'available',
    project: '00000000-0000-4000-8000-000000000324',
  },
  {
    title: 'Opti-MEM reduced-serum medium',
    supplier: 'Thermo Fisher Scientific',
    lot: '2405512',
    quantity: 9,
    unit: 'bottles',
    expiry: '2027-01-31',
    storage: 'Cold room, shelf 2',
    status: 'available',
    project: '00000000-0000-4000-8000-000000000329',
  },
  {
    title: 'Sf-900 III serum-free medium',
    supplier: 'Thermo Fisher Scientific',
    lot: '2379048',
    quantity: 3,
    unit: 'L',
    expiry: '2026-11-30',
    storage: 'Cold room, shelf 1',
    status: 'available',
    project: null,
  },
  {
    title: 'TexMACS medium',
    supplier: 'Miltenyi Biotec',
    lot: '5240318',
    quantity: 12,
    unit: 'bottles',
    expiry: '2027-04-30',
    storage: 'Cold room, shelf 3',
    status: 'available',
    project: '00000000-0000-4000-8000-000000000323',
  },
  {
    title: 'Human AB serum',
    supplier: 'Sigma-Aldrich (Merck)',
    lot: 'SLCR7731',
    quantity: 5,
    unit: 'bottles',
    expiry: '2027-06-30',
    storage: 'F-3 (−20 °C)',
    status: 'available',
    project: '00000000-0000-4000-8000-000000000323',
  },
  {
    title: 'Recombinant human IL-2, 1 MIU',
    supplier: 'Miltenyi Biotec',
    lot: '5238801',
    quantity: 8,
    unit: 'vials',
    expiry: '2027-05-15',
    storage: 'F-1 (−80 °C)',
    status: 'available',
    project: '00000000-0000-4000-8000-000000000323',
  },
  {
    title: 'Anti-CD3/CD28 activation beads',
    supplier: 'Thermo Fisher Scientific',
    lot: '2399207',
    quantity: 1,
    unit: 'vial',
    expiry: '2026-12-10',
    storage: 'Cold room, shelf 3',
    status: 'available',
    project: '00000000-0000-4000-8000-000000000323',
  },
  {
    title: 'Benzonase nuclease, 250 U/µL',
    supplier: 'Sigma-Aldrich (Merck)',
    lot: 'SLCT2284',
    quantity: 5,
    unit: 'mL',
    expiry: '2027-08-31',
    storage: 'F-1 (−20 °C)',
    status: 'available',
    project: AAV9,
  },
  {
    title: 'Tris-HCl, 1 M, pH 8.0',
    supplier: 'Sigma-Aldrich (Merck)',
    lot: 'SLCS1190',
    quantity: 4,
    unit: 'L',
    expiry: '2027-07-31',
    storage: 'Chemical store, shelf B',
    status: 'available',
    project: AAV9,
  },
  {
    title: 'Sodium chloride, 5 M',
    supplier: 'Sigma-Aldrich (Merck)',
    lot: 'SLCS0042',
    quantity: 10,
    unit: 'L',
    expiry: '2028-01-31',
    storage: 'Chemical store, shelf B',
    status: 'available',
    project: AAV9,
  },
  {
    title: 'Polysorbate 20, 10 %',
    supplier: 'Sigma-Aldrich (Merck)',
    lot: 'SLCR9915',
    quantity: 500,
    unit: 'mL',
    expiry: '2026-10-31',
    storage: 'Chemical store, shelf C',
    status: 'expired',
    project: AAV9,
  },
  {
    title: 'Iodixanol, 60 % (OptiPrep)',
    supplier: 'Sigma-Aldrich (Merck)',
    lot: 'SLCT4410',
    quantity: 6,
    unit: 'bottles',
    expiry: '2027-10-31',
    storage: 'Chemical store, shelf C',
    status: 'available',
    project: '00000000-0000-4000-8000-000000000328',
  },
  {
    title: 'POROS CaptureSelect AAV9 resin',
    supplier: 'Cytiva',
    lot: 'C2-0731',
    quantity: 100,
    unit: 'mL',
    expiry: '2027-03-31',
    storage: 'Cold room, shelf 4',
    status: 'available',
    project: '00000000-0000-4000-8000-00000000032e',
  },
  {
    title: 'Sartobind Q nano, 1 mL',
    supplier: 'Sartorius',
    lot: '2024-0412',
    quantity: 4,
    unit: 'units',
    expiry: '2028-04-30',
    storage: 'Consumables cabinet',
    status: 'available',
    project: AAV9,
  },
  {
    title: 'Sterile filter, 0.22 µm PES, 500 mL',
    supplier: 'Sartorius',
    lot: '2025-1118',
    quantity: 40,
    unit: 'units',
    expiry: '2029-02-28',
    storage: 'Consumables cabinet',
    status: 'available',
    project: null,
  },
  {
    title: 'Amicon Ultra-15, 100 kDa',
    supplier: 'Sigma-Aldrich (Merck)',
    lot: 'R4KA02117',
    quantity: 60,
    unit: 'units',
    expiry: '2028-06-30',
    storage: 'Consumables cabinet',
    status: 'available',
    project: AAV9,
  },
  {
    title: 'ddPCR supermix for probes',
    supplier: 'Bio-Rad',
    lot: '64211887',
    quantity: 5,
    unit: 'mL',
    expiry: '2027-02-28',
    storage: 'F-1 (−20 °C)',
    status: 'available',
    project: AAV9,
  },
  {
    title: 'ddPCR droplet generation oil',
    supplier: 'Bio-Rad',
    lot: '64198430',
    quantity: 2,
    unit: 'bottles',
    expiry: '2027-04-30',
    storage: 'Consumables cabinet',
    status: 'available',
    project: AAV9,
  },
  {
    title: 'AAV9 titration ELISA kit',
    supplier: 'Progen Biotechnik',
    lot: 'PRATV9-2602',
    quantity: 3,
    unit: 'kits',
    expiry: '2027-01-31',
    storage: 'F-2 (2–8 °C)',
    status: 'available',
    project: '00000000-0000-4000-8000-00000000032b',
  },
  {
    title: 'HEK293 HCP ELISA kit, 3G',
    supplier: 'Cygnus Technologies',
    lot: 'F650-2306',
    quantity: 2,
    unit: 'kits',
    expiry: '2027-03-31',
    storage: 'F-2 (2–8 °C)',
    status: 'available',
    project: '00000000-0000-4000-8000-00000000032b',
  },
  {
    title: 'Mycoplasma PCR detection kit',
    supplier: 'Sigma-Aldrich (Merck)',
    lot: 'SLCS5527',
    quantity: 1,
    unit: 'kit',
    expiry: '2026-11-15',
    storage: 'F-1 (−20 °C)',
    status: 'quarantined',
    project: '00000000-0000-4000-8000-000000000324',
  },
  {
    title: 'EndoFree Plasmid Maxi kit',
    supplier: 'Qiagen',
    lot: '175019804',
    quantity: 6,
    unit: 'kits',
    expiry: '2027-05-31',
    storage: 'Consumables cabinet',
    status: 'available',
    project: '00000000-0000-4000-8000-00000000032d',
  },
]

const INGREDIENT_LOOKUP = [
  'PEI transfection reagent',
  'Opti-MEM reduced-serum medium',
  'Sodium chloride, 5 M',
] as const

const NEW_INVITES: ReadonlyArray<[string, string, number]> = [
  ['jamie.okonkwo@example.com', 'member', 7],
  ['sasha.petrov@example.com', 'reviewer', 3],
  ['lab.manager@example.com', 'admin', 14],
]

export async function seedDesignSuppliersAndMaterials(db: Db): Promise<void> {
  const done = await db.execute(sql`
    select 1 from api.record_models
     where workspace_id = ${PROCESS} and key = 'supplier' limit 1`)

  if (done.rows.length) return

  const supplierIds: string[] = []
  const materialIds: string[] = []

  await inTransaction(db, PEOPLE.gareth, async (client) => {
    await client.query(
      'select api.create_supplier_model($1,$2,$3,$4,$5::jsonb)',
      [
        SUPPLIER_MODEL.key,
        SUPPLIER_MODEL.name,
        SUPPLIER_MODEL.prefix,
        SUPPLIER_MODEL.description,
        JSON.stringify(SUPPLIER_MODEL.fields),
      ],
    )

    for (const { title, ...fields } of SUPPLIERS) {
      const made = await client.query<{ id: string }>(
        `select id from api.create_model_record($1,'supplier',$2,'draft','{}'::text[],'{}'::jsonb,$3::jsonb)`,
        [AAV9, title, JSON.stringify(fields)],
      )

      supplierIds.push(required(made.rows[0]?.id, 'row'))
    }

    for (const m of MATERIALS) {
      const made = await client.query<{ id: string }>(
        `select id from api.create_model_record($1,'material',$2,$3,'{}'::text[],$4::jsonb,'{}'::jsonb)`,
        [
          AAV9,
          m.title,
          m.status,
          JSON.stringify({
            lot: m.lot,
            unit: m.unit,
            expiry: m.expiry,
            storage: m.storage,
            quantity: m.quantity,
            supplier: m.supplier,
          }),
        ],
      )

      materialIds.push(required(made.rows[0]?.id, 'row'))
    }
  })

  await db.execute(sql`alter table api.records disable trigger set_updated_at`)

  try {
    for (const [i, id] of supplierIds.entries()) {
      await db.execute(sql`
        update api.records
           set project_id = null, status = 'active',
               created_at = ${daysBefore(300 - i * 9)}::timestamptz,
               updated_at = ${daysBefore(20 + i)}::timestamptz
         where id = ${id}`)
    }

    for (const [i, m] of MATERIALS.entries()) {
      await db.execute(sql`
        update api.records
           set project_id = ${m.project}::uuid,
               created_at = ${daysBefore(200 - i * 6)}::timestamptz,
               updated_at = ${daysBefore(14 + (i % 9))}::timestamptz
         where id = ${materialIds[i]}`)
    }
  } finally {
    await db.execute(sql`alter table api.records enable trigger set_updated_at`)
  }

  // A prepared reagent made from stock on the shelf.
  const stock = await db.execute<{
    id: string
    identifier: string
    title: string
    lot: string | null
  }>(sql`
    select id, identifier, title, properties->>'lot' as lot
      from api.records
     where workspace_id = ${PROCESS} and kind = 'material'
       and title in (${sql.join(
         INGREDIENT_LOOKUP.map((t) => sql`${t}`),
         sql`, `,
       )})`)

  const pick = (title: string) => {
    const row = stock.rows.find((r) => r.title === title)

    if (!row) throw new Error(`ingredient ${title}`)

    return row
  }

  const product = await inTransaction(db, PEOPLE.tom, async (client) => {
    const made = await client.query<{ id: string }>(
      `select id from api.create_model_record($1,'material','Transfection mix, 1 L batch','available','{}'::text[],$2::jsonb,'{}'::jsonb)`,
      [
        AAV9,
        JSON.stringify({
          lot: 'TM-0925-A',
          unit: 'mL',
          expiry: dayOnly(-14),
          storage: 'Cold room, shelf 2',
          quantity: 1000,
          supplier: 'Prepared in-house',
        }),
      ],
    )

    return required(made.rows[0]?.id, 'row')
  })

  const ingredients: Array<[string, number, string]> = [
    ['PEI transfection reagent', 3, 'mL'],
    ['Opti-MEM reduced-serum medium', 100, 'mL'],
    ['Sodium chloride, 5 M', 30, 'mL'],
  ]

  for (const [i, [title, qty, unit]] of ingredients.entries()) {
    const row = pick(title)

    await db.execute(sql`
      insert into api.material_ingredients
        (workspace_id, product_record_id, ingredient_record_id, quantity, unit,
         ingredient_identifier, ingredient_title, ingredient_lot, position, created_by)
      values (${PROCESS}, ${product}, ${row.id}, ${qty}, ${unit}, ${row.identifier},
              ${row.title}, ${row.lot}, ${i}, ${PEOPLE.tom})`)
  }
}

// Instruments, calendar --------------------------------------------------------

export async function seedDesignInstrumentExtras(db: Db): Promise<void> {
  const done = await db.execute(sql`
    select 1 from api.instrument_service_log where workspace_id = ${PROCESS} limit 1`)

  if (done.rows.length) return

  const inst = await db.execute<{ id: string; name: string }>(sql`
    select id, name from api.instruments where workspace_id = ${PROCESS}`)

  const byName = (name: string) => {
    const id = inst.rows.find((r) => r.name === name)?.id

    if (!id) throw new Error(`instrument ${name}`)

    return id
  }

  await inTransaction(db, PEOPLE.gareth, async (client) => {
    const log = (
      name: string,
      kind: string,
      daysAgo: number,
      summary: string,
      details: string,
      by: string,
    ) =>
      client.query(
        'select api.log_instrument_service($1,$2,$3::date,$4,$5,$6)',
        [byName(name), kind, dayOnly(daysAgo), summary, details, by],
      )

    await log(
      'Plate reader PR-01',
      'service',
      210,
      'Annual preventive service',
      'Lamp and filters replaced, wavelength accuracy checked against the manufacturer’s standards.',
      'BMG Labtech field engineer',
    )
    await log(
      'Plate reader PR-01',
      'repair',
      33,
      'Lamp warm-up fault',
      'Intermittent lamp error on cold start. Power board reseated and firmware updated to 4.12.',
      'BMG Labtech field engineer',
    )
    await log(
      'Ambr 250, bay 2',
      'service',
      150,
      'Six-monthly service',
      'Pump tubing and pH probes replaced. Gas mass-flow controllers calibrated.',
      'Sartorius service',
    )
    await log(
      'Ambr 250, bay 2',
      'inspection',
      22,
      'Pressure test after relocation',
      'Passed leak test on all 24 vessel positions.',
      'Facilities',
    )
    await log(
      'ÄKTA system',
      'service',
      120,
      'Pump seals and UV cell service',
      'Seals replaced on both pumps. UV flow cell cleaned and verified.',
      'Cytiva service',
    )
    await log(
      'ddPCR reader',
      'service',
      95,
      'Annual service',
      'Optics alignment and droplet reader calibration.',
      'Bio-Rad service',
    )
    await log(
      'Balance BAL-03',
      'inspection',
      40,
      'Annual weights check',
      'Calibrated against traceable weights, within tolerance on all ranges.',
      'Mettler service',
    )
    await log(
      'BSC 3',
      'inspection',
      70,
      'Annual cabinet certification',
      'Airflow, HEPA integrity and containment tests passed.',
      'Certified by the facilities contractor',
    )
    await log(
      'ViCell BLU',
      'other',
      12,
      'Moved to the cell culture suite',
      'Relocated with the cell counting workstation. Verification counts within 3% of the previous bench.',
      'Gareth P.',
    )

    await client.query('select api.set_instrument_rate($1,$2,$3)', [
      byName('Ambr 250, bay 2'),
      38,
      'GBP',
    ])
    await client.query('select api.set_instrument_rate($1,$2,$3)', [
      byName('ÄKTA system'),
      24,
      'GBP',
    ])
    await client.query('select api.set_instrument_rate($1,$2,$3)', [
      byName('ddPCR reader'),
      31,
      'GBP',
    ])
    await client.query('select api.set_instrument_rate($1,$2,$3)', [
      byName('Plate reader PR-01'),
      12,
      'GBP',
    ])
    await client.query(
      'select api.set_instrument_booking_rules($1,$2::uuid[],$3,$4)',
      [byName('Ambr 250, bay 2'), [], 480, 30],
    )
    await client.query(
      'select api.set_instrument_booking_rules($1,$2::uuid[],$3,$4)',
      [byName('ÄKTA system'), [], 600, 21],
    )
    await client.query(
      'select api.set_instrument_booking_rules($1,$2::uuid[],$3,$4)',
      [byName('BSC 3'), [], 240, 14],
    )
  })
}

interface BookingSeed {
  by: string
  resource: string
  title: string
  /** Days from the design day: negative is earlier. */
  day: number
  start: number
  hours: number
  status: 'confirmed' | 'tentative'
  with?: readonly string[]
  samples?: readonly string[]
  experiment?: string
  project?: string
}

const BOOKINGS: readonly BookingSeed[] = [
  {
    by: PEOPLE.tom,
    resource: 'INS-0003',
    title: 'Capsid ELISA plates 1 and 2',
    day: -9,
    start: 9,
    hours: 3,
    status: 'confirmed',
    samples: ['SMP-2240', 'SMP-2241'],
    project: AAV9,
  },
  {
    by: PEOPLE.priya,
    resource: 'INS-0009',
    title: 'ddPCR genome titre, filtrate series',
    day: -8,
    start: 10,
    hours: 4,
    status: 'confirmed',
    samples: ['SMP-2243', 'SMP-2244', 'SMP-2245'],
    project: AAV9,
  },
  {
    by: PEOPLE.priya,
    resource: 'INS-0002',
    title: 'Ambr 250 run AMB-25-118, seeding',
    day: -7,
    start: 8,
    hours: 2,
    status: 'confirmed',
    experiment: 'EXP-0140',
    with: [PEOPLE.tom],
  },
  {
    by: PEOPLE.mei,
    resource: 'INS-0005',
    title: 'ViCell counts, transfection sweep',
    day: -6,
    start: 14,
    hours: 1,
    status: 'confirmed',
    project: AAV9,
  },
  {
    by: PEOPLE.tom,
    resource: 'INS-0004',
    title: 'AEX screen, resin comparison',
    day: -5,
    start: 9,
    hours: 6,
    status: 'confirmed',
    experiment: 'EXP-0129',
  },
  {
    by: PEOPLE.gareth,
    resource: 'INS-0012',
    title: 'Safety cabinet: HEK293 expansion',
    day: -4,
    start: 9,
    hours: 4,
    status: 'confirmed',
  },
  {
    by: PEOPLE.sam,
    resource: 'INS-0003',
    title: 'ELISA plate 3, stability pulls',
    day: -3,
    start: 13,
    hours: 3,
    status: 'confirmed',
    project: AAV9,
  },
  {
    by: PEOPLE.priya,
    resource: 'INS-0002',
    title: 'Ambr 250 run AMB-25-118, day 6 sampling',
    day: -1,
    start: 9,
    hours: 2,
    status: 'confirmed',
    experiment: 'EXP-0140',
  },
  {
    by: PEOPLE.tom,
    resource: 'INS-0009',
    title: 'ddPCR, harvest timing samples',
    day: 0,
    start: 13,
    hours: 4,
    status: 'confirmed',
    samples: ['SMP-2231'],
    project: AAV9,
  },
  {
    by: PEOPLE.gareth,
    resource: 'INS-0004',
    title: 'ÄKTA: AAV9 capture step',
    day: 1,
    start: 9,
    hours: 5,
    status: 'confirmed',
    with: [PEOPLE.tom],
    project: AAV9,
  },
  {
    by: PEOPLE.mei,
    resource: 'INS-0003',
    title: 'ELISA plate 5, method transfer',
    day: 2,
    start: 9,
    hours: 3,
    status: 'tentative',
    project: '00000000-0000-4000-8000-00000000032b',
  },
  {
    by: PEOPLE.priya,
    resource: 'INS-0002',
    title: 'Ambr 250 perfusion run, 14 days',
    day: 3,
    start: 8,
    hours: 3,
    status: 'tentative',
    project: '00000000-0000-4000-8000-000000000322',
  },
  {
    by: PEOPLE.sam,
    resource: 'INS-0005',
    title: 'ViCell counts, feed optimisation',
    day: 3,
    start: 11,
    hours: 1,
    status: 'confirmed',
  },
  {
    by: PEOPLE.tom,
    resource: 'INS-0012',
    title: 'Safety cabinet: CAR-T activation',
    day: 4,
    start: 9,
    hours: 4,
    status: 'confirmed',
    project: '00000000-0000-4000-8000-000000000323',
  },
  {
    by: PEOPLE.gareth,
    resource: 'INS-0009',
    title: 'ddPCR, lot 2 release titre',
    day: 5,
    start: 9,
    hours: 4,
    status: 'confirmed',
    samples: ['SMP-2226'],
  },
  {
    by: PEOPLE.mei,
    resource: 'INS-0004',
    title: 'ÄKTA: SEC polishing, trial',
    day: 7,
    start: 10,
    hours: 4,
    status: 'tentative',
  },
  {
    by: PEOPLE.priya,
    resource: 'INS-0003',
    title: 'ELISA plate 6, release panel',
    day: 8,
    start: 9,
    hours: 3,
    status: 'confirmed',
    project: AAV9,
  },
  {
    by: PEOPLE.tom,
    resource: 'INS-0002',
    title: 'Ambr 250 pilot comparison, seeding',
    day: 10,
    start: 8,
    hours: 2,
    status: 'tentative',
    project: '00000000-0000-4000-8000-000000000322',
  },
]

export async function seedDesignCalendar(db: Db): Promise<void> {
  const done = await db.execute(sql`
    select 1 from api.calendar_bookings
     where workspace_id = ${PROCESS} and title = ${BOOKINGS[0]?.title} limit 1`)

  if (done.rows.length) return

  const resources = await db.execute<{ id: string; code: string }>(sql`
    select id, code from api.calendar_resources where workspace_id = ${PROCESS}`)

  const refs = await recordIds(
    db,
    BOOKINGS.flatMap((b) => [
      ...(b.samples ?? []),
      ...(b.experiment ? [b.experiment] : []),
    ]),
  )

  const base = new Date('2026-09-25T00:00:00+01:00').getTime()

  const at = (day: number, hour: number) =>
    new Date(base + day * 86_400_000 + hour * 3_600_000).toISOString()

  const resourceByCode = new Map(resources.rows.map((r) => [r.code, r.id]))

  for (const b of BOOKINGS) {
    const resource = resourceByCode.get(b.resource)

    if (!resource) throw new Error(`resource ${b.resource}`)

    // Written directly: booking an instrument checks today's calibration and
    // qualification, and the design's instruments are dated to the design day,
    // so the rule would refuse a day the design treats as perfectly normal.
    const experiment = b.experiment ? refs.get(b.experiment) : null

    const created = await db.execute<{ id: string }>(sql`
      insert into api.calendar_bookings
        (workspace_id, resource_id, project_id, title, status, starts_at, ends_at, timezone,
         linked_experiment_record_id, linked_experiment_identifier, linked_experiment_title,
         created_by_user_id, updated_by_user_id)
      values (${PROCESS}, ${resource}, ${b.project ?? null}, ${b.title}, ${b.status},
              ${at(b.day, b.start)}::timestamptz, ${at(b.day, b.start + b.hours)}::timestamptz,
              'Europe/London', ${experiment ?? null},
              ${b.experiment ?? null},
              (select title from api.records where id = ${experiment ?? null}),
              ${b.by}, ${b.by})
      returning id`)

    const booking = created.rows[0]?.id

    await db.execute(sql`
      insert into api.calendar_booking_participants (workspace_id, booking_id, user_id, role)
      values (${PROCESS}, ${booking}, ${b.by}, 'owner')`)

    for (const person of b.with ?? []) {
      await db.execute(sql`
        insert into api.calendar_booking_participants (workspace_id, booking_id, user_id, role)
        values (${PROCESS}, ${booking}, ${person}, 'participant')`)
    }

    for (const sample of b.samples ?? []) {
      await db.execute(sql`
        insert into api.calendar_booking_samples
          (workspace_id, booking_id, sample_record_id, sample_identifier, sample_title)
        select ${PROCESS}, ${booking}, r.id, r.identifier, r.title
          from api.records r where r.id = ${refs.get(sample) ?? null}`)
    }
  }
}

// People and the assistant -----------------------------------------------------

const PREFERENCES: ReadonlyArray<[string, string, string, string | null]> = [
  [
    PEOPLE.gareth,
    'user',
    'Write titres in vg/mL in scientific notation, for example 4.6e13 vg/mL.',
    'units',
  ],
  [
    PEOPLE.gareth,
    'user',
    'Keep summaries to three sentences unless I ask for more.',
    'style',
  ],
  [
    PEOPLE.gareth,
    'workspace',
    'AAV process work uses HEK293 suspension clone SF-3 unless a plan says otherwise.',
    'process',
  ],
  [
    PEOPLE.priya,
    'user',
    'When comparing runs, show the table first and the commentary after it.',
    'style',
  ],
]

const CHATS: ReadonlyArray<[string, string, string, string]> = [
  [
    PEOPLE.gareth,
    'Which vector lots are below release limits?',
    'Which vector lots are below release limits?',
    'One lot is below limit: AAV9-Y445F-CMV-EGFP lot 1 has 41% full capsids against the 60% minimum and 4.8 EU/mL endotoxin, close to the 5 EU/mL limit. It is quarantined. AAV9-LP1-hFIX-Padua lot 1 and AAV8 lot 1 are in the alert band for full capsids (64% and 59%).',
  ],
  [
    PEOPLE.gareth,
    'Summarise the downstream work at 2 L',
    'Summarise the downstream work at 2 L',
    'The 2 L downstream summary report is approved. TFF kept flux above target through a 10× concentration, and the AEX capacity supports a 4 L batch on the scaled column. The repeat-2 series (feed titre, TFF and AEX) is in progress.',
  ],
  [
    PEOPLE.priya,
    'What is waiting on me?',
    'What is waiting on me?',
    'Two analysis requests are waiting for a decision (the full/empty ratio on HL-0934 and the endotoxin test on lot 2), and the Ambr 250 perfusion report is in review. You are on leave from next week, and Gareth is covering reviews.',
  ],
]

const ACCESS_REQUESTS: ReadonlyArray<[string, string, string]> = [
  [
    PEOPLE.sam,
    '00000000-0000-4000-8000-000000000324',
    'I am running the viability panel next week and need to edit the notebook.',
  ],
  [
    PEOPLE.tom,
    '00000000-0000-4000-8000-000000000323',
    'Picking up the T-cell medium runs from Mei while she is on the ELISA transfer.',
  ],
]

const ALIASES: ReadonlyArray<[string, string]> = [
  ['CB-0010', 'HEK293 MCB'],
  ['CB-0010', 'Master cell bank, HEK293'],
  ['MAT-0371', 'PEI MAX'],
  ['MAT-0366', 'Expression medium'],
  ['SMP-2231', 'HL-0934'],
]

export async function seedDesignPeopleAndAssistant(db: Db): Promise<void> {
  const done = await db.execute(sql`
    select 1 from api.workspace_invitations where workspace_id = ${PROCESS} limit 1`)

  if (done.rows.length) return

  await inTransaction(db, PEOPLE.gareth, async (client) => {
    const invited: string[] = []

    for (const [email, role, days] of NEW_INVITES) {
      const made = await client.query<{ id: string }>(
        `select (api.create_invitation($1,$2,$3,$4,null,$5::jsonb)->>'id') as id`,
        [PROCESS, email, role, days, JSON.stringify([])],
      )

      invited.push(required(made.rows[0]?.id, 'row'))
    }

    // One was sent in error and taken back.
    await client.query('select api.revoke_invitation($1,$2)', [
      PROCESS,
      invited[2],
    ])
  })

  for (const [person, scope, body, topic] of PREFERENCES) {
    await inTransaction(db, person, async (client) => {
      await client.query('select api.save_ai_preference($1,$2,$3)', [
        body,
        scope,
        topic,
      ])
    })
  }

  for (const [person, title, question, answer] of CHATS) {
    await inTransaction(db, person, async (client) => {
      await client.query(
        'select api.save_assistant_conversation($1::jsonb,$2,$3)',
        [
          JSON.stringify([
            {
              id: randomUUID(),
              role: 'user',
              parts: [{ type: 'text', text: question }],
            },
            {
              id: randomUUID(),
              role: 'assistant',
              parts: [{ type: 'text', text: answer }],
            },
          ]),
          randomUUID(),
          title,
        ],
      )
    })
  }

  for (const [person, project, reason] of ACCESS_REQUESTS) {
    await inTransaction(db, person, async (client) => {
      await client.query('select api.request_project_edit_access($1,$2)', [
        project,
        reason,
      ])
    })
  }

  const aliasRecords = await recordIds(
    db,
    ALIASES.map(([r]) => r),
  )

  await inTransaction(db, PEOPLE.gareth, async (client) => {
    for (const [identifier, alias] of ALIASES) {
      await client.query('select api.add_record_alias($1,$2)', [
        aliasRecords.get(identifier),
        alias,
      ])
    }

    for (const type of ['shipment_incoming', 'reagent_order', 'qc_violation']) {
      await client.query(
        'select api.save_notification_preference($1,true,true,false,false)',
        [type],
      )
    }
  })
}
