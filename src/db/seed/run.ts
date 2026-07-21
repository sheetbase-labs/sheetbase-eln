/**
 * Seed runner. See docs/seeds.md.
 *
 * Usage:
 *   pnpm db:seed        minimal fixtures only (safe for tests to assume absent)
 *   pnpm db:seed --demo fixtures plus the Virus Stability demonstration data
 *
 * Every step must be idempotent: upsert on a natural or stable key so reruns
 * converge instead of duplicating. Steps are added here as schema lands
 * (identity/workspace/project steps arrive with API-003).
 */
import { config } from 'dotenv'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'

import * as schema from '../schema'
import {
  DEMO_BLOCK_IDS,
  DEMO_ARCHIVED_SAMPLE_IDENTIFIER,
  DEMO_ARCHIVED_SAMPLE_RECORD_ID,
  DEMO_FIELD_DEFINITION_IDS,
  DEMO_REAGENT_IDENTIFIER,
  DEMO_REAGENT_RECORD_ID,
  DEMO_SAMPLE_IDENTIFIER,
  DEMO_SAMPLE_RECORD_ID,
  DEMO_VIRUS_STABILITY_PROJECT_ID,
  DEMO_VIRUS_STABILITY_PROJECT_KEY,
  DEMO_VIRUS_STABILITY_PROTOCOL_IDENTIFIER,
  DEMO_VIRUS_STABILITY_PROTOCOL_RECORD_ID,
  DEMO_VIRUS_STABILITY_RECORD_ID,
  DEMO_VIRUS_STABILITY_RECORD_IDENTIFIER,
  FIXTURE_PROJECT_ID,
  FIXTURE_PROJECT_KEY,
  FIXTURE_USER_EMAIL,
  FIXTURE_USER_ID,
  FIXTURE_WORKSPACE_ID,
  FIXTURE_WORKSPACE_SLUG,
} from './identities'

config({ path: ['.env.local', '.env'] })

export interface SeedStep {
  name: string
  run: (db: ReturnType<typeof createDb>) => Promise<void>
}

function createDb(databaseUrl: string) {
  return drizzle(databaseUrl, { schema })
}

/**
 * Minimal fixtures: the stable initial user, workspace and project from
 * src/db/seed/identities.ts. Integration tests may assume these exist after
 * `pnpm db:seed`, but tests must still create their own isolated data rather
 * than mutating fixture rows.
 */
export const fixtureSteps: Array<SeedStep> = [
  {
    name: 'fixture user',
    run: async (db) => {
      await db
        .insert(schema.user)
        .values({
          id: FIXTURE_USER_ID,
          name: 'Fixture Owner',
          email: FIXTURE_USER_EMAIL,
          emailVerified: true,
        })
        .onConflictDoUpdate({
          target: schema.user.id,
          set: { name: 'Fixture Owner', email: FIXTURE_USER_EMAIL },
        })
    },
  },
  {
    name: 'fixture workspace',
    run: async (db) => {
      await db
        .insert(schema.workspaces)
        .values({
          id: FIXTURE_WORKSPACE_ID,
          slug: FIXTURE_WORKSPACE_SLUG,
          name: 'Fixture Workspace',
        })
        .onConflictDoUpdate({
          target: schema.workspaces.id,
          set: { slug: FIXTURE_WORKSPACE_SLUG, name: 'Fixture Workspace' },
        })
    },
  },
  {
    name: 'fixture owner membership',
    run: async (db) => {
      await db
        .insert(schema.workspaceMemberships)
        .values({
          workspaceId: FIXTURE_WORKSPACE_ID,
          userId: FIXTURE_USER_ID,
          role: 'owner',
        })
        .onConflictDoUpdate({
          target: [
            schema.workspaceMemberships.workspaceId,
            schema.workspaceMemberships.userId,
          ],
          set: { role: 'owner' },
        })
    },
  },
  {
    name: 'fixture project',
    run: async (db) => {
      await db
        .insert(schema.projects)
        .values({
          id: FIXTURE_PROJECT_ID,
          workspaceId: FIXTURE_WORKSPACE_ID,
          key: FIXTURE_PROJECT_KEY,
          title: 'Fixture Project',
        })
        .onConflictDoUpdate({
          target: [schema.projects.workspaceId, schema.projects.key],
          set: { title: 'Fixture Project' },
        })
    },
  },
]

/**
 * Demonstration data: the Virus Stability example. Richer and slower than
 * fixtures; for humans exploring the product, never for test assertions.
 */
export const demoSteps: Array<SeedStep> = [
  {
    name: 'demo project: Lentivector Stability Study',
    run: async (db) => {
      await db
        .insert(schema.projects)
        .values({
          id: DEMO_VIRUS_STABILITY_PROJECT_ID,
          workspaceId: FIXTURE_WORKSPACE_ID,
          key: DEMO_VIRUS_STABILITY_PROJECT_KEY,
          title: 'Lentivector Stability Study',
        })
        .onConflictDoUpdate({
          target: [schema.projects.workspaceId, schema.projects.key],
          set: { title: 'Lentivector Stability Study' },
        })
    },
  },
  {
    name: 'demo field definitions: sample and reagent properties',
    run: async (db) => {
      const defs = [
        {
          id: DEMO_FIELD_DEFINITION_IDS.sampleConstruct,
          kind: 'sample' as const,
          fieldName: 'construct',
          label: 'Construct',
          displayOrder: 1,
          logicalType: 'text' as const,
          nullable: false,
        },
        {
          id: DEMO_FIELD_DEFINITION_IDS.sampleBatch,
          kind: 'sample' as const,
          fieldName: 'batch',
          label: 'Batch',
          displayOrder: 2,
          logicalType: 'text' as const,
          nullable: false,
        },
        {
          id: DEMO_FIELD_DEFINITION_IDS.sampleConcentration,
          kind: 'sample' as const,
          fieldName: 'concentration',
          label: 'Concentration',
          displayOrder: 3,
          logicalType: 'decimal' as const,
          nullable: true,
          unit: { symbol: 'copies/mL' },
        },
        {
          id: DEMO_FIELD_DEFINITION_IDS.sampleStorage,
          kind: 'sample' as const,
          fieldName: 'storage',
          label: 'Storage',
          displayOrder: 4,
          logicalType: 'category' as const,
          nullable: true,
          validation: { enum: ['-80 °C', '-20 °C', '4 °C', 'ambient'] },
        },
        {
          id: DEMO_FIELD_DEFINITION_IDS.reagentSupplier,
          kind: 'reagent' as const,
          fieldName: 'supplier',
          label: 'Supplier',
          displayOrder: 1,
          logicalType: 'text' as const,
          nullable: true,
        },
        {
          id: DEMO_FIELD_DEFINITION_IDS.reagentCatalogNo,
          kind: 'reagent' as const,
          fieldName: 'catalog_no',
          label: 'Catalog No.',
          displayOrder: 2,
          logicalType: 'text' as const,
          nullable: true,
        },
        {
          id: DEMO_FIELD_DEFINITION_IDS.reagentLot,
          kind: 'reagent' as const,
          fieldName: 'lot',
          label: 'Lot',
          displayOrder: 3,
          logicalType: 'text' as const,
          nullable: true,
        },
        {
          id: DEMO_FIELD_DEFINITION_IDS.reagentExpiry,
          kind: 'reagent' as const,
          fieldName: 'expiry',
          label: 'Expiry',
          displayOrder: 4,
          logicalType: 'date' as const,
          nullable: true,
        },
        {
          id: DEMO_FIELD_DEFINITION_IDS.reagentQuantity,
          kind: 'reagent' as const,
          fieldName: 'quantity',
          label: 'Quantity',
          displayOrder: 5,
          logicalType: 'decimal' as const,
          nullable: true,
        },
        {
          id: DEMO_FIELD_DEFINITION_IDS.reagentUnit,
          kind: 'reagent' as const,
          fieldName: 'unit',
          label: 'Unit',
          displayOrder: 6,
          logicalType: 'category' as const,
          nullable: true,
          validation: { enum: ['mL', 'µL', 'reactions'] },
        },
        {
          id: DEMO_FIELD_DEFINITION_IDS.reagentStorage,
          kind: 'reagent' as const,
          fieldName: 'storage',
          label: 'Storage',
          displayOrder: 7,
          logicalType: 'category' as const,
          nullable: true,
          validation: { enum: ['-80 °C', '-20 °C', '4 °C', 'ambient'] },
        },
      ] as const

      for (const def of defs) {
        await db
          .insert(schema.recordFieldDefinitions)
          .values({
            id: def.id,
            workspaceId: FIXTURE_WORKSPACE_ID,
            kind: def.kind,
            fieldName: def.fieldName,
            label: def.label,
            displayOrder: def.displayOrder,
            logicalType: def.logicalType,
            nullable: def.nullable,
            unit: 'unit' in def ? def.unit : null,
            validation: 'validation' in def ? def.validation : {},
            createdByUserId: FIXTURE_USER_ID,
          })
          .onConflictDoUpdate({
            target: [
              schema.recordFieldDefinitions.workspaceId,
              schema.recordFieldDefinitions.kind,
              schema.recordFieldDefinitions.fieldName,
            ],
            set: {
              label: def.label,
              displayOrder: def.displayOrder,
              logicalType: def.logicalType,
              nullable: def.nullable,
              lifecycle: 'active',
            },
          })
      }
    },
  },
  {
    name: 'demo sample: LVV-CAR-T drug substance',
    run: async (db) => {
      await db
        .insert(schema.records)
        .values({
          id: DEMO_SAMPLE_RECORD_ID,
          workspaceId: FIXTURE_WORKSPACE_ID,
          projectId: DEMO_VIRUS_STABILITY_PROJECT_ID,
          kind: 'sample',
          identifier: DEMO_SAMPLE_IDENTIFIER,
          title: 'LVV-CAR-T drug substance',
          status: 'available',
          tags: ['LVV-CAR-T', 'drug-substance'],
          properties: {
            construct: 'LVV-CAR-T',
            batch: 'LVV-250601',
            concentration: 2.31e7,
            storage: '4 °C',
          },
          createdByUserId: FIXTURE_USER_ID,
        })
        .onConflictDoUpdate({
          target: [schema.records.projectId, schema.records.identifier],
          set: {
            title: 'LVV-CAR-T drug substance',
            status: 'available',
            tags: ['LVV-CAR-T', 'drug-substance'],
            properties: {
              construct: 'LVV-CAR-T',
              batch: 'LVV-250601',
              concentration: 2.31e7,
              storage: '4 °C',
            },
            deletedAt: null,
            archivedAt: null,
          },
        })
    },
  },
  {
    name: 'demo archived sample: expired LVV reference lot',
    run: async (db) => {
      // Insert (or restore) the archived reference sample, then mark it
      // archived. The validate_record_properties trigger fires on INSERT and
      // on UPDATE of kind/properties/workspace_id only, so setting archived_at
      // does not re-trigger validation.
      await db
        .insert(schema.records)
        .values({
          id: DEMO_ARCHIVED_SAMPLE_RECORD_ID,
          workspaceId: FIXTURE_WORKSPACE_ID,
          projectId: DEMO_VIRUS_STABILITY_PROJECT_ID,
          kind: 'sample',
          identifier: DEMO_ARCHIVED_SAMPLE_IDENTIFIER,
          title: 'LVV reference lot (expired)',
          status: 'expired',
          tags: ['LVV-CAR-T', 'reference'],
          properties: {
            construct: 'LVV-CAR-T',
            batch: 'LVV-240118',
            storage: '-80 °C',
          },
          createdByUserId: FIXTURE_USER_ID,
        })
        .onConflictDoUpdate({
          target: [schema.records.projectId, schema.records.identifier],
          set: {
            title: 'LVV reference lot (expired)',
            status: 'expired',
            tags: ['LVV-CAR-T', 'reference'],
            properties: {
              construct: 'LVV-CAR-T',
              batch: 'LVV-240118',
              storage: '-80 °C',
            },
            deletedAt: null,
          },
        })
      await db
        .update(schema.records)
        .set({ archivedAt: new Date('2025-03-01T00:00:00Z') })
        .where(eq(schema.records.id, DEMO_ARCHIVED_SAMPLE_RECORD_ID))
    },
  },
  {
    name: 'demo reagent: TaqMan qPCR kit',
    run: async (db) => {
      await db
        .insert(schema.records)
        .values({
          id: DEMO_REAGENT_RECORD_ID,
          workspaceId: FIXTURE_WORKSPACE_ID,
          projectId: DEMO_VIRUS_STABILITY_PROJECT_ID,
          kind: 'reagent',
          identifier: DEMO_REAGENT_IDENTIFIER,
          title: 'TaqMan qPCR kit',
          status: 'available',
          tags: ['qPCR', 'reagent'],
          properties: {
            supplier: 'Acme Biosystems',
            catalog_no: 'TAQ-1000',
            lot: 'TG-2604',
            expiry: '2026-12-31',
            quantity: 200,
            unit: 'reactions',
            storage: '-20 °C',
          },
          createdByUserId: FIXTURE_USER_ID,
        })
        .onConflictDoUpdate({
          target: [schema.records.projectId, schema.records.identifier],
          set: {
            title: 'TaqMan qPCR kit',
            status: 'available',
            tags: ['qPCR', 'reagent'],
            properties: {
              supplier: 'Acme Biosystems',
              catalog_no: 'TAQ-1000',
              lot: 'TG-2604',
              expiry: '2026-12-31',
              quantity: 200,
              unit: 'reactions',
              storage: '-20 °C',
            },
            deletedAt: null,
            archivedAt: null,
          },
        })
    },
  },
  {
    name: 'demo protocol template: Titration Assay',
    run: async (db) => {
      await db
        .insert(schema.records)
        .values({
          id: DEMO_VIRUS_STABILITY_PROTOCOL_RECORD_ID,
          workspaceId: FIXTURE_WORKSPACE_ID,
          projectId: DEMO_VIRUS_STABILITY_PROJECT_ID,
          kind: 'protocol_template',
          identifier: DEMO_VIRUS_STABILITY_PROTOCOL_IDENTIFIER,
          title: 'Stability Assay Protocol',
          status: 'active',
          tags: ['stability', 'qPCR'],
          createdByUserId: FIXTURE_USER_ID,
        })
        .onConflictDoUpdate({
          target: [schema.records.projectId, schema.records.identifier],
          set: {
            title: 'Stability Assay Protocol',
            status: 'active',
            tags: ['stability', 'qPCR'],
            deletedAt: null,
            archivedAt: null,
          },
        })
    },
  },
  {
    name: 'demo experiment: Virus Stability at 4°C',
    run: async (db) => {
      await db
        .insert(schema.records)
        .values({
          id: DEMO_VIRUS_STABILITY_RECORD_ID,
          workspaceId: FIXTURE_WORKSPACE_ID,
          projectId: DEMO_VIRUS_STABILITY_PROJECT_ID,
          kind: 'experiment',
          identifier: DEMO_VIRUS_STABILITY_RECORD_IDENTIFIER,
          title: 'Virus Stability at 4°C',
          status: 'in_progress',
          tags: ['stability', 'qPCR', 'LVV-CAR-T'],
          createdByUserId: FIXTURE_USER_ID,
        })
        .onConflictDoUpdate({
          target: [schema.records.projectId, schema.records.identifier],
          set: {
            title: 'Virus Stability at 4°C',
            status: 'in_progress',
            tags: ['stability', 'qPCR', 'LVV-CAR-T'],
            deletedAt: null,
            archivedAt: null,
          },
        })
    },
  },
  {
    name: 'demo notebook blocks: Virus Stability experiment',
    run: async (db) => {
      const blocks = [
        {
          id: DEMO_BLOCK_IDS.objective,
          type: 'rich_text',
          payload: {
            doc: {
              type: 'doc',
              content: [
                {
                  type: 'heading',
                  attrs: { level: 2 },
                  content: [{ type: 'text', text: 'Objective' }],
                },
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: 'Evaluate LVV-CAR-T vector stability at 4 °C across a 28-day window with durable formulas and calculation provenance.',
                    },
                  ],
                },
              ],
            },
          },
          order: 1,
        },
        {
          id: DEMO_BLOCK_IDS.materials,
          type: 'rich_text',
          payload: {
            doc: {
              type: 'doc',
              content: [
                {
                  type: 'heading',
                  attrs: { level: 2 },
                  content: [{ type: 'text', text: 'Materials' }],
                },
                {
                  type: 'bulletList',
                  content: [
                    'LVV-CAR-T drug substance (Lot LVV-250601)',
                    'DPBS, sterile filtered',
                    '1.5 mL low-bind tubes',
                    'TaqMan qPCR kit',
                  ].map((text) => ({
                    type: 'listItem' as const,
                    content: [
                      {
                        type: 'paragraph' as const,
                        content: [{ type: 'text' as const, text }],
                      },
                    ],
                  })),
                },
              ],
            },
          },
          order: 2,
        },
        {
          id: DEMO_BLOCK_IDS.design,
          type: 'rich_text',
          payload: {
            doc: {
              type: 'doc',
              content: [
                {
                  type: 'heading',
                  attrs: { level: 2 },
                  content: [{ type: 'text', text: 'Experimental design' }],
                },
              ],
            },
          },
          order: 3,
        },
        {
          id: DEMO_BLOCK_IDS.designTable,
          type: 'table',
          payload: {
            columns: [
              'Timepoint (days)',
              'Replicate',
              'Volume (µL)',
              'Storage condition',
            ],
            rows: [
              [0, 1, 100, '4 °C'],
              [0, 2, 100, '4 °C'],
              [7, 1, 100, '4 °C'],
              [7, 2, 100, '4 °C'],
              [14, 1, 100, '4 °C'],
              [14, 2, 100, '4 °C'],
              [21, 1, 100, '4 °C'],
              [21, 2, 100, '4 °C'],
              [28, 1, 100, '4 °C'],
              [28, 2, 100, '4 °C'],
            ],
          },
          order: 4,
        },
        {
          id: DEMO_BLOCK_IDS.results,
          type: 'rich_text',
          payload: {
            doc: {
              type: 'doc',
              content: [
                {
                  type: 'heading',
                  attrs: { level: 2 },
                  content: [{ type: 'text', text: 'Results' }],
                },
              ],
            },
          },
          order: 5,
        },
        {
          id: DEMO_BLOCK_IDS.resultsChart,
          type: 'chart',
          payload: {
            title: 'Vector genome copy number (qPCR)',
            spec: '{"type":"line","yAxis":{"scale":"log"},"xKey":"days","yKey":"gcn"}',
            provenance: 'Analysis Studio',
          },
          order: 6,
        },
        {
          id: DEMO_BLOCK_IDS.titerMetric,
          type: 'metric',
          payload: {
            label: 'Titer at day 0',
            value: 2.31e7,
            unit: 'copies/mL',
            provenance: 'qPCR',
          },
          order: 7,
        },
        {
          id: DEMO_BLOCK_IDS.checks,
          type: 'checklist',
          payload: {
            items: [
              { text: 'Data integrity', checked: true },
              { text: 'Instrument calibration', checked: true },
              { text: 'Reagent expiry', checked: true },
            ],
          },
          order: 8,
        },
        {
          id: DEMO_BLOCK_IDS.callout,
          type: 'callout',
          payload: {
            text: 'Include a no-template control (NTC) in every qPCR run.',
            variant: 'warning',
          },
          order: 9,
        },
        {
          id: DEMO_BLOCK_IDS.linkedProtocol,
          type: 'linked_record',
          payload: {
            targetKind: 'protocol_template',
            targetIdentifier: DEMO_VIRUS_STABILITY_PROTOCOL_IDENTIFIER,
            linkType: 'protocol',
            label: 'Stability Assay Protocol',
          },
          order: 10,
        },
      ] as const

      for (const block of blocks) {
        await db
          .insert(schema.blocks)
          .values({
            id: block.id,
            recordId: DEMO_VIRUS_STABILITY_RECORD_ID,
            type: block.type,
            payload: block.payload,
            order: block.order,
            createdByUserId: FIXTURE_USER_ID,
          })
          .onConflictDoUpdate({
            target: schema.blocks.id,
            set: {
              type: block.type,
              payload: block.payload,
              order: block.order,
            },
          })
      }
    },
  },
  {
    name: 'demo record link: experiment -> protocol',
    run: async (db) => {
      await db
        .insert(schema.recordLinks)
        .values({
          sourceRecordId: DEMO_VIRUS_STABILITY_RECORD_ID,
          targetRecordId: DEMO_VIRUS_STABILITY_PROTOCOL_RECORD_ID,
          targetKind: 'protocol_template',
          targetIdentifier: DEMO_VIRUS_STABILITY_PROTOCOL_IDENTIFIER,
          linkType: 'protocol',
          createdByUserId: FIXTURE_USER_ID,
        })
        .onConflictDoUpdate({
          target: [
            schema.recordLinks.sourceRecordId,
            schema.recordLinks.targetIdentifier,
            schema.recordLinks.linkType,
          ],
          set: {
            targetRecordId: DEMO_VIRUS_STABILITY_PROTOCOL_RECORD_ID,
            targetKind: 'protocol_template',
          },
        })
    },
  },
  {
    name: 'demo record links: experiment -> sample, reagent, archived sample',
    run: async (db) => {
      const links = [
        {
          targetRecordId: DEMO_SAMPLE_RECORD_ID,
          targetKind: 'sample' as const,
          targetIdentifier: DEMO_SAMPLE_IDENTIFIER,
          linkType: 'sample' as const,
        },
        {
          targetRecordId: DEMO_REAGENT_RECORD_ID,
          targetKind: 'reagent' as const,
          targetIdentifier: DEMO_REAGENT_IDENTIFIER,
          linkType: 'reagent' as const,
        },
        // An active link to an archived target exercises the honest
        // archived-reference rendering: target_identifier is preserved so the
        // link resolves even though the sample is archived.
        {
          targetRecordId: DEMO_ARCHIVED_SAMPLE_RECORD_ID,
          targetKind: 'sample' as const,
          targetIdentifier: DEMO_ARCHIVED_SAMPLE_IDENTIFIER,
          linkType: 'sample' as const,
        },
      ] as const

      for (const link of links) {
        await db
          .insert(schema.recordLinks)
          .values({
            sourceRecordId: DEMO_VIRUS_STABILITY_RECORD_ID,
            targetRecordId: link.targetRecordId,
            targetKind: link.targetKind,
            targetIdentifier: link.targetIdentifier,
            linkType: link.linkType,
            createdByUserId: FIXTURE_USER_ID,
          })
          .onConflictDoUpdate({
            target: [
              schema.recordLinks.sourceRecordId,
              schema.recordLinks.targetIdentifier,
              schema.recordLinks.linkType,
            ],
            set: {
              targetRecordId: link.targetRecordId,
              targetKind: link.targetKind,
            },
          })
      }
    },
  },
]

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is required. Copy .env.example to .env.local.',
    )
  }

  const withDemo = process.argv.includes('--demo')
  const steps = withDemo ? [...fixtureSteps, ...demoSteps] : fixtureSteps

  const db = createDb(databaseUrl)
  try {
    for (const step of steps) {
      await step.run(db)
      console.log(`seed: ${step.name}`)
    }
  } finally {
    await db.$client.end()
  }

  console.log(
    steps.length === 0
      ? 'Seed complete: no steps defined yet (schema lands with API-003).'
      : `Seed complete: ${steps.length} step(s) applied idempotently.`,
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
