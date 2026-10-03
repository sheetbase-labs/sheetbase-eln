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
import { and, eq, sql } from 'drizzle-orm'
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
        const properties =
          'properties' in sample ? sample.properties : undefined
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
            ...(properties ? { properties } : {}),
            createdByUserId: DESIGN_USER_IDS.gareth,
          })
          .onConflictDoUpdate({
            target: [schema.records.projectId, schema.records.identifier],
            set: {
              title: sample.title,
              status: sample.status,
              customFields: sample.customFields,
              ...(properties ? { properties } : {}),
              deletedAt: null,
              archivedAt: null,
            },
          })
      }
    },
  },
  {
    name: 'design cell bank model',
    run: async (db) => {
      // A workspace-defined model (ADR-0051): identity first, then its fields
      // and options, then the records whose `custom_fields` those fields
      // validate. The kind guard resolves `cell_bank` through `record_models`.
      await db
        .insert(schema.recordModels)
        .values({
          id: DESIGN_CELL_BANK_MODEL.id,
          workspaceId: PROCESS,
          key: DESIGN_CELL_BANK_MODEL.key,
          name: DESIGN_CELL_BANK_MODEL.name,
          description: DESIGN_CELL_BANK_MODEL.description,
          identifierPrefix: DESIGN_CELL_BANK_MODEL.identifierPrefix,
          lifecycle: DESIGN_CELL_BANK_MODEL.lifecycle,
          currentVersion: DESIGN_CELL_BANK_MODEL.currentVersion,
          createdByUserId: DESIGN_USER_IDS.gareth,
          updatedByUserId: DESIGN_USER_IDS.gareth,
        })
        .onConflictDoUpdate({
          target: [schema.recordModels.workspaceId, schema.recordModels.key],
          set: {
            name: DESIGN_CELL_BANK_MODEL.name,
            description: DESIGN_CELL_BANK_MODEL.description,
            identifierPrefix: DESIGN_CELL_BANK_MODEL.identifierPrefix,
            lifecycle: DESIGN_CELL_BANK_MODEL.lifecycle,
            currentVersion: DESIGN_CELL_BANK_MODEL.currentVersion,
          },
        })

      for (const field of DESIGN_CELL_BANK_FIELDS) {
        await db
          .insert(schema.recordFieldDefinitions)
          .values({
            id: field.id,
            workspaceId: PROCESS,
            kind: DESIGN_CELL_BANK_MODEL.key,
            fieldName: field.fieldName,
            label: field.label,
            displayOrder: field.displayOrder,
            logicalType: field.logicalType,
            nullable: field.nullable,
            unit: field.unit ?? null,
            validation: field.validation ?? {},
            lifecycle: 'active',
            createdByUserId: DESIGN_USER_IDS.gareth,
            ...(field.createdAt ? { createdAt: field.createdAt } : {}),
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
              ...(field.createdAt ? { createdAt: field.createdAt } : {}),
            },
          })
        for (const [index, option] of (field.options ?? []).entries()) {
          await db
            .insert(schema.modelFieldOptions)
            .values({
              definitionId: field.id,
              key: option.key,
              label: option.label,
              displayOrder: index + 1,
              lifecycle: 'active',
            })
            .onConflictDoUpdate({
              target: [
                schema.modelFieldOptions.definitionId,
                schema.modelFieldOptions.key,
              ],
              set: {
                label: option.label,
                displayOrder: index + 1,
                lifecycle: 'active',
              },
            })
        }
      }

      for (const record of DESIGN_CELL_BANK_RECORDS) {
        await db
          .insert(schema.records)
          .values({
            id: record.id,
            workspaceId: PROCESS,
            projectId: DESIGN_PROJECTS[0].id,
            kind: DESIGN_CELL_BANK_MODEL.key,
            identifier: record.identifier,
            title: record.title,
            status: record.status,
            customFields: record.customFields,
            createdAt: record.createdAt,
            createdByUserId: DESIGN_USER_IDS.gareth,
          })
          .onConflictDoUpdate({
            target: [schema.records.projectId, schema.records.identifier],
            set: {
              title: record.title,
              status: record.status,
              customFields: record.customFields,
              createdAt: record.createdAt,
              deletedAt: null,
              archivedAt: null,
            },
          })
      }

      // MDL-02 rules, shown inline by the MDL-04 generated form and enforced
      // by the canonical write/submit paths.
      const rules = [
        {
          id: '00000000-0000-4000-8000-00000000060b',
          name: 'Working banks',
          fieldKeys: ['passage'],
          condition: { field: 'passage', op: 'gt', value: 30 },
          effect: 'warn',
          message: 'Working banks must be at passage 30 or lower',
        },
        {
          id: '00000000-0000-4000-8000-00000000060c',
          name: 'Vials left',
          fieldKeys: ['vials_left'],
          condition: { field: 'vials_left', op: 'lt', value: 0 },
          effect: 'block',
          message: "Vials left can't go below 0",
        },
      ]
      for (const rule of rules) {
        await db
          .insert(schema.modelRules)
          .values({
            id: rule.id,
            workspaceId: PROCESS,
            modelKey: DESIGN_CELL_BANK_MODEL.key,
            name: rule.name,
            fieldKeys: rule.fieldKeys,
            condition: rule.condition,
            effect: rule.effect,
            message: rule.message,
            createdByUserId: DESIGN_USER_IDS.gareth,
          })
          .onConflictDoUpdate({
            target: schema.modelRules.id,
            set: {
              name: rule.name,
              fieldKeys: rule.fieldKeys,
              condition: rule.condition,
              effect: rule.effect,
              message: rule.message,
            },
          })
      }

      // Continue the CB- sequence after the seeded lots, so a new record is
      // CB-0013+ rather than re-issuing an existing identifier.
      const lastNumber = Math.max(
        ...DESIGN_CELL_BANK_RECORDS.map((record) =>
          Number(record.identifier.split('-')[1]),
        ),
      )
      await db.execute(sql`
        INSERT INTO internal.id_sequences (workspace_id, kind, last_number)
        VALUES (${PROCESS}, ${'model:cb'}, ${lastNumber})
        ON CONFLICT (workspace_id, kind)
        DO UPDATE SET last_number = greatest(
          internal.id_sequences.last_number,
          ${lastNumber}
        )
      `)
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
            target: schema.records.id,
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
    name: 'design bench reading rows',
    run: (db) => seedDesignBenchReadingRows(db),
  },
  {
    name: 'design pipelines',
    run: (db) => seedDesignPipelines(db),
  },
  {
    name: 'design analyses',
    run: (db) => seedDesignAnalyses(db),
  },
  {
    name: 'design dataset links and flags',
    run: (db) => seedDesignDatasetFlags(db),
  },
  {
    name: 'design milestones',
    run: (db) => seedDesignMilestones(db),
  },
  {
    name: 'design sample measurements',
    run: (db) => seedDesignMeasurements(db),
  },
  {
    name: 'design experiment results',
    run: (db) => seedDesignResults(db),
  },
  {
    name: 'design protocol training',
    run: (db) => seedDesignProtocolTraining(db),
  },
  {
    name: 'design agents',
    run: (db) => seedDesignAgents(db),
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
  {
    name: 'design project details',
    run: (db) => seedDesignProjectDetails(db),
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
    // DSET/LAB-02 hold data so the hold meter matches the design at the frozen
    // design clock (25 Sep 2026): 5 of 14 days used, use by 04 Oct. Hold fields
    // live in `properties` (guarded by model_base_fields), not custom_fields.
    properties: {
      holdCondition: '2–8 °C',
      holdStartedAt: '2026-09-20T00:00:00Z',
      holdDurationDays: 14,
      holdUntil: '2026-10-04T00:00:00Z',
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
 * MDL-01/MDL-04 — the design "Cell bank" is a workspace-defined record model
 * (ADR-0051), not a built-in kind. `ModelRecords`/`RecordDetail`/`RecordNew`
 * render its records list, detail and generated form; seeding it here gives the
 * dev/design surface real data and lets the record-model routes be checked in
 * the browser. Fields are the canonical `record_field_definitions`; values live
 * in each record's `custom_fields`.
 */
const DESIGN_CELL_BANK_MODEL = {
  id: '00000000-0000-4000-8000-000000000600',
  key: 'cell_bank',
  name: 'Cell bank',
  description:
    'A frozen bank of cells with its passage, storage and release tests.',
  identifierPrefix: 'CB',
  lifecycle: 'published',
  currentVersion: 4,
} as const

const DESIGN_CELL_BANK_FIELDS: ReadonlyArray<{
  id: string
  fieldName: string
  label: string
  displayOrder: number
  logicalType: 'text' | 'integer' | 'decimal' | 'date' | 'category'
  nullable: boolean
  unit?: unknown
  validation?: Record<string, unknown>
  options?: ReadonlyArray<{ key: string; label: string }>
  /** Later than the records below, so the detail "added in a later version"
   * banner has a real example (mycoplasma arrived in model v4). */
  createdAt?: Date
}> = [
  {
    id: '00000000-0000-4000-8000-000000000601',
    fieldName: 'cell_line',
    label: 'Cell line',
    displayOrder: 1,
    logicalType: 'category',
    nullable: false,
    options: [
      { key: 'hek293', label: 'HEK293' },
      { key: 'hek293t', label: 'HEK293T' },
      { key: 'cho_k1', label: 'CHO-K1' },
      { key: 'sf9', label: 'Sf9' },
    ],
  },
  {
    id: '00000000-0000-4000-8000-000000000602',
    fieldName: 'passage',
    label: 'Passage',
    displayOrder: 2,
    logicalType: 'integer',
    nullable: false,
  },
  {
    id: '00000000-0000-4000-8000-000000000603',
    fieldName: 'parent_bank',
    label: 'Parent bank',
    displayOrder: 3,
    logicalType: 'text',
    nullable: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000604',
    fieldName: 'vials',
    label: 'Vials',
    displayOrder: 4,
    logicalType: 'integer',
    nullable: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000605',
    fieldName: 'vials_left',
    label: 'Vials left',
    displayOrder: 5,
    logicalType: 'integer',
    nullable: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000606',
    fieldName: 'location',
    label: 'Location',
    displayOrder: 6,
    logicalType: 'text',
    nullable: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000607',
    fieldName: 'frozen_on',
    label: 'Frozen on',
    displayOrder: 7,
    logicalType: 'date',
    nullable: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000608',
    fieldName: 'sterility',
    label: 'Sterility',
    displayOrder: 8,
    logicalType: 'category',
    nullable: true,
    options: [
      { key: 'negative', label: 'Negative' },
      { key: 'positive', label: 'Positive' },
      { key: 'pending', label: 'Pending' },
    ],
  },
  {
    id: '00000000-0000-4000-8000-000000000609',
    fieldName: 'mycoplasma',
    label: 'Mycoplasma',
    displayOrder: 9,
    logicalType: 'category',
    nullable: true,
    options: [
      { key: 'negative', label: 'Negative' },
      { key: 'positive', label: 'Positive' },
      { key: 'pending', label: 'Pending' },
    ],
    createdAt: new Date('2026-09-19T09:00:00+01:00'),
  },
  {
    id: '00000000-0000-4000-8000-00000000060a',
    fieldName: 'identity_str',
    label: 'Identity (STR)',
    displayOrder: 10,
    logicalType: 'category',
    nullable: true,
    options: [
      { key: 'match_100', label: 'Match, 100 %' },
      { key: 'match', label: 'Match' },
      { key: 'not_done', label: 'Not done' },
    ],
  },
]

const DESIGN_CELL_BANK_RECORDS: ReadonlyArray<{
  id: string
  identifier: string
  title: string
  status: string
  customFields: Record<string, unknown>
  createdAt: Date
}> = [
  {
    id: '00000000-0000-4000-8000-000000000620',
    identifier: 'CB-0006',
    title: 'HEK293 WCB lot 1',
    status: 'Depleted',
    createdAt: new Date('2026-05-02T10:00:00+01:00'),
    customFields: {
      cell_line: 'hek293',
      passage: 12,
      vials: 50,
      vials_left: 0,
      location: null,
      frozen_on: '2026-05-02',
      sterility: 'negative',
      mycoplasma: 'negative',
      identity_str: 'match_100',
    },
  },
  {
    id: '00000000-0000-4000-8000-000000000621',
    identifier: 'CB-0007',
    title: 'CHO-K1 MCB',
    status: 'Quarantine',
    createdAt: new Date('2026-05-20T10:00:00+01:00'),
    customFields: {
      cell_line: 'cho_k1',
      passage: 6,
      vials: 20,
      vials_left: 12,
      location: 'LN2-1 · rack B',
      frozen_on: '2026-05-20',
      sterility: 'negative',
      mycoplasma: 'positive',
      identity_str: 'match',
    },
  },
  {
    id: '00000000-0000-4000-8000-000000000622',
    identifier: 'CB-0008',
    title: 'HEK293T WCB lot 5',
    status: 'Depleted',
    createdAt: new Date('2026-06-05T10:00:00+01:00'),
    customFields: {
      cell_line: 'hek293t',
      passage: 15,
      vials: 40,
      vials_left: 0,
      location: null,
      frozen_on: '2026-06-05',
      sterility: 'negative',
      mycoplasma: 'negative',
      identity_str: 'match_100',
    },
  },
  {
    id: '00000000-0000-4000-8000-000000000623',
    identifier: 'CB-0009',
    title: 'Sf9 WCB lot 1',
    status: 'In review',
    createdAt: new Date('2026-06-24T10:00:00+01:00'),
    customFields: {
      cell_line: 'sf9',
      passage: 20,
      vials: 40,
      vials_left: 22,
      location: 'LN2-2 · rack D',
      frozen_on: '2026-06-24',
      sterility: 'negative',
      mycoplasma: 'pending',
      identity_str: 'match',
    },
  },
  {
    id: '00000000-0000-4000-8000-000000000624',
    identifier: 'CB-0010',
    title: 'HEK293 MCB',
    status: 'Released',
    createdAt: new Date('2026-07-14T10:00:00+01:00'),
    customFields: {
      cell_line: 'hek293',
      passage: 8,
      vials: 20,
      vials_left: 18,
      location: 'LN2-1 · rack A',
      frozen_on: '2026-07-14',
      sterility: 'negative',
      mycoplasma: 'negative',
      identity_str: 'match_100',
    },
  },
  {
    id: '00000000-0000-4000-8000-000000000625',
    identifier: 'CB-0011',
    title: 'HEK293 WCB lot 2',
    status: 'Low stock',
    createdAt: new Date('2026-08-01T10:00:00+01:00'),
    customFields: {
      cell_line: 'hek293',
      passage: 12,
      vials: 50,
      vials_left: 4,
      location: 'LN2-2 · rack C',
      frozen_on: '2026-08-01',
      sterility: 'negative',
      mycoplasma: 'negative',
      identity_str: 'match_100',
    },
  },
  {
    id: '00000000-0000-4000-8000-000000000626',
    identifier: 'CB-0012',
    title: 'HEK293 WCB lot 3',
    status: 'Released',
    createdAt: new Date('2026-08-02T10:00:00+01:00'),
    customFields: {
      cell_line: 'hek293',
      passage: 12,
      parent_bank: 'CB-0010 HEK293 MCB',
      vials: 50,
      vials_left: 31,
      location: 'LN2-2 · rack C',
      frozen_on: '2026-08-02',
      sterility: 'negative',
      identity_str: 'match_100',
    },
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
  /** Canonical field validation wire, e.g. soft `extensions.systemFlags`. */
  validation?: Record<string, unknown>
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

/**
 * MOB-02 — fields for the bench-reading demonstration Dataset. `sample` is the
 * text sample binding the bench flow recognises, `dilution` and `note` are the
 * optional extras, and `capsid_titre` carries the soft out-of-range rule: an
 * above-max value is accepted and gets a `system` flag rather than failing.
 */
const BENCH_READING_FIELDS: ReadonlyArray<DesignDatasetField> = [
  { key: 'sample', label: 'Sample', logicalType: 'text', required: true },
  { key: 'well', label: 'Well', logicalType: 'text' },
  { key: 'dilution', label: 'Dilution', logicalType: 'integer' },
  {
    key: 'capsid_titre',
    label: 'Capsid titre',
    logicalType: 'decimal',
    unit: '×10¹⁰ vg/mL',
    required: true,
    validation: {
      extensions: {
        systemFlags: {
          out_of_range: { min: 0, max: 5.6 },
        },
      },
    },
  },
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
  {
    id: '00000000-0000-4000-8000-00000000038a',
    workspaceId: DESIGN_WORKSPACE_IDS.processDevelopment,
    actorId: DESIGN_USER_IDS.gareth,
    projectId: '00000000-0000-4000-8000-000000000320',
    displayId: 'DS-0320',
    schemaKey: 'bench_reading_elisa',
    schemaName: 'Bench ELISA reading',
    name: 'Bench ELISA, planned plate PR-01',
    description: 'Planned wells a bench reading fills by key',
    fields: BENCH_READING_FIELDS,
    // The planned rows are added by `seedDesignBenchReadingRows` after the
    // Dataset exists, so there is nothing to snapshot here.
    snapshotLabels: [],
    rows: () => [],
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
    validation: field.validation ?? {},
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
           (id, workspace_id, schema_version_id, name, description, primary_project_id, created_by_user_id)
         values ($1,$2,$3,$4,$5,$6,$7)`,
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
 * MOB-02 — the keyed planned rows the bench reading flow fills on seeded data.
 *
 * `seedDesignDatasets` only inserts a Dataset's rows while creating it, so a
 * separate step adds (and re-adds) the planned rows for the bench-reading
 * Dataset. It fills the canonical planned-row model through the same
 * `plan_dataset_row` RPC the product uses and is idempotent: a row whose key
 * already exists — planned or already recorded — is left untouched.
 */
const BENCH_READING_DATASET_ID = '00000000-0000-4000-8000-00000000038a'

const BENCH_READING_PLANNED_KEYS: ReadonlyArray<string> = [
  'SMP-2231',
  'SMP-2232',
  'SMP-2233',
  'SMP-2234',
]

async function seedDesignBenchReadingRows(
  db: Parameters<SeedStep['run']>[0],
): Promise<void> {
  const workspaceId = DESIGN_WORKSPACE_IDS.processDevelopment
  const actorId = DESIGN_USER_IDS.gareth
  await withDesignClaims(db, actorId, workspaceId, async (client) => {
    const dataset = await client.query(
      'select id from api.datasets where id = $1 and lifecycle = $2',
      [BENCH_READING_DATASET_ID, 'active'],
    )
    if ((dataset.rowCount ?? 0) === 0) return

    for (const plannedKey of BENCH_READING_PLANNED_KEYS) {
      const existing = await client.query(
        'select 1 from api.dataset_rows where dataset_id = $1 and planned_key = $2 limit 1',
        [BENCH_READING_DATASET_ID, plannedKey],
      )
      if ((existing.rowCount ?? 0) > 0) continue
      await client.query('select api.plan_dataset_row($1,$2,$3)', [
        BENCH_READING_DATASET_ID,
        DESIGN_CLOCK,
        plannedKey,
      ])
    }
  })
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

/**
 * DSYS-05 / PROJ-01 — the Projects screen's clients and project details, and
 * the per-project experiment counts the list shows. Display ids and client
 * codes match the design verbatim; the extra experiments that reach the exact
 * counts are deterministic and never shown (the list shows the most recent).
 */
interface DesignProjectDetail {
  id: string
  key: string
  title: string
  displayId: string
  clientCode: string | null
  modality: string | null
  stage: string
  lead: string
  status: string
  experiments: number
  archived?: boolean
}

const DESIGN_PROJECT_DETAILS: ReadonlyArray<DesignProjectDetail> = [
  {
    id: '00000000-0000-4000-8000-000000000320',
    key: 'aav9-process-transfer',
    title: 'AAV9 process transfer',
    displayId: 'PRJ-0217',
    clientCode: 'CL-017',
    modality: 'AAV9',
    stage: 'Tech transfer',
    lead: DESIGN_USER_IDS.gareth,
    status: 'in_progress',
    experiments: 14,
  },
  {
    id: '00000000-0000-4000-8000-000000000321',
    key: 'lvv-stability-2-8c',
    title: 'LVV stability, 2–8 °C hold',
    displayId: 'PRJ-0214',
    clientCode: 'CL-009',
    modality: 'LVV',
    stage: 'Process development',
    lead: DESIGN_USER_IDS.priya,
    status: 'in_review',
    experiments: 9,
  },
  {
    id: '00000000-0000-4000-8000-000000000323',
    key: 'car-t-expansion-media-screen',
    title: 'CAR-T expansion media screen',
    displayId: 'PRJ-0211',
    clientCode: 'CL-022',
    modality: 'CAR-T',
    stage: 'Process development',
    lead: DESIGN_USER_IDS.tom,
    status: 'in_progress',
    experiments: 21,
  },
  {
    id: '00000000-0000-4000-8000-000000000328',
    key: 'aav-full-empty-assay-qualification',
    title: 'AAV full/empty assay qualification',
    displayId: 'PRJ-0209',
    clientCode: null,
    modality: 'AAV',
    stage: 'Analytical development',
    lead: DESIGN_USER_IDS.mei,
    status: 'complete',
    experiments: 6,
  },
  {
    id: '00000000-0000-4000-8000-000000000322',
    key: 'ambr-250-perfusion-scale-down',
    title: 'Ambr 250 perfusion scale-down',
    displayId: 'PRJ-0205',
    clientCode: null,
    modality: 'AAV9',
    stage: 'Process development',
    lead: DESIGN_USER_IDS.gareth,
    status: 'in_progress',
    experiments: 18,
  },
  {
    id: '00000000-0000-4000-8000-000000000329',
    key: 'lvv-transfection-optimisation',
    title: 'LVV transfection optimisation',
    displayId: 'PRJ-0203',
    clientCode: 'CL-009',
    modality: 'LVV',
    stage: 'Process development',
    lead: DESIGN_USER_IDS.priya,
    status: 'on_hold',
    experiments: 11,
  },
  {
    id: '00000000-0000-4000-8000-000000000324',
    key: 'hek293-cell-bank-characterisation',
    title: 'HEK293 cell bank characterisation',
    displayId: 'PRJ-0198',
    clientCode: 'CL-014',
    modality: 'HEK293',
    stage: 'Analytical development',
    lead: DESIGN_USER_IDS.mei,
    status: 'in_review',
    experiments: 7,
  },
  {
    id: '00000000-0000-4000-8000-00000000032a',
    key: 'aav8-tff-concentration',
    title: 'AAV8 TFF concentration',
    displayId: 'PRJ-0196',
    clientCode: 'CL-017',
    modality: 'AAV8',
    stage: 'Process development',
    lead: DESIGN_USER_IDS.tom,
    status: 'in_progress',
    experiments: 12,
  },
  {
    id: '00000000-0000-4000-8000-00000000032b',
    key: 'capsid-elisa-method-transfer',
    title: 'Capsid ELISA method transfer',
    displayId: 'PRJ-0192',
    clientCode: 'CL-011',
    modality: 'AAV',
    stage: 'Tech transfer',
    lead: DESIGN_USER_IDS.mei,
    status: 'complete',
    experiments: 5,
  },
  {
    id: '00000000-0000-4000-8000-00000000032c',
    key: 't-cell-activation-reagent-comparison',
    title: 'T-cell activation reagent comparison',
    displayId: 'PRJ-0188',
    clientCode: 'CL-022',
    modality: 'CAR-T',
    stage: 'Process development',
    lead: DESIGN_USER_IDS.tom,
    status: 'complete',
    experiments: 8,
  },
  {
    id: '00000000-0000-4000-8000-00000000032d',
    key: 'plasmid-lot-release-panel',
    title: 'Plasmid lot release panel',
    displayId: 'PRJ-0185',
    clientCode: null,
    modality: 'Plasmid',
    stage: 'QC',
    lead: DESIGN_USER_IDS.priya,
    status: 'in_progress',
    experiments: 4,
  },
  {
    id: '00000000-0000-4000-8000-00000000032e',
    key: 'lvv-downstream-chromatography',
    title: 'LVV downstream chromatography',
    displayId: 'PRJ-0181',
    clientCode: 'CL-009',
    modality: 'LVV',
    stage: 'Process development',
    lead: DESIGN_USER_IDS.gareth,
    status: 'on_hold',
    experiments: 15,
  },
  {
    id: '00000000-0000-4000-8000-000000000330',
    key: 'legacy-aav1-vector-design',
    title: 'AAV1 vector design',
    displayId: 'PRJ-0170',
    clientCode: 'CL-009',
    modality: 'AAV1',
    stage: 'Process development',
    lead: DESIGN_USER_IDS.gareth,
    status: 'in_progress',
    experiments: 2,
    archived: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000331',
    key: 'legacy-lentiviral-titration',
    title: 'Lentiviral titration, old panel',
    displayId: 'PRJ-0168',
    clientCode: null,
    modality: 'LVV',
    stage: 'Analytical development',
    lead: DESIGN_USER_IDS.gareth,
    status: 'in_progress',
    experiments: 1,
    archived: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000332',
    key: 'legacy-gareth-aav9-old',
    title: 'AAV9 process transfer, first campaign',
    displayId: 'PRJ-0165',
    clientCode: 'CL-017',
    modality: 'AAV9',
    stage: 'Tech transfer',
    lead: DESIGN_USER_IDS.gareth,
    status: 'in_progress',
    experiments: 2,
    archived: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000333',
    key: 'legacy-hek293-expansion-old',
    title: 'HEK293 expansion, old media',
    displayId: 'PRJ-0161',
    clientCode: 'CL-014',
    modality: 'HEK293',
    stage: 'Process development',
    lead: DESIGN_USER_IDS.mei,
    status: 'in_progress',
    experiments: 1,
    archived: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000334',
    key: 'legacy-capsid-qc-old',
    title: 'Capsid QC panel, retired',
    displayId: 'PRJ-0159',
    clientCode: 'CL-011',
    modality: 'AAV',
    stage: 'QC',
    lead: DESIGN_USER_IDS.mei,
    status: 'in_review',
    experiments: 2,
    archived: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000335',
    key: 'legacy-tcell-old',
    title: 'T-cell activation, first screen',
    displayId: 'PRJ-0155',
    clientCode: 'CL-022',
    modality: 'CAR-T',
    stage: 'Process development',
    lead: DESIGN_USER_IDS.tom,
    status: 'complete',
    experiments: 1,
    archived: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000336',
    key: 'legacy-plasmid-old',
    title: 'Plasmid release, old lots',
    displayId: 'PRJ-0150',
    clientCode: null,
    modality: 'Plasmid',
    stage: 'QC',
    lead: DESIGN_USER_IDS.priya,
    status: 'complete',
    experiments: 2,
    archived: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000337',
    key: 'legacy-lvv-chromatography-old',
    title: 'LVV chromatography, first resin',
    displayId: 'PRJ-0146',
    clientCode: 'CL-009',
    modality: 'LVV',
    stage: 'Process development',
    lead: DESIGN_USER_IDS.priya,
    status: 'complete',
    experiments: 1,
    archived: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000338',
    key: 'legacy-ambr-old',
    title: 'Ambr 15 scale-down, retired',
    displayId: 'PRJ-0142',
    clientCode: null,
    modality: 'AAV9',
    stage: 'Process development',
    lead: DESIGN_USER_IDS.priya,
    status: 'complete',
    experiments: 2,
    archived: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000339',
    key: 'legacy-aav8-old',
    title: 'AAV8 TFF, pilot',
    displayId: 'PRJ-0138',
    clientCode: 'CL-017',
    modality: 'AAV8',
    stage: 'Process development',
    lead: DESIGN_USER_IDS.tom,
    status: 'complete',
    experiments: 1,
    archived: true,
  },
  {
    id: '00000000-0000-4000-8000-00000000033a',
    key: 'legacy-elisa-old',
    title: 'ELISA method, retired',
    displayId: 'PRJ-0134',
    clientCode: 'CL-011',
    modality: 'AAV',
    stage: 'Analytical development',
    lead: DESIGN_USER_IDS.mei,
    status: 'complete',
    experiments: 2,
    archived: true,
  },
  {
    id: '00000000-0000-4000-8000-00000000033b',
    key: 'legacy-car-t-old',
    title: 'CAR-T expansion, old media',
    displayId: 'PRJ-0130',
    clientCode: 'CL-022',
    modality: 'CAR-T',
    stage: 'Process development',
    lead: DESIGN_USER_IDS.tom,
    status: 'complete',
    experiments: 1,
    archived: true,
  },
]

const DESIGN_CLIENTS = [
  { code: 'CL-009', name: 'Lentigen Therapeutics' },
  { code: 'CL-011', name: 'Capsid Analytics Ltd' },
  { code: 'CL-014', name: 'HEK Biologics' },
  { code: 'CL-017', name: 'AAV Vector Partners' },
  { code: 'CL-022', name: 'T-Cell Engineering Co' },
]

/** Experiments shown by the design's Experiments list, by project. */
const DESIGN_EXPERIMENT_PROJECTS: Record<string, string> = {
  'EXP-0138': '00000000-0000-4000-8000-000000000320',
  'EXP-0142': '00000000-0000-4000-8000-000000000320',
  'EXP-0136': '00000000-0000-4000-8000-000000000320',
  'EXP-0133': '00000000-0000-4000-8000-000000000320',
  'EXP-0145': '00000000-0000-4000-8000-000000000320',
  'EXP-0131': '00000000-0000-4000-8000-000000000321',
  'EXP-0128': '00000000-0000-4000-8000-000000000323',
  'EXP-0126': '00000000-0000-4000-8000-000000000323',
  'EXP-0127': '00000000-0000-4000-8000-000000000323',
  'EXP-0129': '00000000-0000-4000-8000-000000000323',
  'EXP-0132': '00000000-0000-4000-8000-000000000323',
  'EXP-0134': '00000000-0000-4000-8000-000000000323',
  'EXP-0137': '00000000-0000-4000-8000-000000000323',
  'EXP-0141': '00000000-0000-4000-8000-000000000323',
  'EXP-0146': '00000000-0000-4000-8000-000000000323',
  'EXP-0125': '00000000-0000-4000-8000-000000000328',
  'EXP-0140': '00000000-0000-4000-8000-000000000322',
  'EXP-0091': '00000000-0000-4000-8000-000000000322',
  'EXP-0098': '00000000-0000-4000-8000-000000000322',
  'EXP-0117': '00000000-0000-4000-8000-000000000322',
  'EXP-0119': '00000000-0000-4000-8000-000000000322',
  'EXP-0121': '00000000-0000-4000-8000-000000000322',
  'EXP-0123': '00000000-0000-4000-8000-000000000322',
  'EXP-0124': '00000000-0000-4000-8000-000000000322',
  'EXP-0130': '00000000-0000-4000-8000-000000000324',
  'EXP-0144': '00000000-0000-4000-8000-00000000032a',
  'EXP-0139': '00000000-0000-4000-8000-00000000032e',
}

function designPaddingId(projectIndex: number, run: number): string {
  const n = 0x900000 + projectIndex * 100 + run
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
}

async function seedDesignProjectDetails(
  db: Parameters<SeedStep['run']>[0],
): Promise<void> {
  const clientIds = new Map<string, string>()
  for (const client of DESIGN_CLIENTS) {
    const inserted = await db
      .insert(schema.clients)
      .values({
        workspaceId: PROCESS,
        code: client.code,
        name: client.name,
        createdByUserId: DESIGN_USER_IDS.gareth,
      })
      .onConflictDoUpdate({
        target: [schema.clients.workspaceId, schema.clients.code],
        set: { name: client.name },
      })
      .returning({ id: schema.clients.id, code: schema.clients.code })
    for (const row of inserted) clientIds.set(row.code, row.id)
  }

  for (const project of DESIGN_PROJECT_DETAILS) {
    const clientId = project.clientCode
      ? (clientIds.get(project.clientCode) ?? null)
      : null
    await db
      .insert(schema.projects)
      .values({
        id: project.id,
        workspaceId: PROCESS,
        key: project.key,
        title: project.title,
        displayId: project.displayId,
        clientId,
        modality: project.modality,
        stage: project.stage,
        leadUserId: project.lead,
        status: project.status,
        archivedAt: null,
      })
      .onConflictDoUpdate({
        target: [schema.projects.workspaceId, schema.projects.key],
        set: {
          title: project.title,
          displayId: project.displayId,
          clientId,
          modality: project.modality,
          stage: project.stage,
          leadUserId: project.lead,
          status: project.status,
          archivedAt: null,
        },
      })
  }

  for (const [identifier, projectId] of Object.entries(
    DESIGN_EXPERIMENT_PROJECTS,
  )) {
    await db
      .update(schema.records)
      .set({ projectId })
      .where(
        and(
          eq(schema.records.workspaceId, PROCESS),
          eq(schema.records.identifier, identifier),
        ),
      )
  }

  for (const [projectIndex, project] of DESIGN_PROJECT_DETAILS.entries()) {
    const existing = await db
      .select({ id: schema.records.id })
      .from(schema.records)
      .where(
        and(
          eq(schema.records.workspaceId, PROCESS),
          eq(schema.records.projectId, project.id),
          eq(schema.records.kind, 'experiment'),
        ),
      )
    let missing = project.experiments - existing.length
    let run = 0
    while (missing > 0) {
      run += 1
      missing -= 1
      const status =
        project.status === 'complete'
          ? 'approved'
          : project.status === 'in_review'
            ? 'in_review'
            : project.status === 'archived'
              ? 'approved'
              : 'in_progress'
      await db
        .insert(schema.records)
        .values({
          id: designPaddingId(projectIndex, run),
          workspaceId: PROCESS,
          projectId: project.id,
          kind: 'experiment',
          identifier: `EXP-${String(2000 + projectIndex * 100 + run).padStart(4, '0')}`,
          title: `${project.title} · run ${missing + 1}`,
          status,
          createdByUserId: project.lead,
        })
        .onConflictDoNothing()
    }
  }

  // Archive last: records cannot be added to an archived project.
  for (const project of DESIGN_PROJECT_DETAILS) {
    if (!project.archived) continue
    await db
      .update(schema.projects)
      .set({ archivedAt: DESIGN_CLOCK })
      .where(
        and(
          eq(schema.projects.workspaceId, PROCESS),
          eq(schema.projects.id, project.id),
        ),
      )
  }
}

/**
 * Design agents (RM-116/PIPE-01): a workflow, a few operation proposals and a
 * policy, so the Agents surface shows real work. Proposals and the workflow go
 * through their RPCs (idempotent on the key); the policy needs a service
 * credential and a certified signature, both ensured first.
 */
async function seedDesignAgents(
  db: Parameters<SeedStep['run']>[0],
): Promise<void> {
  const workspaceId = DESIGN_WORKSPACE_IDS.processDevelopment
  const actorId = DESIGN_USER_IDS.gareth
  const provenance = {
    agentId: 'exp0142-analyst',
    agentName: 'EXP-0142 analyst',
    tool: { name: 'sheetbase.dataset_schema.draft' },
    model: { provider: 'anthropic', name: 'claude' },
    invocationId: 'seed-invocation',
  }
  const operation = (key: string, name: string) => ({
    kind: 'dataset_schema.create',
    workspaceId,
    key,
    name,
    description: 'Seeded proposal for the demo workspace',
    fields: [],
  })

  // A service credential for the policy (direct: the credentials table has no
  // member-facing create RPC).
  const existingCredential = await db
    .select({ id: schema.apiCredentials.id })
    .from(schema.apiCredentials)
    .where(eq(schema.apiCredentials.workspaceId, workspaceId))
    .limit(1)
  let credentialId = existingCredential[0]?.id
  if (!credentialId) {
    const inserted = await db
      .insert(schema.apiCredentials)
      .values({
        workspaceId,
        displayPrefix: 'sb_seed_demo',
        secretHash: 'seed',
        name: 'Seed agent credential',
        scopes: ['agent_operations:write'],
        createdByUserId: actorId,
      })
      .returning({ id: schema.apiCredentials.id })
    credentialId = inserted[0]?.id
  }

  await withDesignClaims(db, actorId, workspaceId, async (client) => {
    await client.query('select api.certify_signature($1, 1)', [workspaceId])

    const hasWorkflow = await client.query(
      `select 1 from api.agent_workflows where workspace_id = $1 and idempotency_key = 'seed-workflow-1' limit 1`,
      [workspaceId],
    )
    if ((hasWorkflow.rowCount ?? 0) === 0) {
      await client.query(
        `select api.create_agent_workflow($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7)`,
        [
          workspaceId,
          'Review the clarification step-yield runs and propose a figure.',
          JSON.stringify({
            formatVersion: '1',
            steps: [
              {
                key: 'read_runs',
                title: 'Read the runs',
                summary: 'Read the clarification runs and their outputs.',
                tool: 'sheetbase.dataset_schema.draft',
                inputReferences: [],
                operation: operation('wf_step_one', 'Workflow step one'),
              },
              {
                key: 'propose_figure',
                title: 'Propose the figure',
                summary: 'Propose an updated step-yield figure for review.',
                tool: 'sheetbase.dataset_schema.draft',
                inputReferences: [],
                operation: operation('wf_step_two', 'Workflow step two'),
              },
            ],
          }),
          JSON.stringify({
            maxOperations: 10,
            maxTokens: 200000,
            maxCostMicrousd: 5000000,
          }),
          JSON.stringify({ tokens: 0, costMicrousd: 0 }),
          JSON.stringify(provenance),
          'seed-workflow-1',
        ],
      )
    }

    const proposals = [
      {
        key: 'seed-proposal-1',
        title: 'Add an AAV9 release model',
        summary:
          'Define the AAV9 release dataset schema with the standard fields.',
        operation: operation('aav9_release', 'AAV9 release'),
      },
      {
        key: 'seed-proposal-2',
        title: 'Add a clarity release model',
        summary: 'Define a clarity release schema for the QC hand-off.',
        operation: operation('clarity_release', 'Clarity release'),
      },
    ]
    for (const p of proposals) {
      const existing = await client.query(
        'select 1 from api.agent_operation_proposals where workspace_id = $1 and idempotency_key = $2 limit 1',
        [workspaceId, p.key],
      )
      if ((existing.rowCount ?? 0) > 0) continue
      await client.query(
        `select api.propose_agent_operation($1,$2,$3,$4::jsonb,$5::jsonb,$6)`,
        [
          workspaceId,
          p.title,
          p.summary,
          JSON.stringify(p.operation),
          JSON.stringify(provenance),
          p.key,
        ],
      )
    }

    if (credentialId) {
      const hasPolicy = await client.query(
        `select 1 from api.agent_operation_policies where workspace_id = $1 and name = 'Dataset schema drafting' limit 1`,
        [workspaceId],
      )
      if ((hasPolicy.rowCount ?? 0) === 0) {
        await client.query(
          `select api.create_agent_operation_policy($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
          [
            workspaceId,
            'Dataset schema drafting',
            'dataset_schema.create',
            'workspace',
            null,
            credentialId,
            '{}',
            'Seeded for the demo workspace',
            'Authored',
          ],
        )
      }
    }
  })
}

/**
 * Design protocol training (RM-104): record who is trained on a design
 * protocol, so the protocol Training tab shows a real list.
 */
async function seedDesignProtocolTraining(
  db: Parameters<SeedStep['run']>[0],
): Promise<void> {
  const workspaceId = DESIGN_WORKSPACE_IDS.processDevelopment
  const actorId = DESIGN_USER_IDS.gareth
  await withDesignClaims(db, actorId, workspaceId, async (client) => {
    const protocol = DESIGN_PROTOCOLS.at(0)
    if (!protocol) return

    // A controlled document: the record's rich-text blocks.
    const hasDoc = await client.query(
      'select 1 from api.blocks where record_id = $1 limit 1',
      [protocol.id],
    )
    if ((hasDoc.rowCount ?? 0) === 0) {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Purpose' }],
          },
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Transfect HEK293 cells with the PEI:DNA complex and record viability and titre at 72 h.',
              },
            ],
          },
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Procedure' }],
          },
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Seed 3 × 10⁵ cells/mL, add the complex at a 1:3 ratio, then sample daily for viability.',
              },
            ],
          },
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Acceptance criteria' }],
          },
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Viability ≥ 90 % and titre within 20 % of the reference batch.',
              },
            ],
          },
        ],
      }
      await client.query(
        `insert into api.blocks
           (record_id, type, payload, payload_schema_version, "order", version, created_by_user_id)
         values ($1,'rich_text',$2::jsonb,1,1,1,$3)`,
        [protocol.id, JSON.stringify({ doc }), actorId],
      )
    }

    const records = [
      { user: DESIGN_USER_IDS.priya, status: 'trained' },
      { user: DESIGN_USER_IDS.mei, status: 'trained' },
      { user: DESIGN_USER_IDS.tom, status: 'required' },
    ]
    for (const t of records) {
      await client.query('select api.record_protocol_training($1,$2,$3)', [
        protocol.id,
        t.user,
        t.status,
      ])
    }
  })
}

/**
 * Design experiment results (RM-118): record a decision on a design experiment
 * and cite one of the design analyses into it, so the Results tab shows a
 * figure and a decision instead of empty sections.
 */
async function seedDesignResults(
  db: Parameters<SeedStep['run']>[0],
): Promise<void> {
  const workspaceId = DESIGN_WORKSPACE_IDS.processDevelopment
  const actorId = DESIGN_USER_IDS.gareth
  await withDesignClaims(db, actorId, workspaceId, async (client) => {
    const experiment = DESIGN_EXPERIMENTS.at(0)
    if (!experiment) return

    const hasDecision = await client.query(
      'select decision from api.records where id = $1',
      [experiment.id],
    )
    if (hasDecision.rows[0]?.decision == null) {
      await client.query(
        `select api.set_experiment_decision($1,'supported','Titre met the release criterion across all three trains.')`,
        [experiment.id],
      )
    }

    const hasFigure = await client.query(
      `select 1 from api.record_links where source_record_id = $1 and link_type = 'analysis' limit 1`,
      [experiment.id],
    )
    if ((hasFigure.rowCount ?? 0) === 0) {
      await client.query(
        `insert into api.record_links
           (source_record_id, target_kind, target_identifier, link_type, created_by_user_id)
         values ($1,'analysis','AN-0001','analysis',$2)
         on conflict (source_record_id, target_identifier, link_type) do nothing`,
        [experiment.id, actorId],
      )
    }
  })
}

/**
 * Design sample measurements (RM-112): a few recorded values on the design
 * samples, so the sample Measurements tab shows a table instead of an empty
 * state.
 */
async function seedDesignMeasurements(
  db: Parameters<SeedStep['run']>[0],
): Promise<void> {
  const workspaceId = DESIGN_WORKSPACE_IDS.processDevelopment
  const actorId = DESIGN_USER_IDS.gareth
  await withDesignClaims(db, actorId, workspaceId, async (client) => {
    const defs = [
      { name: 'Capsid titre', value: 4.6e12, unit: 'vg/mL', method: 'ddPCR' },
      { name: 'Viability', value: 92.4, unit: '%', method: 'Vi-CELL' },
      { name: 'Turbidity', value: 14.2, unit: 'NTU', method: 'Benedict' },
    ]
    for (const sample of DESIGN_SAMPLES.slice(0, 5)) {
      for (const d of defs.slice(0, 2)) {
        const existing = await client.query(
          'select 1 from api.sample_measurements where sample_record_id = $1 and name = $2 limit 1',
          [sample.id, d.name],
        )
        if ((existing.rowCount ?? 0) > 0) continue
        await client.query(
          'select api.record_sample_measurement($1,$2,$3,$4,$5)',
          [sample.id, d.name, d.value, d.unit, d.method],
        )
      }
    }
  })
}

/**
 * Design milestones (PROJ-02): study_tasks of type milestone with their
 * "done when" deliverables, so the project Milestones tab shows a timeline and
 * list instead of an empty state. One is complete, one in progress, one not
 * started.
 */
async function seedDesignMilestones(
  db: Parameters<SeedStep['run']>[0],
): Promise<void> {
  const workspaceId = DESIGN_WORKSPACE_IDS.processDevelopment
  const projectId = DESIGN_PROJECTS[0]?.id
  if (!projectId) return

  const milestones = [
    {
      id: '00000000-0000-4000-8000-000000001c00',
      title: 'Process parameters locked',
      status: 'in_progress',
      dueAt: '2026-10-16T00:00:00Z',
      progress: 50,
      position: 0,
      deliverables: [
        {
          id: '00000000-0000-4000-8000-000000001c10',
          name: 'Operating ranges agreed',
          status: 'delivered',
        },
        {
          id: '00000000-0000-4000-8000-000000001c11',
          name: 'QA sign-off',
          status: 'planned',
        },
      ],
    },
    {
      id: '00000000-0000-4000-8000-000000001c01',
      title: 'Engineering run complete',
      status: 'completed',
      dueAt: '2026-11-06T00:00:00Z',
      progress: 100,
      position: 1,
      deliverables: [
        {
          id: '00000000-0000-4000-8000-000000001c12',
          name: 'Engineering batch released',
          status: 'delivered',
        },
      ],
    },
    {
      id: '00000000-0000-4000-8000-000000001c02',
      title: 'Technology transfer pack',
      status: 'not_started',
      dueAt: '2026-12-04T00:00:00Z',
      progress: 0,
      position: 2,
      deliverables: [
        {
          id: '00000000-0000-4000-8000-000000001c13',
          name: 'Transfer protocol signed',
          status: 'planned',
        },
        {
          id: '00000000-0000-4000-8000-000000001c14',
          name: 'Receiving site walkthrough',
          status: 'planned',
        },
      ],
    },
  ] as const

  for (const m of milestones) {
    await db
      .insert(schema.studyTasks)
      .values({
        id: m.id,
        workspaceId,
        projectId,
        title: m.title,
        taskType: 'milestone',
        status: m.status,
        priority: 'medium',
        dueAt: new Date(m.dueAt),
        position: m.position,
        progressPercent: m.progress,
      })
      .onConflictDoUpdate({
        target: schema.studyTasks.id,
        set: { title: m.title, status: m.status },
      })
    for (const d of m.deliverables) {
      await db
        .insert(schema.studyDeliverables)
        .values({
          id: d.id,
          workspaceId,
          taskId: m.id,
          name: d.name,
          status: d.status,
        })
        .onConflictDoUpdate({
          target: schema.studyDeliverables.id,
          set: { name: d.name, status: d.status },
        })
    }
  }
}

/**
 * Link design experiments to the datasets they produced and flag a few
 * recorded values, so the experiments list's "Open issues" column shows real
 * counts (RM-119) instead of an empty one.
 */
async function seedDesignDatasetFlags(
  db: Parameters<SeedStep['run']>[0],
): Promise<void> {
  const workspaceId = DESIGN_WORKSPACE_IDS.processDevelopment
  const actorId = DESIGN_USER_IDS.gareth
  await withDesignClaims(db, actorId, workspaceId, async (client) => {
    const datasets = DESIGN_DATASETS.slice(0, 2)
    const experiments = DESIGN_EXPERIMENTS
    if (datasets.length === 0 || experiments.length === 0) return

    for (let d = 0; d < datasets.length; d++) {
      const dataset = datasets[d]
      const meta = await client.query(
        'select display_id from api.datasets where id = $1',
        [dataset.id],
      )
      const displayId: string | undefined = meta.rows[0]?.display_id
      if (!displayId) continue

      // Link a slice of the design experiments to this dataset.
      const linked = experiments.slice(d * 2, d * 2 + 3)
      for (const exp of linked) {
        await client.query(
          `insert into api.record_links
             (source_record_id, target_kind, target_identifier, link_type,
              created_by_user_id)
           values ($1,'dataset',$2,'dataset',$3)
           on conflict (source_record_id, target_identifier, link_type)
             do nothing`,
          [exp.id, displayId, actorId],
        )
      }

      // Flag a couple of recorded values as open issues.
      const rows = await client.query(
        'select id from api.dataset_rows where dataset_id = $1 order by id limit 3',
        [dataset.id],
      )
      const fields = await client.query(
        `select f.field_id from api.dataset_schema_version_fields f
           join api.dataset_schema_versions v on v.id = f.schema_version_id
           join api.dataset_schema_definitions s on s.id = v.schema_id
          where s.workspace_id = $1 and s.key = $2
          order by f.display_order`,
        [workspaceId, dataset.schemaKey],
      )
      const fieldIds: string[] = fields.rows.map(
        (r: { field_id: string }) => r.field_id,
      )
      const flagField = fieldIds[Math.min(3, fieldIds.length - 1)]
      if (!flagField) continue

      for (let i = 0; i < Math.min(rows.rows.length, 2); i++) {
        const rowId: string = rows.rows[i].id
        const existing = await client.query(
          `select 1 from api.dataset_value_flags
            where dataset_id = $1 and row_id = $2 and field_id = $3
              and cleared_at is null`,
          [dataset.id, rowId, flagField],
        )
        if ((existing.rowCount ?? 0) > 0) continue
        await client.query('select api.flag_dataset_value($1,$2,$3,$4,$5,$6)', [
          dataset.id,
          rowId,
          flagField,
          i === 0 ? 'out_of_range' : 'missing_unit',
          i === 0
            ? 'Value outside the expected range'
            : 'Unit missing on the recorded value',
          null,
        ])
      }
    }
  })
}

/**
 * Design analyses: saved analysis views over the design datasets, so the
 * Analysis Studio shows charts to inspect instead of an empty list. The specs
 * are built from the datasets' real schema fields.
 */
async function seedDesignAnalyses(
  db: Parameters<SeedStep['run']>[0],
): Promise<void> {
  const workspaceId = DESIGN_WORKSPACE_IDS.processDevelopment
  const actorId = DESIGN_USER_IDS.gareth
  await withDesignClaims(db, actorId, workspaceId, async (client) => {
    const fields = await client.query(
      `select f.field_id, f.key from api.dataset_schema_version_fields f
         join api.dataset_schema_versions v on v.id = f.schema_version_id
         join api.dataset_schema_definitions d on d.id = v.schema_id
        where d.workspace_id = $1 and d.key = $2`,
      [workspaceId, 'ambr_250_daily_reading'],
    )
    const fieldId = new Map<string, string>(
      fields.rows.map((r: { key: string; field_id: string }) => [
        r.key,
        r.field_id,
      ]),
    )
    const datasetId = DESIGN_DATASETS[0]?.id
    const x = fieldId.get('day')
    const y = fieldId.get('vcd')
    const viability = fieldId.get('viability')
    const glucose = fieldId.get('glucose')
    const lactate = fieldId.get('lactate')
    const series = fieldId.get('vessel')
    if (!datasetId || !x || !y || !series) return

    const view = (
      type: 'line' | 'scatter',
      yId: string,
      xId: string,
      name: string,
      xLabel: string,
      yLabel: string,
    ) => ({
      name,
      spec: {
        specVersion: 1,
        type,
        datasets: [{ datasetId }],
        fields: {
          x: { fieldId: xId },
          y: { fieldId: yId },
          series: { fieldId: series },
          color: null,
          size: null,
          facet: null,
        },
        filters: [],
        transformations: [],
        typeParams: {},
        display: {
          axes: {
            x: { label: xLabel, scale: 'linear' },
            y: { label: yLabel, scale: 'linear' },
          },
          series: [],
        },
        overlays: { errorBars: null },
      },
    })

    const views = [
      view('line', y, x, 'VCD by day', 'Day', 'VCD (10⁶ cells/mL)'),
      viability
        ? view('line', viability, x, 'Viability over time', 'Day', 'Viability')
        : null,
      glucose && lactate
        ? view(
            'scatter',
            lactate,
            glucose,
            'Glucose vs lactate',
            'Glucose',
            'Lactate',
          )
        : null,
    ].filter((v): v is NonNullable<typeof v> => Boolean(v))

    for (const v of views) {
      await client.query(
        `insert into api.analysis_views
           (workspace_id, owner_user_id, name, spec, source_revisions)
         values ($1,$2,$3,$4::jsonb,'[]'::jsonb)
         on conflict (workspace_id, owner_user_id, name)
           do update set spec = excluded.spec`,
        [workspaceId, actorId, v.name, JSON.stringify(v.spec)],
      )
    }
  })
}

/**
 * Design pipelines: real definitions with a published version and a short run
 * history, so the Pipelines area shows the design's pipelines (some succeeded,
 * one failed), not an empty board.
 */
async function seedDesignPipelines(
  db: Parameters<SeedStep['run']>[0],
): Promise<void> {
  const workspaceId = DESIGN_WORKSPACE_IDS.processDevelopment
  const actorId = DESIGN_USER_IDS.gareth
  await withDesignClaims(db, actorId, workspaceId, async (client) => {
    const sv = await client.query(
      `select v.id from api.dataset_schema_versions v
         join api.dataset_schema_definitions d on d.id = v.schema_id
        where d.workspace_id = $1 and d.key = $2
        order by v.version desc limit 1`,
      [workspaceId, 'ambr_250_daily_reading'],
    )
    const schemaVersionId: string | undefined = sv.rows[0]?.id
    if (!schemaVersionId) return

    const dv = await client.query(
      `select v.id from api.dataset_versions v
         join api.datasets d on d.id = v.dataset_id
        where d.workspace_id = $1
        order by v.created_at desc limit 1`,
      [workspaceId],
    )
    const inputVersionId: string | undefined = dv.rows[0]?.id

    const pipelines = [
      {
        key: 'clarification_step_yield',
        name: 'Clarification step yield',
        description:
          'Joins ELISA titre to the filter runs, calculates step yield per load, fits it and proposes an updated figure in EXP-0142.',
        statement: 'SELECT batch, load, step_yield FROM measurements',
        runs: 1,
        failed: 0,
      },
      {
        key: 'weekly_stability_summary',
        name: 'Weekly stability summary',
        description:
          'Summarises the stability pull results and writes a table back to the study notebook.',
        statement: 'SELECT timepoint, monomer FROM measurements',
        runs: 1,
        failed: 0,
      },
      {
        key: 'plate_reader_pr_01_export',
        name: 'Plate reader PR-01 export',
        description:
          'Imports the plate reader export, checks the units and snapshots the dataset.',
        statement: 'SELECT well, value FROM measurements',
        runs: 1,
        failed: 1,
      },
      {
        key: 'aex_screen_summary',
        name: 'AEX screen summary',
        description:
          'Summarises the AEX fraction screen into a table the process team can cite.',
        statement: 'SELECT fraction, yield FROM measurements',
        runs: 1,
        failed: 0,
      },
    ] as const

    for (const p of pipelines) {
      const existing = await client.query(
        'select id from api.pipeline_definitions where workspace_id = $1 and key = $2',
        [workspaceId, p.key],
      )
      let definitionId: string = existing.rows[0]?.id
      if (!definitionId) {
        const created = await client.query(
          'select * from api.create_pipeline_definition($1,$2,$3,$4)',
          [workspaceId, p.key, p.name, p.description],
        )
        definitionId = created.rows[0].id
      }

      const versions = await client.query(
        'select id, lifecycle from api.pipeline_definition_versions where definition_id = $1 order by version desc',
        [definitionId],
      )
      let versionId: string | undefined = versions.rows.find(
        (r) => r.lifecycle === 'published',
      )?.id
      if (!versionId) {
        const configuration = {
          configVersion: 1,
          description: p.description,
          inputs: [{ name: 'measurements', required: false }],
          transform: { language: 'sql', statement: p.statement },
          output: {
            mode: 'create',
            schemaVersionId,
            datasetName: p.name,
            datasetLabel: 'pipeline output',
            fieldMapping: null,
          },
        }
        const created = await client.query(
          'select * from api.create_pipeline_definition_version($1,$2,$3::jsonb)',
          [workspaceId, definitionId, JSON.stringify(configuration)],
        )
        versionId = created.rows[0].id
        await client.query(
          'select api.publish_pipeline_definition_version($1,$2)',
          [workspaceId, versionId],
        )
      }

      const runCount = await client.query(
        'select count(*)::int as n from api.pipeline_runs where definition_version_id = $1',
        [versionId],
      )
      if (runCount.rows[0].n === 0 && inputVersionId) {
        for (let i = 0; i < p.runs; i++) {
          const started = await client.query(
            'select * from api.start_pipeline_run($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)',
            [
              workspaceId,
              versionId,
              i === 0 ? 'manual' : 'scheduled',
              '{}',
              JSON.stringify({ measurements: inputVersionId }),
              null,
              i === 0 ? null : `seed:${p.key}:${i}`,
            ],
          )
          const runId = started.rows[0].id
          if (i >= p.runs - p.failed) {
            await client.query('select api.fail_pipeline_run($1,$2,$3,$4)', [
              workspaceId,
              runId,
              'SB070',
              'Step failed: input column missing',
            ])
          } else {
            await client.query(
              'select api.complete_pipeline_run($1,$2,$3::jsonb)',
              [workspaceId, runId, '{}'],
            )
          }
        }
      }

      // A schedule for the first two pipelines.
      if (p.key === 'clarification_step_yield') {
        const hasSchedule = await client.query(
          'select 1 from api.pipeline_schedules where definition_id = $1 limit 1',
          [definitionId],
        )
        if ((hasSchedule.rowCount ?? 0) === 0) {
          await client.query(
            `select api.create_pipeline_schedule($1,$2,'daily',$3::jsonb,true)`,
            [
              workspaceId,
              definitionId,
              JSON.stringify({ time: '09:10', timezone: 'Europe/London' }),
            ],
          )
        }
      }
    }
  })
}
