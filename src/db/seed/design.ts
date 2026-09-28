/**
 * UI system v3 design seed (DSYS-05). See docs/development/seeds.md.
 *
 * This frame creates the people and workspaces the design screens show, on a
 * fixed clock (Friday 25 September 2026, Europe/London) so relative times
 * ("09:32", "Yesterday") render as the design does. Per-screen data is added
 * by later steps; each step runs through the canonical data layer.
 */
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { eq } from 'drizzle-orm'
import * as schema from '../schema'
import type { SeedStep } from './run'

/** Fixed clock for the design seed: Friday 25 Sep 2026, 09:40 Europe/London. */
export const DESIGN_CLOCK = new Date('2026-09-25T09:40:00+01:00')

export const DESIGN_WORKSPACE_IDS = {
  processDevelopment: '00000000-0000-4000-8000-000000000300',
  analyticalDevelopment: '00000000-0000-4000-8000-000000000301',
  gmpManufacturing: '00000000-0000-4000-8000-000000000302',
  qualityControl: '00000000-0000-4000-8000-000000000303',
} as const

export const DESIGN_USER_IDS = {
  gareth: '00000000-0000-4000-8000-000000000310',
  priya: '00000000-0000-4000-8000-000000000311',
  mei: '00000000-0000-4000-8000-000000000312',
  tom: '00000000-0000-4000-8000-000000000313',
  sam: '00000000-0000-4000-8000-000000000314',
  anna: '00000000-0000-4000-8000-000000000315',
  clientAna: '00000000-0000-4000-8000-000000000316',
  clientBen: '00000000-0000-4000-8000-000000000317',
} as const

const DESIGN_USERS = [
  {
    id: DESIGN_USER_IDS.gareth,
    name: 'Gareth P.',
    email: 'gareth.p@design.sheetbase.dev',
  },
  {
    id: DESIGN_USER_IDS.priya,
    name: 'Priya S.',
    email: 'priya.s@design.sheetbase.dev',
  },
  {
    id: DESIGN_USER_IDS.mei,
    name: 'Mei L.',
    email: 'mei.l@design.sheetbase.dev',
  },
  {
    id: DESIGN_USER_IDS.tom,
    name: 'Tom H.',
    email: 'tom.h@design.sheetbase.dev',
  },
  {
    id: DESIGN_USER_IDS.sam,
    name: 'Sam R.',
    email: 'sam.r@design.sheetbase.dev',
  },
  {
    id: DESIGN_USER_IDS.anna,
    name: 'Anna B.',
    email: 'anna.b@design.sheetbase.dev',
  },
  {
    id: DESIGN_USER_IDS.clientAna,
    name: 'Ana C. (CL-017)',
    email: 'ana.c@client017.example',
  },
  {
    id: DESIGN_USER_IDS.clientBen,
    name: 'Ben D. (CL-017)',
    email: 'ben.d@client017.example',
  },
] as const

const DESIGN_WORKSPACES = [
  {
    id: DESIGN_WORKSPACE_IDS.processDevelopment,
    slug: 'process-development',
    name: 'Process Development',
  },
  {
    id: DESIGN_WORKSPACE_IDS.analyticalDevelopment,
    slug: 'analytical-development',
    name: 'Analytical Development',
  },
  {
    id: DESIGN_WORKSPACE_IDS.gmpManufacturing,
    slug: 'gmp-manufacturing',
    name: 'GMP Manufacturing',
  },
  {
    id: DESIGN_WORKSPACE_IDS.qualityControl,
    slug: 'quality-control',
    name: 'Quality Control',
  },
] as const

const PROCESS = DESIGN_WORKSPACE_IDS.processDevelopment

/**
 * The people and workspaces the design shows. Memberships make the switcher
 * and the members/access screens real; per-screen project, record and dataset
 * data lands in later DSYS-05 steps.
 */
export const designSteps: Array<SeedStep> = [
  {
    name: 'design people',
    run: async (db) => {
      for (const user of DESIGN_USERS) {
        await db
          .insert(schema.user)
          .values({ ...user, emailVerified: true })
          .onConflictDoUpdate({
            target: schema.user.id,
            set: { name: user.name, email: user.email },
          })
      }
    },
  },
  {
    name: 'design workspaces',
    run: async (db) => {
      for (const workspace of DESIGN_WORKSPACES) {
        await db
          .insert(schema.workspaces)
          .values(workspace)
          .onConflictDoUpdate({
            target: schema.workspaces.id,
            set: { slug: workspace.slug, name: workspace.name },
          })
      }
    },
  },
  {
    name: 'design memberships',
    run: async (db) => {
      const roles: Array<{
        userId: string
        workspaceId?: string
        role: 'owner' | 'admin' | 'member' | 'steward' | 'reviewer' | 'viewer'
      }> = [
        { userId: DESIGN_USER_IDS.gareth, role: 'owner' },
        { userId: DESIGN_USER_IDS.priya, role: 'member' },
        {
          userId: DESIGN_USER_IDS.mei,
          workspaceId: DESIGN_WORKSPACE_IDS.analyticalDevelopment,
          role: 'admin',
        },
        { userId: DESIGN_USER_IDS.mei, role: 'reviewer' },
        { userId: DESIGN_USER_IDS.tom, role: 'member' },
        { userId: DESIGN_USER_IDS.sam, role: 'member' },
        {
          userId: DESIGN_USER_IDS.anna,
          workspaceId: DESIGN_WORKSPACE_IDS.qualityControl,
          role: 'admin',
        },
        { userId: DESIGN_USER_IDS.anna, role: 'viewer' },
        { userId: DESIGN_USER_IDS.clientAna, role: 'viewer' },
        { userId: DESIGN_USER_IDS.clientBen, role: 'viewer' },
      ]
      for (const membership of roles) {
        const workspaceId = membership.workspaceId ?? PROCESS
        await db
          .insert(schema.workspaceMemberships)
          .values({
            workspaceId,
            userId: membership.userId,
            role: membership.role,
          })
          .onConflictDoUpdate({
            target: [
              schema.workspaceMemberships.workspaceId,
              schema.workspaceMemberships.userId,
            ],
            set: { role: membership.role },
          })
      }
    },
  },
  {
    name: 'design projects',
    run: async (db) => {
      for (const project of DESIGN_PROJECTS) {
        await db
          .insert(schema.projects)
          .values({
            id: project.id,
            workspaceId: project.workspaceId,
            key: project.key,
            title: project.title,
          })
          .onConflictDoUpdate({
            target: [schema.projects.workspaceId, schema.projects.key],
            set: { title: project.title },
          })
      }
    },
  },
  {
    name: 'design favourites',
    run: async (db) => {
      // The pinned projects the design shows in the navigation, most recently
      // favourited first (the read path orders by created_at desc).
      const pinned = [
        '00000000-0000-4000-8000-000000000320',
        '00000000-0000-4000-8000-000000000321',
        '00000000-0000-4000-8000-000000000322',
      ]
      for (const [index, projectId] of pinned.entries()) {
        await db
          .insert(schema.userFavourites)
          .values({
            workspaceId: PROCESS,
            userId: DESIGN_USER_IDS.gareth,
            objectKind: 'project',
            objectId: projectId,
            createdAt: new Date(DESIGN_CLOCK.getTime() - index * 60_000),
          })
          .onConflictDoNothing()
      }
    },
  },
  {
    name: 'design sample fields',
    run: async (db) => {
      for (const field of DESIGN_SAMPLE_FIELDS) {
        await db
          .insert(schema.recordFieldDefinitions)
          .values({
            id: field.id,
            workspaceId: PROCESS,
            kind: 'sample',
            fieldName: field.fieldName,
            label: field.label,
            displayOrder: field.displayOrder,
            logicalType: field.logicalType,
            nullable: field.nullable,
            unit: field.unit ?? null,
            validation: field.validation ?? {},
            lifecycle: 'active',
            createdByUserId: DESIGN_USER_IDS.gareth,
          })
          .onConflictDoUpdate({
            target: [
              schema.recordFieldDefinitions.workspaceId,
              schema.recordFieldDefinitions.kind,
              schema.recordFieldDefinitions.fieldName,
            ],
            set: {
              label: field.label,
              displayOrder: field.displayOrder,
              logicalType: field.logicalType,
              nullable: field.nullable,
              unit: field.unit ?? null,
              validation: field.validation ?? {},
              lifecycle: 'active',
            },
          })
      }
    },
  },
  {
    name: 'design samples',
    run: async (db) => {
      for (const sample of DESIGN_SAMPLES) {
        await db
          .insert(schema.records)
          .values({
            id: sample.id,
            workspaceId: PROCESS,
            projectId: DESIGN_PROJECTS[0].id,
            kind: 'sample',
            identifier: sample.identifier,
            title: sample.title,
            status: sample.status,
            customFields: sample.customFields,
            createdByUserId: DESIGN_USER_IDS.gareth,
          })
          .onConflictDoUpdate({
            target: [schema.records.projectId, schema.records.identifier],
            set: {
              title: sample.title,
              status: sample.status,
              customFields: sample.customFields,
              deletedAt: null,
              archivedAt: null,
            },
          })
      }
    },
  },
  {
    name: 'design materials',
    run: async (db) => {
      for (const material of DESIGN_MATERIALS) {
        await db
          .insert(schema.records)
          .values({
            id: material.id,
            workspaceId: PROCESS,
            projectId: DESIGN_PROJECTS[0].id,
            kind: 'reagent',
            identifier: material.identifier,
            title: material.title,
            status: material.status,
            properties: material.properties,
            createdByUserId: DESIGN_USER_IDS.gareth,
          })
          .onConflictDoUpdate({
            target: [schema.records.projectId, schema.records.identifier],
            set: {
              title: material.title,
              status: material.status,
              properties: material.properties,
              deletedAt: null,
              archivedAt: null,
            },
          })
      }
    },
  },
  {
    name: 'design protocols',
    run: async (db) => {
      for (const protocol of DESIGN_PROTOCOLS) {
        await db
          .insert(schema.records)
          .values({
            id: protocol.id,
            workspaceId: PROCESS,
            projectId: null,
            kind: 'protocol_template',
            identifier: protocol.identifier,
            title: protocol.title,
            status: protocol.status,
            createdByUserId: DESIGN_USER_IDS.gareth,
          })
          .onConflictDoUpdate({
            target: schema.records.id,
            set: {
              title: protocol.title,
              status: protocol.status,
              deletedAt: null,
              archivedAt: null,
            },
          })
      }
    },
  },
  {
    name: 'design experiments',
    run: async (db) => {
      for (const experiment of DESIGN_EXPERIMENTS) {
        await db
          .insert(schema.records)
          .values({
            id: experiment.id,
            workspaceId: PROCESS,
            projectId: DESIGN_PROJECTS[0].id,
            kind: 'experiment',
            identifier: experiment.identifier,
            title: experiment.title,
            status: experiment.status,
            createdByUserId: DESIGN_USER_IDS.gareth,
          })
          .onConflictDoUpdate({
            target: [schema.records.projectId, schema.records.identifier],
            set: {
              title: experiment.title,
              status: experiment.status,
              deletedAt: null,
              archivedAt: null,
            },
          })
        for (const block of experiment.blocks ?? []) {
          await db
            .insert(schema.blocks)
            .values({
              id: block.id,
              recordId: experiment.id,
              type: 'rich_text',
              order: block.order,
              payload: {
                doc: {
                  type: 'doc',
                  content: [
                    {
                      type: 'heading',
                      attrs: { level: 2 },
                      content: [{ type: 'text', text: block.heading }],
                    },
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: block.text }],
                    },
                  ],
                },
              },
              createdByUserId: DESIGN_USER_IDS.gareth,
            })
            .onConflictDoUpdate({
              target: schema.blocks.id,
              set: { payload: { doc: block.text }, order: block.order },
            })
        }
      }
    },
  },
  {
    name: 'design templates',
    run: async (db) => {
      for (const template of DESIGN_TEMPLATES) {
        await db
          .insert(schema.notebookTemplates)
          .values({
            id: template.id,
            workspaceId: PROCESS,
            key: template.key,
            name: template.name,
            description: template.description ?? null,
            lifecycle: 'active',
            createdByUserId: DESIGN_USER_IDS.gareth,
          })
          .onConflictDoUpdate({
            target: [
              schema.notebookTemplates.workspaceId,
              schema.notebookTemplates.key,
            ],
            set: {
              name: template.name,
              description: template.description ?? null,
            },
          })
        const existingVersion = await db
          .select({
            id: schema.notebookTemplateVersions.id,
            lifecycle: schema.notebookTemplateVersions.lifecycle,
          })
          .from(schema.notebookTemplateVersions)
          .where(eq(schema.notebookTemplateVersions.templateId, template.id))
          .limit(1)
        if (existingVersion.length === 0) {
          await db.insert(schema.notebookTemplateVersions).values({
            id: template.versionId,
            templateId: template.id,
            version: 1,
            lifecycle: 'draft',
            revision: 1n,
            configuration: template.configuration,
            createdByUserId: DESIGN_USER_IDS.gareth,
          })
        }
        if (existingVersion[0]?.lifecycle !== 'published') {
          await db
            .update(schema.notebookTemplateVersions)
            .set({
              lifecycle: 'published',
              publishedAt: DESIGN_CLOCK,
              publishedByUserId: DESIGN_USER_IDS.gareth,
            })
            .where(eq(schema.notebookTemplateVersions.id, template.versionId))
        }
      }
    },
  },
  {
    name: 'design datasets',
    run: (db) => seedDesignDatasets(db),
  },
  {
    name: 'design work items',
    run: (db) => seedDesignWorkItems(db),
  },
  {
    name: 'design instruments',
    run: async (db) => {
      for (const instrument of DESIGN_INSTRUMENTS) {
        await db
          .insert(schema.instruments)
          .values({
            id: instrument.id,
            workspaceId: PROCESS,
            name: instrument.name,
            instrumentType: instrument.instrumentType,
            model: instrument.model,
            serialNumber: instrument.serialNumber,
            vendor: instrument.vendor,
            displayId: instrument.displayId,
            position: instrument.position,
            createdByUserId: DESIGN_USER_IDS.gareth,
          })
          .onConflictDoNothing()
      }
    },
  },
  {
    name: 'design bookings',
    run: (db) => seedDesignBookings(db),
  },
]

const DESIGN_EXPERIMENTS: ReadonlyArray<{
  id: string
  identifier: string
  title: string
  status: string
  blocks?: ReadonlyArray<{
    id: string
    order: number
    heading: string
    text: string
  }>
}> = [
  {
    id: '00000000-0000-4000-8000-000000000350',
    identifier: 'EXP-0138',
    title: 'Transfection ratio, PEI:DNA sweep',
    status: 'in_review',
    blocks: [
      {
        id: '00000000-0000-4000-8000-000000000360',
        order: 1,
        heading: 'Objective',
        text: 'Find the PEI:DNA ratio (w/w) that maximises AAV9 genome titre in HEK293 suspension culture at 1.0 µg DNA per mL, without viability at harvest falling below 80 %.',
      },
    ],
  },
  {
    id: '00000000-0000-4000-8000-000000000351',
    identifier: 'EXP-0142',
    title: 'Harvest clarification: depth filter screening',
    status: 'in_progress',
    blocks: [
      {
        id: '00000000-0000-4000-8000-000000000361',
        order: 1,
        heading: 'Objective',
        text: 'Screen depth filter trains for harvest clarification of AAV9, tracking step yield and filtrate turbidity across load conditions.',
      },
      {
        id: '00000000-0000-4000-8000-000000000362',
        order: 2,
        heading: 'Observations',
        text: 'Train B held ≥ 84 % step yield across all loads with filtrate turbidity below 10 NTU. Train A fell below target at 150 L/m².',
      },
    ],
  },
  {
    id: '00000000-0000-4000-8000-000000000352',
    identifier: 'EXP-0136',
    title: 'Seeding density at transfection',
    status: 'approved',
    blocks: [
      {
        id: '00000000-0000-4000-8000-000000000363',
        order: 1,
        heading: 'Objective',
        text: 'Compare 1.5, 2.0 and 2.5 × 10⁶ cells/mL seeding densities for transfection productivity and viability.',
      },
    ],
  },
  {
    id: '00000000-0000-4000-8000-000000000353',
    identifier: 'EXP-0133',
    title: 'Harvest timing: 48, 72 and 96 h',
    status: 'approved',
    blocks: [
      {
        id: '00000000-0000-4000-8000-000000000364',
        order: 1,
        heading: 'Objective',
        text: 'Determine the harvest timepoint that maximises genome titre without compromising capsid integrity.',
      },
    ],
  },
  {
    id: '00000000-0000-4000-8000-0000000003b0',
    identifier: 'EXP-0091',
    title: 'Clarification run, screening',
    status: 'approved',
  },
  {
    id: '00000000-0000-4000-8000-0000000003b1',
    identifier: 'EXP-0098',
    title: 'TFF concentration, run 1',
    status: 'approved',
  },
  {
    id: '00000000-0000-4000-8000-0000000003b2',
    identifier: 'EXP-0117',
    title: 'Ambr 250 run, first batch',
    status: 'approved',
  },
  {
    id: '00000000-0000-4000-8000-0000000003b3',
    identifier: 'EXP-0119',
    title: 'Vessel seeding trial',
    status: 'approved',
  },
  {
    id: '00000000-0000-4000-8000-0000000003b4',
    identifier: 'EXP-0121',
    title: 'Glucose feed optimisation',
    status: 'in_progress',
  },
  {
    id: '00000000-0000-4000-8000-0000000003b5',
    identifier: 'EXP-0123',
    title: 'Lactate shift experiment',
    status: 'approved',
  },
  {
    id: '00000000-0000-4000-8000-0000000003b6',
    identifier: 'EXP-0124',
    title: 'Osmolality control run',
    status: 'in_progress',
  },
  {
    id: '00000000-0000-4000-8000-0000000003b7',
    identifier: 'EXP-0125',
    title: 'Full/empty ratio by AUC',
    status: 'approved',
  },
  {
    id: '00000000-0000-4000-8000-0000000003b8',
    identifier: 'EXP-0126',
    title: 'Harvest hold time screen',
    status: 'in_progress',
  },
  {
    id: '00000000-0000-4000-8000-0000000003b9',
    identifier: 'EXP-0127',
    title: 'Depth filter load trial',
    status: 'in_review',
  },
  {
    id: '00000000-0000-4000-8000-0000000003ba',
    identifier: 'EXP-0128',
    title: 'Expansion media A vs B',
    status: 'in_progress',
  },
  {
    id: '00000000-0000-4000-8000-0000000003bb',
    identifier: 'EXP-0129',
    title: 'AEX gradient screen',
    status: 'in_progress',
  },
  {
    id: '00000000-0000-4000-8000-0000000003bc',
    identifier: 'EXP-0130',
    title: 'HEK293 WCB viability panel',
    status: 'in_review',
  },
  {
    id: '00000000-0000-4000-8000-0000000003bd',
    identifier: 'EXP-0131',
    title: 'Day 7 stability pull, 2–8 °C',
    status: 'in_review',
  },
  {
    id: '00000000-0000-4000-8000-0000000003be',
    identifier: 'EXP-0132',
    title: 'Freeze–thaw hold study',
    status: 'approved',
  },
  {
    id: '00000000-0000-4000-8000-0000000003bf',
    identifier: 'EXP-0134',
    title: 'Media hold time',
    status: 'approved',
  },
  {
    id: '00000000-0000-4000-8000-0000000003c0',
    identifier: 'EXP-0137',
    title: 'Seeding density at scale',
    status: 'approved',
  },
  {
    id: '00000000-0000-4000-8000-0000000003c1',
    identifier: 'EXP-0139',
    title: 'AEX resin screen',
    status: 'on_hold',
  },
  {
    id: '00000000-0000-4000-8000-0000000003c2',
    identifier: 'EXP-0140',
    title: 'Ambr 250 run AMB-25-118',
    status: 'in_progress',
  },
  {
    id: '00000000-0000-4000-8000-0000000003c3',
    identifier: 'EXP-0141',
    title: 'Clarification yield check',
    status: 'in_progress',
  },
  {
    id: '00000000-0000-4000-8000-0000000003c4',
    identifier: 'EXP-0144',
    title: 'TFF concentration, run 2',
    status: 'planned',
  },
  {
    id: '00000000-0000-4000-8000-0000000003c5',
    identifier: 'EXP-0145',
    title: 'Harvest clarification: 50 L confirmation run',
    status: 'draft',
  },
  {
    id: '00000000-0000-4000-8000-0000000003c6',
    identifier: 'EXP-0146',
    title: 'Seeding density follow-up',
    status: 'draft',
  },
]

const DESIGN_TEMPLATES: ReadonlyArray<{
  id: string
  versionId: string
  key: string
  name: string
  description?: string
  configuration: Record<string, unknown>
}> = [
  {
    id: '00000000-0000-4000-8000-000000000380',
    versionId: '00000000-0000-4000-8000-000000000381',
    key: 'aav9_transfection_notebook',
    name: 'AAV9 transfection notebook',
    description: 'Standard transfection setup, sampling and harvest capture.',
    configuration: { formatVersion: 1, parameters: [], placements: [] },
  },
  {
    id: '00000000-0000-4000-8000-000000000382',
    versionId: '00000000-0000-4000-8000-000000000383',
    key: 'depth_filter_screening',
    name: 'Depth filter screening',
    description:
      'Harvest clarification screening with step yield and turbidity.',
    configuration: { formatVersion: 1, parameters: [], placements: [] },
  },
  {
    id: '00000000-0000-4000-8000-000000000384',
    versionId: '00000000-0000-4000-8000-000000000385',
    key: 'stability_pull',
    name: 'Stability pull',
    description: 'Routine stability timepoint pull with assay capture.',
    configuration: { formatVersion: 1, parameters: [], placements: [] },
  },
]

const DESIGN_INSTRUMENTS: ReadonlyArray<{
  id: string
  displayId: string
  name: string
  instrumentType: string
  model: string
  serialNumber: string
  vendor: string
  position: number
}> = [
  {
    id: '00000000-0000-4000-8000-0000000003e0',
    displayId: 'INS-0007',
    name: 'Plate reader PR-01',
    instrumentType: 'spectrophotometer',
    model: 'SpectraMax i3x',
    serialNumber: 'PR01-2291',
    vendor: 'Molecular Devices',
    position: 0,
  },
  {
    id: '00000000-0000-4000-8000-0000000003e1',
    displayId: 'INS-0008',
    name: 'Ambr 250',
    instrumentType: 'other',
    model: 'Ambr 250',
    serialNumber: 'AMB-118',
    vendor: 'Sartorius',
    position: 1,
  },
]

const DESIGN_MATERIALS: ReadonlyArray<{
  id: string
  identifier: string
  title: string
  status: string
  properties: Record<string, unknown>
}> = [
  {
    id: '00000000-0000-4000-8000-0000000003a0',
    identifier: 'MAT-0342',
    title: 'Filter train C',
    status: 'available',
    properties: { supplier: 'Sartorius', lot: 'L-77310', expiry: '2026-10-01' },
  },
  {
    id: '00000000-0000-4000-8000-0000000003a1',
    identifier: 'MAT-0355',
    title: 'Depth filter SD-1',
    status: 'available',
    properties: { supplier: 'Pall', lot: 'L-77105', expiry: '2027-03-15' },
  },
  {
    id: '00000000-0000-4000-8000-0000000003a2',
    identifier: 'MAT-0366',
    title: 'PEI MAX 40K',
    status: 'available',
    properties: {
      supplier: 'Polysciences',
      lot: 'L-76420',
      expiry: '2027-01-20',
    },
  },
  {
    id: '00000000-0000-4000-8000-0000000003a3',
    identifier: 'MAT-0371',
    title: 'Opti-MEM',
    status: 'available',
    properties: {
      supplier: 'Thermo Fisher',
      lot: 'L-75211',
      expiry: '2027-08-30',
    },
  },
  {
    id: '00000000-0000-4000-8000-0000000003a4',
    identifier: 'MAT-0377',
    title: 'HEK293F suspension',
    status: 'available',
    properties: {
      supplier: 'Thermo Fisher',
      lot: 'L-75980',
      expiry: '2026-12-05',
    },
  },
  {
    id: '00000000-0000-4000-8000-0000000003a5',
    identifier: 'MAT-0402',
    title: 'rProtein A resin',
    status: 'available',
    properties: { supplier: 'Cytiva', lot: 'L-78012', expiry: '2027-06-18' },
  },
  {
    id: '00000000-0000-4000-8000-0000000003a6',
    identifier: 'MAT-0418',
    title: 'DiI labelling reagent',
    status: 'available',
    properties: {
      supplier: 'Thermo Fisher',
      lot: 'L-78801',
      expiry: '2027-02-28',
    },
  },
  {
    id: '00000000-0000-4000-8000-0000000003a7',
    identifier: 'MAT-0419',
    title: 'Lentivirus titration kit',
    status: 'available',
    properties: { supplier: 'Miltenyi', lot: 'L-78812', expiry: '2027-04-10' },
  },
  {
    id: '00000000-0000-4000-8000-0000000003a8',
    identifier: 'MAT-0420',
    title: 'Filter train C lot L-77310',
    status: 'available',
    properties: { supplier: 'Sartorius', lot: 'L-77310', expiry: '2026-10-01' },
  },
  {
    id: '00000000-0000-4000-8000-0000000003a9',
    identifier: 'MAT-0421',
    title: 'TFF membrane cassette',
    status: 'available',
    properties: { supplier: 'Repligen', lot: 'L-78903', expiry: '2027-09-01' },
  },
]

const DESIGN_PROTOCOLS: ReadonlyArray<{
  id: string
  identifier: string
  title: string
  status: string
}> = [
  {
    id: '00000000-0000-4000-8000-000000000370',
    identifier: 'PRT-006',
    title: 'HEK293 transfection',
    status: 'active',
  },
  {
    id: '00000000-0000-4000-8000-000000000371',
    identifier: 'PRT-014',
    title: 'AAV9 harvest clarification',
    status: 'active',
  },
  {
    id: '00000000-0000-4000-8000-000000000372',
    identifier: 'PRT-018',
    title: 'PEI:DNA transfection',
    status: 'under_review',
  },
  {
    id: '00000000-0000-4000-8000-000000000390',
    identifier: 'PRT-009',
    title: 'HEK293 WCB viability panel',
    status: 'active',
  },
  {
    id: '00000000-0000-4000-8000-000000000391',
    identifier: 'PRT-012',
    title: 'AAV full/empty ratio by AUC',
    status: 'active',
  },
  {
    id: '00000000-0000-4000-8000-000000000392',
    identifier: 'PRT-017',
    title: 'Seeding density at transfection',
    status: 'active',
  },
  {
    id: '00000000-0000-4000-8000-000000000393',
    identifier: 'PRT-019',
    title: 'Day 7 stability pull',
    status: 'active',
  },
  {
    id: '00000000-0000-4000-8000-000000000394',
    identifier: 'PRT-020',
    title: 'Expansion media screen',
    status: 'active',
  },
  {
    id: '00000000-0000-4000-8000-000000000395',
    identifier: 'PRT-021',
    title: 'Harvest clarification: depth filter screening',
    status: 'active',
  },
  {
    id: '00000000-0000-4000-8000-000000000396',
    identifier: 'PRT-022',
    title: 'AEX resin screen',
    status: 'active',
  },
  {
    id: '00000000-0000-4000-8000-000000000397',
    identifier: 'PRT-025',
    title: 'TFF concentration',
    status: 'draft',
  },
  {
    id: '00000000-0000-4000-8000-000000000398',
    identifier: 'PRT-024',
    title: 'Review workflow template',
    status: 'active',
  },
]

const DESIGN_SAMPLE_FIELDS: ReadonlyArray<{
  id: string
  fieldName: string
  label: string
  displayOrder: number
  logicalType: 'text' | 'decimal' | 'category'
  nullable: boolean
  unit?: unknown
  validation?: Record<string, unknown>
}> = [
  {
    id: '00000000-0000-4000-8000-000000000330',
    fieldName: 'construct',
    label: 'Construct',
    displayOrder: 1,
    logicalType: 'text',
    nullable: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000331',
    fieldName: 'batch',
    label: 'Batch',
    displayOrder: 2,
    logicalType: 'text',
    nullable: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000332',
    fieldName: 'concentration',
    label: 'Concentration',
    displayOrder: 3,
    logicalType: 'decimal',
    nullable: true,
    unit: { symbol: 'vg/mL' },
  },
]

const DESIGN_SAMPLES = [
  {
    id: '00000000-0000-4000-8000-000000000340',
    identifier: 'SMP-2231',
    title: 'Harvest lot HL-0934',
    status: 'available',
    customFields: {
      construct: 'AAV9',
      batch: 'HL-0934',
      concentration: 4.6e12,
    },
  },
  {
    id: '00000000-0000-4000-8000-000000000341',
    identifier: 'SMP-2232',
    title: 'R1.0 flask A',
    status: 'available',
    customFields: { construct: 'AAV9', batch: 'R1.0' },
  },
  {
    id: '00000000-0000-4000-8000-000000000342',
    identifier: 'SMP-2233',
    title: 'R1.0 flask B',
    status: 'available',
    customFields: { construct: 'AAV9', batch: 'R1.0' },
  },
  {
    id: '00000000-0000-4000-8000-000000000343',
    identifier: 'SMP-2234',
    title: 'R1.5 flask A',
    status: 'available',
    customFields: { construct: 'AAV9', batch: 'R1.5' },
  },
  {
    id: '00000000-0000-4000-8000-000000000344',
    identifier: 'SMP-2235',
    title: 'R1.5 flask B',
    status: 'available',
    customFields: { construct: 'AAV9', batch: 'R1.5' },
  },
  {
    id: '00000000-0000-4000-8000-000000000345',
    identifier: 'SMP-2237',
    title: 'R2.0 flask A',
    status: 'consumed',
    customFields: { construct: 'AAV9', batch: 'R2.0' },
  },
  {
    id: '00000000-0000-4000-8000-000000000346',
    identifier: 'SMP-2239',
    title: 'R2.0 flask B',
    status: 'consumed',
    customFields: { construct: 'AAV9', batch: 'R2.0' },
  },
  {
    id: '00000000-0000-4000-8000-000000000347',
    identifier: 'SMP-2251',
    title: 'R3.0 flask A',
    status: 'quarantined',
    customFields: { construct: 'AAV9', batch: 'R3.0' },
  },
  {
    id: '00000000-0000-4000-8000-000000000364',
    identifier: 'SMP-2248',
    title: 'C-150 filtrate',
    status: 'available',
    customFields: { construct: 'AAV9', batch: 'C-150' },
  },
  {
    id: '00000000-0000-4000-8000-000000000365',
    identifier: 'SMP-2249',
    title: 'C-150 filtrate, 1:5 dilution',
    status: 'available',
    customFields: { construct: 'AAV9', batch: 'C-150' },
  },
  {
    id: '00000000-0000-4000-8000-000000000366',
    identifier: 'SMP-2250',
    title: 'C-150 filtrate, repeat',
    status: 'available',
    customFields: { construct: 'AAV9', batch: 'C-150' },
  },
  {
    id: '00000000-0000-4000-8000-000000000367',
    identifier: 'SMP-2238',
    title: 'R1.5 flask B, consumed',
    status: 'consumed',
    customFields: { construct: 'AAV9', batch: 'R1.5' },
  },
  {
    id: '00000000-0000-4000-8000-000000000368',
    identifier: 'SMP-2236',
    title: 'R1.5 flask A, consumed',
    status: 'consumed',
    customFields: { construct: 'AAV9', batch: 'R1.5' },
  },
  {
    id: '00000000-0000-4000-8000-000000000369',
    identifier: 'SMP-2227',
    title: 'R1.5 harvest, hold',
    status: 'available',
    customFields: { construct: 'AAV9', batch: 'R1.5' },
  },
  {
    id: '00000000-0000-4000-8000-00000000036a',
    identifier: 'SMP-2220',
    title: 'R1.0 harvest, quarantine',
    status: 'quarantined',
    customFields: { construct: 'AAV9', batch: 'R1.0' },
  },
  {
    id: '00000000-0000-4000-8000-00000000036b',
    identifier: 'SMP-2214',
    title: 'R1.0 filtrate, hold',
    status: 'available',
    customFields: { construct: 'AAV9', batch: 'R1.0' },
  },
  {
    id: '00000000-0000-4000-8000-00000000036c',
    identifier: 'SMP-2210',
    title: 'LVV-CAR-T drug substance',
    status: 'available',
    customFields: { construct: 'LVV', batch: 'DS-01' },
  },
  {
    id: '00000000-0000-4000-8000-00000000036d',
    identifier: 'SMP-2201',
    title: 'LVV-CAR-T drug product',
    status: 'available',
    customFields: { construct: 'LVV', batch: 'DP-01' },
  },
  {
    id: '00000000-0000-4000-8000-00000000036e',
    identifier: 'SMP-2190',
    title: 'LVV-CAR-T harvest',
    status: 'consumed',
    customFields: { construct: 'LVV', batch: 'HV-01' },
  },
  {
    id: '00000000-0000-4000-8000-0000000003d0',
    identifier: 'SMP-1002',
    title: 'LVV-CAR-T starting material',
    status: 'available',
    customFields: { construct: 'LVV', batch: 'SM-01' },
  },
  {
    id: '00000000-0000-4000-8000-0000000003d1',
    identifier: 'SMP-2188',
    title: 'R0.5 flask A',
    status: 'available',
    customFields: { construct: 'AAV9', batch: 'R0.5' },
  },
  {
    id: '00000000-0000-4000-8000-0000000003d2',
    identifier: 'SMP-2211',
    title: 'R1.0 harvest, hold',
    status: 'available',
    customFields: { construct: 'AAV9', batch: 'R1.0' },
  },
  {
    id: '00000000-0000-4000-8000-0000000003d3',
    identifier: 'SMP-2226',
    title: 'R1.5 filtrate',
    status: 'available',
    customFields: { construct: 'AAV9', batch: 'R1.5' },
  },
  {
    id: '00000000-0000-4000-8000-0000000003d4',
    identifier: 'SMP-2240',
    title: 'C-150 filtrate, A',
    status: 'available',
    customFields: { construct: 'AAV9', batch: 'C-150' },
  },
  {
    id: '00000000-0000-4000-8000-0000000003d5',
    identifier: 'SMP-2241',
    title: 'C-150 filtrate, B',
    status: 'available',
    customFields: { construct: 'AAV9', batch: 'C-150' },
  },
  {
    id: '00000000-0000-4000-8000-0000000003d6',
    identifier: 'SMP-2242',
    title: 'C-150 filtrate, C',
    status: 'available',
    customFields: { construct: 'AAV9', batch: 'C-150' },
  },
  {
    id: '00000000-0000-4000-8000-0000000003d7',
    identifier: 'SMP-2243',
    title: 'C-150 filtrate, 1:2',
    status: 'available',
    customFields: { construct: 'AAV9', batch: 'C-150' },
  },
  {
    id: '00000000-0000-4000-8000-0000000003d8',
    identifier: 'SMP-2244',
    title: 'C-150 filtrate, 1:5',
    status: 'available',
    customFields: { construct: 'AAV9', batch: 'C-150' },
  },
  {
    id: '00000000-0000-4000-8000-0000000003d9',
    identifier: 'SMP-2245',
    title: 'C-150 filtrate, 1:10',
    status: 'available',
    customFields: { construct: 'AAV9', batch: 'C-150' },
  },
  {
    id: '00000000-0000-4000-8000-0000000003da',
    identifier: 'SMP-2246',
    title: 'C-200 filtrate',
    status: 'available',
    customFields: { construct: 'AAV9', batch: 'C-200' },
  },
  {
    id: '00000000-0000-4000-8000-0000000003db',
    identifier: 'SMP-2247',
    title: 'C-200 filtrate, 1:5',
    status: 'available',
    customFields: { construct: 'AAV9', batch: 'C-200' },
  },
  {
    id: '00000000-0000-4000-8000-0000000003dc',
    identifier: 'SMP-2252',
    title: 'Review sample, approved',
    status: 'available',
    customFields: { construct: 'AAV9', batch: 'RV-01' },
  },
  {
    id: '00000000-0000-4000-8000-0000000003dd',
    identifier: 'SMP-2253',
    title: 'Import sample',
    status: 'available',
    customFields: { construct: 'AAV9', batch: 'IM-01' },
  },
]

/**
 * The projects the design screens show, per workspace. Client, stage and lead
 * live in `custom_fields` until PROJ-01 gives them columns.
 */
const DESIGN_PROJECTS: ReadonlyArray<{
  id: string
  workspaceId: string
  key: string
  title: string
}> = [
  {
    id: '00000000-0000-4000-8000-000000000320',
    workspaceId: DESIGN_WORKSPACE_IDS.processDevelopment,
    key: 'aav9-process-transfer',
    title: 'AAV9 process transfer',
  },
  {
    id: '00000000-0000-4000-8000-000000000321',
    workspaceId: DESIGN_WORKSPACE_IDS.processDevelopment,
    key: 'lvv-stability-2-8c',
    title: 'LVV stability, 2–8 °C hold',
  },
  {
    id: '00000000-0000-4000-8000-000000000322',
    workspaceId: DESIGN_WORKSPACE_IDS.processDevelopment,
    key: 'ambr-250-perfusion-scale-down',
    title: 'Ambr 250 perfusion scale-down',
  },
  {
    id: '00000000-0000-4000-8000-000000000323',
    workspaceId: DESIGN_WORKSPACE_IDS.processDevelopment,
    key: 'car-t-expansion-media-screen',
    title: 'CAR-T expansion media screen',
  },
  {
    id: '00000000-0000-4000-8000-000000000324',
    workspaceId: DESIGN_WORKSPACE_IDS.processDevelopment,
    key: 'hek293-cell-bank-characterisation',
    title: 'HEK293 cell bank characterisation',
  },
  {
    id: '00000000-0000-4000-8000-000000000325',
    workspaceId: DESIGN_WORKSPACE_IDS.analyticalDevelopment,
    key: 'ddpcr-titre-qualification',
    title: 'ddPCR titre qualification',
  },
  {
    id: '00000000-0000-4000-8000-000000000326',
    workspaceId: DESIGN_WORKSPACE_IDS.gmpManufacturing,
    key: 'engineering-run-50l',
    title: '50 L engineering run',
  },
  {
    id: '00000000-0000-4000-8000-000000000327',
    workspaceId: DESIGN_WORKSPACE_IDS.qualityControl,
    key: 'release-testing-aav9',
    title: 'Release testing, AAV9',
  },
]

/**
 * DSYS-05.2 — the datasets the design screens show. Datasets are created
 * through the canonical capability RPCs (`create_dataset_schema_definition`,
 * `publish_dataset_schema_version`, `commit_dataset_row_batch`,
 * `snapshot_dataset`) on a claims-bearing connection, exactly as the app does.
 */
interface DesignDatasetField {
  key: string
  label: string
  logicalType: 'text' | 'integer' | 'decimal' | 'boolean' | 'date' | 'timestamp'
  unit?: string
  required?: boolean
}

interface DesignDataset {
  id: string
  displayId: string
  workspaceId: string
  actorId: string
  projectId: string
  schemaKey: string
  schemaName: string
  name: string
  description: string
  fields: ReadonlyArray<DesignDatasetField>
  snapshotLabels: ReadonlyArray<string>
  rows: () => Array<Record<string, unknown>>
}

const AMBR_FIELDS: ReadonlyArray<DesignDatasetField> = [
  { key: 'vessel', label: 'Vessel', logicalType: 'text', required: true },
  {
    key: 'day',
    label: 'Day',
    logicalType: 'integer',
    unit: 'day',
    required: true,
  },
  { key: 'time', label: 'Time', logicalType: 'text', required: true },
  {
    key: 'vcd',
    label: 'VCD',
    logicalType: 'decimal',
    unit: '×10⁶ cells/mL',
    required: true,
  },
  {
    key: 'viability',
    label: 'Viability',
    logicalType: 'decimal',
    unit: '%',
    required: true,
  },
  { key: 'glucose', label: 'Glucose', logicalType: 'decimal', required: true },
  {
    key: 'lactate',
    label: 'Lactate',
    logicalType: 'decimal',
    unit: 'g/L',
  },
  {
    key: 'osmolality',
    label: 'Osmolality',
    logicalType: 'decimal',
    required: true,
  },
  { key: 'ph_value', label: 'pH', logicalType: 'decimal', required: true },
  { key: 'dissolved_oxygen', label: 'DO', logicalType: 'decimal', unit: '%' },
]

const ELISA_FIELDS: ReadonlyArray<DesignDatasetField> = [
  { key: 'sample', label: 'Sample', logicalType: 'text', required: true },
  { key: 'plate', label: 'Plate', logicalType: 'text', required: true },
  { key: 'well', label: 'Well', logicalType: 'text', required: true },
  {
    key: 'dilution',
    label: 'Dilution',
    logicalType: 'integer',
    required: true,
  },
  {
    key: 'capsid_titre',
    label: 'Capsid titre',
    logicalType: 'decimal',
    unit: '×10¹⁰ vg/mL',
    required: true,
  },
  {
    key: 'turbidity',
    label: 'Turbidity',
    logicalType: 'decimal',
    unit: 'NTU',
    required: true,
  },
  { key: 'a260', label: 'A260', logicalType: 'decimal', unit: 'AU' },
  { key: 'a280', label: 'A280', logicalType: 'decimal', unit: 'AU' },
  { key: 'ratio', label: 'A260/A280', logicalType: 'decimal' },
  { key: 'out_of_range', label: 'Out of range', logicalType: 'boolean' },
  { key: 'note', label: 'Note', logicalType: 'text' },
]

const DESIGN_DATASETS: ReadonlyArray<DesignDataset> = [
  {
    id: '00000000-0000-4000-8000-000000000380',
    workspaceId: DESIGN_WORKSPACE_IDS.processDevelopment,
    actorId: DESIGN_USER_IDS.gareth,
    projectId: '00000000-0000-4000-8000-000000000322',
    displayId: 'DS-0298',
    schemaKey: 'ambr_250_daily_reading',
    schemaName: 'Ambr 250 daily reading',
    name: 'Ambr 250 daily readings, AMB-25-118',
    description: 'Imported daily from Ambr 250 export',
    fields: AMBR_FIELDS,
    snapshotLabels: [
      'Import · AMB-25-118_day1_am.csv',
      'Import · AMB-25-118_day2_am.csv',
      'Import · AMB-25-118_day3_am.csv',
      'Import · AMB-25-118_day4_pm.csv',
      'Import · AMB-25-118_day5_am.csv',
      'Import · AMB-25-118_day6_am.csv',
      'Import · AMB-25-118_day7_am.csv',
    ],
    rows: ambrRows,
  },
  {
    id: '00000000-0000-4000-8000-000000000381',
    workspaceId: DESIGN_WORKSPACE_IDS.processDevelopment,
    actorId: DESIGN_USER_IDS.gareth,
    projectId: '00000000-0000-4000-8000-000000000320',
    displayId: 'DS-0311',
    schemaKey: 'elisa_turbidity',
    schemaName: 'ELISA and turbidity',
    name: 'ELISA capsid titre and turbidity',
    description: 'Plate-based capsid titre with harvest turbidity',
    fields: ELISA_FIELDS,
    snapshotLabels: [
      'Import · ELISA plate 1',
      'Import · ELISA plate 2',
      'Import · ELISA plate 3',
      'Import · ELISA plate 4',
      'Import · ELISA plate 5',
      'Gareth P. · saved by hand',
      'Import · PR-01 plate 0 (controls)',
      'Gareth P. · saved by hand',
      'Import · PR-01 plates 1–3',
      'Import · TB-02_turbidity_2026-09-24.csv',
      'Import · TB-02_turbidity_2026-09-25.csv',
      'Import · PR-01 plate 4',
      'Import · PR-01 plate 5',
      'Pipeline PL-0011 run #88 · plate 4 export',
      'Pipeline PL-0011 run #88 · plate 4 export (final)',
    ],
    rows: elisaRows,
  },
]

const AMBR_DAY = {
  5: {
    V01: [8.1, 96.4, 3.1, 1.2, 302, 7.05, 40],
    V02: [7.8, 96.0, 3.3, 1.1, 299, 7.06, 41],
    V03: [8.4, 96.8, 2.9, 1.3, 305, 7.04, 40],
    V04: [7.5, 95.7, 3.4, 1.0, 298, 7.07, 39],
  },
  6: {
    V01: [12.4, 95.1, 2.4, 1.6, 309, 7.02, 40],
    V02: [11.9, 95.3, 2.6, 1.5, 306, 7.03, 40],
    V03: [12.8, 94.8, 2.2, 1.7, 311, 7.01, 41],
    V04: [11.2, 95.5, 2.7, 1.4, 304, 7.04, 40],
  },
} as const

function ambrRows(): Array<Record<string, unknown>> {
  const vessels = ['V01', 'V02', 'V03', 'V04'] as const
  const rows: Array<Record<string, unknown>> = []
  for (let day = 1; day <= 21; day += 1) {
    vessels.forEach((vessel, vesselIndex) => {
      const exact = day === 5 || day === 6 ? AMBR_DAY[day][vessel] : undefined
      const minute = day >= 5 ? day * 2 - 2 : day
      const time = exact
        ? day === 5
          ? `08:${50 + vesselIndex * 2}`
          : `09:0${6 + vesselIndex * 2}`
        : `08:${String(40 + minute).padStart(2, '0')}`
      const [
        vcd,
        viability,
        glucose,
        lactate,
        osmolality,
        ph,
        dissolvedOxygen,
      ] = exact ?? [
        Number((2.6 + day * 0.62 + vesselIndex * 0.15).toFixed(1)),
        Number((96.6 - day * 0.07 - vesselIndex * 0.1).toFixed(1)),
        Number((4.1 - day * 0.09).toFixed(1)),
        Number((0.7 + day * 0.045).toFixed(1)),
        284 + day * 3 + vesselIndex,
        Number((7.11 - day * 0.005 + vesselIndex * 0.005).toFixed(2)),
        38 + ((day + vesselIndex) % 4),
      ]
      rows.push({
        vessel,
        day,
        time,
        vcd,
        viability,
        glucose,
        lactate,
        osmolality,
        ph_value: ph,
        dissolved_oxygen: dissolvedOxygen,
      })
    })
  }
  return rows
}

function elisaRows(): Array<Record<string, unknown>> {
  const plates = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']
  const wells = [
    'A1',
    'A2',
    'A3',
    'A4',
    'A5',
    'A6',
    'B1',
    'B2',
    'B3',
    'B4',
    'B5',
    'B6',
  ]
  const rows: Array<Record<string, unknown>> = []
  plates.forEach((plate, plateIndex) => {
    wells.forEach((well, wellIndex) => {
      const sample = `S-${String(plateIndex * 12 + wellIndex + 1).padStart(3, '0')}`
      const dilution = [10, 100, 1000][wellIndex % 3]
      const capsidTitre = Number(
        (3.4 + ((plateIndex * 12 + wellIndex) % 17) * 0.18).toFixed(2),
      )
      const turbidity = Number(
        (4.2 + ((plateIndex * 7 + wellIndex) % 9) * 0.9).toFixed(1),
      )
      const a260 = Number((0.52 + (wellIndex % 5) * 0.03).toFixed(3))
      const a280 = Number((0.31 + (wellIndex % 4) * 0.02).toFixed(3))
      const outOfRange = capsidTitre > 5.6
      rows.push({
        sample,
        plate,
        well,
        dilution,
        capsid_titre: capsidTitre,
        turbidity,
        a260,
        a280,
        ratio: Number((a260 / a280).toFixed(2)),
        out_of_range: outOfRange,
        note: outOfRange ? 'Above top standard' : null,
      })
    })
  })
  return rows
}

function datasetFieldsWire(dataset: DesignDataset) {
  return dataset.fields.map((field, index) => ({
    key: field.key,
    label: field.label,
    logical_type: field.logicalType,
    nullable: !field.required,
    ...(field.unit
      ? {
          quantity: {
            kind: 'quantity',
            dimension: field.unit,
            storageUnit: field.unit,
            symbol: field.unit,
          },
        }
      : {}),
    display_order: index + 1,
  }))
}

/**
 * Runs `fn` as `actorId` in `workspaceId` through the PostgREST role with JWT
 * claims, the same write actor the app uses, so capability and RLS checks run.
 */
async function withDesignClaims<T>(
  db: Parameters<SeedStep['run']>[0],
  actorId: string,
  workspaceId: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const poolCs = db.$client.options.connectionString
  const pgrst = new URL(process.env.PGRST_DB_URI ?? '')
  if (!poolCs || !pgrst.username) {
    throw new Error('PGRST_DB_URI and the pool connection string are required')
  }
  const authUrl = new URL(poolCs)
  authUrl.username = pgrst.username
  authUrl.password = pgrst.password
  const client = new Client({ connectionString: authUrl.toString() })
  await client.connect()
  try {
    await client.query('SET ROLE authenticated')
    await client.query("SELECT set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({
        sub: actorId,
        workspace_id: workspaceId,
        role: 'authenticated',
      }),
    ])
    return await fn(client)
  } finally {
    await client.query('RESET ROLE').catch(() => {})
    await client.end()
  }
}

async function seedDesignDatasets(
  db: Parameters<SeedStep['run']>[0],
): Promise<void> {
  for (const dataset of DESIGN_DATASETS) {
    await withDesignClaims(
      db,
      dataset.actorId,
      dataset.workspaceId,
      async (client) => {
        const existing = await client.query(
          'select id from api.datasets where id = $1',
          [dataset.id],
        )
        if ((existing.rowCount ?? 0) > 0) return

        const definition = await client.query(
          'select id from api.dataset_schema_definitions where workspace_id = $1 and key = $2',
          [dataset.workspaceId, dataset.schemaKey],
        )
        let schemaVersionId: string
        if ((definition.rowCount ?? 0) > 0) {
          const version = await client.query(
            'select id, lifecycle from api.dataset_schema_versions where schema_id = $1 order by version desc limit 1',
            [definition.rows[0].id],
          )
          if (!(version.rowCount ?? 0)) {
            throw new Error(`schema version missing for ${dataset.schemaKey}`)
          }
          schemaVersionId = version.rows[0].id
          if (version.rows[0].lifecycle !== 'active') {
            await client.query(
              'select api.replace_dataset_schema_version_fields($1,$2::jsonb)',
              [schemaVersionId, JSON.stringify(datasetFieldsWire(dataset))],
            )
            await client.query(
              'select api.publish_dataset_schema_version($1)',
              [schemaVersionId],
            )
          }
        } else {
          const created = await client.query(
            'select api.create_dataset_schema_definition($1,$2,$3,$4,$5::jsonb) as result',
            [
              dataset.workspaceId,
              dataset.schemaKey,
              dataset.schemaName,
              dataset.description,
              JSON.stringify(datasetFieldsWire(dataset)),
            ],
          )
          schemaVersionId = created.rows[0].result.schema_version_id
          await client.query('select api.publish_dataset_schema_version($1)', [
            schemaVersionId,
          ])
        }

        await client.query(
          `insert into api.datasets
           (id, workspace_id, schema_version_id, name, description, primary_project_id, created_by_user_id, display_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            dataset.id,
            dataset.workspaceId,
            schemaVersionId,
            dataset.name,
            dataset.description,
            dataset.projectId,
            dataset.actorId,
          ],
        )

        const fields = await client.query(
          'select field_id, key from api.dataset_schema_version_fields where schema_version_id = $1',
          [schemaVersionId],
        )
        const fieldIdByKey = new Map<string, string>(
          fields.rows.map((row: { field_id: string; key: string }) => [
            row.key,
            row.field_id,
          ]),
        )

        const rows = dataset.rows().map((row) => ({
          rowId: randomUUID(),
          operation: 'create',
          values: Object.fromEntries(
            Object.entries(row).map(([key, value]) => [
              fieldIdByKey.get(key),
              value,
            ]),
          ),
        }))
        if (rows.length > 0) {
          const revision = await client.query(
            'select revision from api.datasets where id = $1',
            [dataset.id],
          )
          await client.query(
            'select api.commit_dataset_row_batch($1,$2,$3::jsonb,$4)',
            [
              dataset.id,
              revision.rows[0].revision,
              JSON.stringify(rows),
              `design-${dataset.schemaKey}`,
            ],
          )
        }

        const snapshotRevision = (
          await client.query(
            'select revision from api.datasets where id = $1',
            [dataset.id],
          )
        ).rows[0].revision
        for (const label of dataset.snapshotLabels) {
          await client.query('select api.snapshot_dataset($1,$2,$3)', [
            dataset.id,
            snapshotRevision,
            label,
          ])
        }
      },
    )
  }
}

/**
 * DSYS-05.2 — the Inbox work items the design shows for Gareth P.: a review
 * assigned to him, the records he follows, and a failed pipeline run.
 */
async function seedDesignWorkItems(
  db: Parameters<SeedStep['run']>[0],
): Promise<void> {
  await db
    .insert(schema.reviewWorkflowDefinitions)
    .values({
      definitionKey: 'default-review',
      version: 1,
      definition: { steps: [] },
    })
    .onConflictDoNothing()

  // EXP-0138 waits for Gareth's review (submitted by Priya S.).
  await db
    .insert(schema.revisions)
    .values({
      id: '00000000-0000-4000-8000-000000000400',
      recordId: DESIGN_EXPERIMENTS[0].id,
      workspaceId: PROCESS,
      structureVersion: 1,
      metadataVersion: 2,
      metadataSnapshot: {},
      blockSnapshot: [],
      integrityDigest: 'a'.repeat(64),
      reason: 'submit',
      createdByUserId: DESIGN_USER_IDS.priya,
    })
    .onConflictDoNothing()
  await db
    .insert(schema.reviewSubmissions)
    .values({
      id: '00000000-0000-4000-8000-000000000401',
      workspaceId: PROCESS,
      recordId: DESIGN_EXPERIMENTS[0].id,
      revisionId: '00000000-0000-4000-8000-000000000400',
      state: 'submitted',
      workflowDefinitionKey: 'default-review',
      workflowDefinitionVersion: 1,
      assignedReviewerUserIds: [DESIGN_USER_IDS.gareth],
      submittedByUserId: DESIGN_USER_IDS.priya,
      submittedSessionId: 'design-seed',
      submittedRole: 'authenticated',
      submittedAt: new Date(DESIGN_CLOCK.getTime() - 3 * 3_600_000),
      idempotencyKey: 'design-exp-0138-review',
    })
    .onConflictDoNothing()

  // The records Gareth follows (they show as "Following").
  for (const [index, recordId] of [
    DESIGN_EXPERIMENTS[1]?.id,
    DESIGN_EXPERIMENTS[0]?.id,
  ]
    .filter((id): id is string => Boolean(id))
    .entries()) {
    await db
      .insert(schema.workItemFollows)
      .values({
        workspaceId: PROCESS,
        userId: DESIGN_USER_IDS.gareth,
        recordId,
        createdAt: new Date(DESIGN_CLOCK.getTime() - (index + 1) * 600_000),
      })
      .onConflictDoNothing()
  }

  // A failed run of a pipeline Gareth owns (the Pipelines "1 failed" badge).
  await db
    .insert(schema.pipelineDefinitions)
    .values({
      id: '00000000-0000-4000-8000-000000000402',
      workspaceId: PROCESS,
      key: 'full_empty_ratio_from_auc',
      name: 'Full/empty ratio from AUC traces',
      displayId: 'PL-0014',
      createdByUserId: DESIGN_USER_IDS.gareth,
    })
    .onConflictDoNothing()
  await db
    .insert(schema.pipelineDefinitionVersions)
    .values({
      id: '00000000-0000-4000-8000-000000000403',
      definitionId: '00000000-0000-4000-8000-000000000402',
      workspaceId: PROCESS,
      version: 1,
      configuration: {},
    })
    .onConflictDoNothing()
  await db
    .insert(schema.pipelineRuns)
    .values({
      id: '00000000-0000-4000-8000-000000000404',
      workspaceId: PROCESS,
      definitionVersionId: '00000000-0000-4000-8000-000000000403',
      status: 'failed',
      errorCode: 'PL003',
      errorMessage: 'Failed at step 3: out of temporary storage',
      actorUserId: DESIGN_USER_IDS.gareth,
      startedAt: new Date(DESIGN_CLOCK.getTime() - 45 * 60_000),
      finishedAt: new Date(DESIGN_CLOCK.getTime() - 44 * 60_000),
    })
    .onConflictDoNothing()
}

/**
 * DSYS-05.2 — today's schedule the design shows on Home: the Ambr 250 vessel
 * sampling, the plate-reader export and the tech-transfer review.
 */
async function seedDesignBookings(
  db: Parameters<SeedStep['run']>[0],
): Promise<void> {
  await db
    .insert(schema.calendarResources)
    .values({
      id: '00000000-0000-4000-8000-000000000500',
      workspaceId: PROCESS,
      name: 'Ambr 250',
      code: 'AMB-250',
      resourceType: 'instrument',
      location: 'bay 2',
      timezone: 'Europe/London',
      createdByUserId: DESIGN_USER_IDS.gareth,
    })
    .onConflictDoNothing()

  const at = (hours: number, minutes: number) => {
    const date = new Date(DESIGN_CLOCK)
    date.setHours(hours, minutes, 0, 0)
    return date
  }
  const bookings = [
    {
      id: '00000000-0000-4000-8000-000000000501',
      displayId: 'CAL-0911',
      title: 'AMB-25-118 day 6 sampling',
      starts: at(9, 0),
      ends: at(9, 30),
      location: 'Ambr 250 · bay 2',
      linked: DESIGN_EXPERIMENTS[1]?.identifier ?? null,
    },
    {
      id: '00000000-0000-4000-8000-000000000502',
      displayId: 'CAL-0913',
      title: 'ELISA plate 4, capsid titre',
      starts: at(11, 30),
      ends: at(12, 30),
      location: 'Plate reader PR-01',
      linked: DESIGN_EXPERIMENTS[1]?.identifier ?? null,
    },
    {
      id: '00000000-0000-4000-8000-000000000503',
      displayId: 'CAL-0912',
      title: 'Tech-transfer review, CL-017',
      starts: at(14, 0),
      ends: at(15, 0),
      location: null,
      linked: null,
    },
  ]
  for (const booking of bookings) {
    await db
      .insert(schema.calendarBookings)
      .values({
        id: booking.id,
        workspaceId: PROCESS,
        resourceId: '00000000-0000-4000-8000-000000000500',
        title: booking.title,
        status: 'confirmed',
        startsAt: booking.starts,
        endsAt: booking.ends,
        timezone: 'Europe/London',
        location: booking.location,
        displayId: booking.displayId,
        linkedExperimentIdentifier: booking.linked,
        createdByUserId: DESIGN_USER_IDS.gareth,
      })
      .onConflictDoNothing()
  }
}
