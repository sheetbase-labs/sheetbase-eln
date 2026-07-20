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
import { drizzle } from 'drizzle-orm/node-postgres'

import * as schema from '../schema'
import {
  DEMO_BLOCK_IDS,
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
