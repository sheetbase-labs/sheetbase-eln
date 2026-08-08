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
import { asc, eq } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { Client } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'

import * as schema from '../schema'
import { resolveDevUserIdentity } from '#/lib/dev-identity'
import { monthSteps } from './month'
import {
  DEMO_BLOCK_IDS,
  DEMO_ARCHIVED_SAMPLE_IDENTIFIER,
  DEMO_ARCHIVED_SAMPLE_RECORD_ID,
  DEMO_FIELD_DEFINITION_IDS,
  DEMO_FILE_IDS,
  DEMO_PROTOCOL_REVISION_ID,
  DEMO_REAGENT_IDENTIFIER,
  DEMO_REAGENT_RECORD_ID,
  DEMO_SAMPLE_IDENTIFIER,
  DEMO_SAMPLE_RECORD_ID,
  DEMO_TEMPLATE_IDS,
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

const DEV_USER = resolveDevUserIdentity(process.env.SHEETBASE_DEV_USER_ID)

// OPS-002 storage demonstration fixtures. These stable IDs make preview
// reseeds converge while keeping the storage map useful for visual review.
const DEMO_STORAGE_IDS = {
  site: '00000000-0000-4000-8000-000000000260',
  room: '00000000-0000-4000-8000-000000000261',
  unit: '00000000-0000-4000-8000-000000000262',
  shelf: '00000000-0000-4000-8000-000000000263',
  rack: '00000000-0000-4000-8000-000000000264',
  box: '00000000-0000-4000-8000-000000000265',
  occupiedSample: '00000000-0000-4000-8000-000000000266',
  lowVolumeSample: '00000000-0000-4000-8000-000000000267',
  occupiedPosition: '00000000-0000-4000-8000-000000000268',
  lowVolumePosition: '00000000-0000-4000-8000-000000000269',
  quarantinedPosition: '00000000-0000-4000-8000-00000000026a',
  missingPosition: '00000000-0000-4000-8000-00000000026b',
  movement: '00000000-0000-4000-8000-00000000026c',
  custodyEvent: '00000000-0000-4000-8000-00000000026d',
} as const

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
        // A live workspace may already own the historical fixture UUID. Do
        // not mutate or move that row when running an additive seed.
        .onConflictDoNothing()
    },
  },
  {
    name: 'auth-free development user',
    run: async (db) => {
      await db
        .insert(schema.user)
        .values({
          id: DEV_USER.id,
          name: DEV_USER.name,
          email: DEV_USER.email,
          emailVerified: true,
        })
        .onConflictDoUpdate({
          target: schema.user.id,
          set: { name: DEV_USER.name, email: DEV_USER.email },
        })
    },
  },
  {
    name: 'auth-free development workspace membership',
    run: async (db) => {
      await db
        .insert(schema.workspaceMemberships)
        .values({
          workspaceId: FIXTURE_WORKSPACE_ID,
          userId: DEV_USER.id,
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
          id: DEMO_FIELD_DEFINITION_IDS.protocolVersion,
          kind: 'protocol_template' as const,
          fieldName: 'version',
          label: 'Version',
          displayOrder: 1,
          logicalType: 'text' as const,
          nullable: false,
        },
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
    name: 'demo OPS-002 storage map: populated -80 °C freezer box',
    run: async (db) => {
      const ids = DEMO_STORAGE_IDS
      await db
        .insert(schema.records)
        .values([
          {
            id: ids.occupiedSample,
            workspaceId: FIXTURE_WORKSPACE_ID,
            projectId: DEMO_VIRUS_STABILITY_PROJECT_ID,
            kind: 'sample',
            identifier: 'SMP-2025-0020',
            title: 'LVV-CAR-T retention aliquot',
            status: 'available',
            tags: ['LVV-CAR-T', 'retention'],
            properties: {
              construct: 'LVV-CAR-T',
              batch: 'LVV-250601',
              storage: '-80 °C',
              quantity: 4,
              expiryDate: '2027-06-30',
              barcode: 'SMP-LVV-0020',
              sampleType: 'Drug substance',
              storageLocation:
                'Cambridge site / Cold room 1 / Freezer FZ-80-01 / Shelf 2 / Rack 3 / BX-LVV-07 / A1',
            },
            createdByUserId: FIXTURE_USER_ID,
          },
          {
            id: ids.lowVolumeSample,
            workspaceId: FIXTURE_WORKSPACE_ID,
            projectId: DEMO_VIRUS_STABILITY_PROJECT_ID,
            kind: 'sample',
            identifier: 'SMP-2025-0021',
            title: 'LVV-CAR-T stability pull',
            status: 'available',
            tags: ['LVV-CAR-T', 'stability'],
            properties: {
              construct: 'LVV-CAR-T',
              batch: 'LVV-250601',
              storage: '-80 °C',
              quantity: 1,
              expiryDate: '2026-08-20',
              barcode: 'SMP-LVV-0021',
              sampleType: 'Stability sample',
              storageLocation:
                'Cambridge site / Cold room 1 / Freezer FZ-80-01 / Shelf 2 / Rack 3 / BX-LVV-07 / A2',
            },
            createdByUserId: FIXTURE_USER_ID,
          },
        ])
        .onConflictDoUpdate({
          target: schema.records.id,
          set: { status: 'available', archivedAt: null, deletedAt: null },
        })

      await db
        .insert(schema.storageSites)
        .values({
          id: ids.site,
          workspaceId: FIXTURE_WORKSPACE_ID,
          name: 'Cambridge site',
          code: 'CAM',
          capacity: 12,
        })
        .onConflictDoUpdate({
          target: schema.storageSites.id,
          set: { name: 'Cambridge site', code: 'CAM', capacity: 12 },
        })
      await db
        .insert(schema.storageRooms)
        .values({
          id: ids.room,
          workspaceId: FIXTURE_WORKSPACE_ID,
          siteId: ids.site,
          name: 'Cold room 1',
          code: 'CR-01',
          capacity: 8,
        })
        .onConflictDoUpdate({
          target: schema.storageRooms.id,
          set: { name: 'Cold room 1', code: 'CR-01', capacity: 8 },
        })
      await db
        .insert(schema.storageUnits)
        .values({
          id: ids.unit,
          workspaceId: FIXTURE_WORKSPACE_ID,
          roomId: ids.room,
          name: 'Freezer FZ-80-01',
          code: 'FZ-80-01',
          unitType: 'freezer',
          temperatureMinC: '-85',
          temperatureMaxC: '-75',
          capacity: 6,
        })
        .onConflictDoUpdate({
          target: schema.storageUnits.id,
          set: {
            name: 'Freezer FZ-80-01',
            code: 'FZ-80-01',
            unitType: 'freezer',
            temperatureMinC: '-85',
            temperatureMaxC: '-75',
            capacity: 6,
          },
        })
      await db
        .insert(schema.storageShelves)
        .values({
          id: ids.shelf,
          workspaceId: FIXTURE_WORKSPACE_ID,
          unitId: ids.unit,
          name: 'Shelf 2',
          position: 2,
          capacity: 4,
        })
        .onConflictDoUpdate({
          target: schema.storageShelves.id,
          set: { name: 'Shelf 2', position: 2, capacity: 4 },
        })
      await db
        .insert(schema.storageRacks)
        .values({
          id: ids.rack,
          workspaceId: FIXTURE_WORKSPACE_ID,
          shelfId: ids.shelf,
          name: 'Rack 3',
          position: 3,
          capacity: 2,
        })
        .onConflictDoUpdate({
          target: schema.storageRacks.id,
          set: { name: 'Rack 3', position: 3, capacity: 2 },
        })
      await db
        .insert(schema.storageBoxes)
        .values({
          id: ids.box,
          workspaceId: FIXTURE_WORKSPACE_ID,
          rackId: ids.rack,
          name: 'LVV retention box 07',
          code: 'BX-LVV-07',
          rows: 3,
          cols: 4,
          capacity: 12,
        })
        .onConflictDoUpdate({
          target: schema.storageBoxes.id,
          set: {
            name: 'LVV retention box 07',
            code: 'BX-LVV-07',
            rows: 3,
            cols: 4,
            capacity: 12,
          },
        })

      const specialPositions = new Map([
        [
          '0:0',
          {
            id: ids.occupiedPosition,
            label: 'A1',
            status: 'occupied',
            occupiedRecordId: ids.occupiedSample,
          },
        ],
        [
          '0:1',
          {
            id: ids.lowVolumePosition,
            label: 'A2',
            status: 'occupied',
            occupiedRecordId: ids.lowVolumeSample,
          },
        ],
        [
          '1:2',
          {
            id: ids.quarantinedPosition,
            label: 'B3',
            status: 'quarantined',
            occupiedRecordId: null,
          },
        ],
        [
          '2:3',
          {
            id: ids.missingPosition,
            label: 'C4',
            status: 'missing',
            occupiedRecordId: null,
          },
        ],
      ])
      for (let rowIndex = 0; rowIndex < 3; rowIndex += 1) {
        for (let colIndex = 0; colIndex < 4; colIndex += 1) {
          const special = specialPositions.get(`${rowIndex}:${colIndex}`)
          const label = `${String.fromCharCode(65 + rowIndex)}${colIndex + 1}`
          await db
            .insert(schema.storagePositions)
            .values({
              id:
                special?.id ??
                `00000000-0000-4000-8000-0000000002${80 + rowIndex * 4 + colIndex}`,
              workspaceId: FIXTURE_WORKSPACE_ID,
              boxId: ids.box,
              rowIndex,
              colIndex,
              label,
              status: special?.status ?? 'available',
              occupiedRecordId: special?.occupiedRecordId ?? null,
            })
            .onConflictDoUpdate({
              target: [
                schema.storagePositions.boxId,
                schema.storagePositions.rowIndex,
                schema.storagePositions.colIndex,
              ],
              set: {
                label,
                status: special?.status ?? 'available',
                occupiedRecordId: special?.occupiedRecordId ?? null,
              },
            })
        }
      }
      const path =
        'Cambridge site / Cold room 1 / Freezer FZ-80-01 / Shelf 2 / Rack 3 / BX-LVV-07 / A1'
      await db
        .insert(schema.storageMovements)
        .values({
          id: ids.movement,
          workspaceId: FIXTURE_WORKSPACE_ID,
          recordId: ids.occupiedSample,
          operation: 'place',
          toPositionId: ids.occupiedPosition,
          toPath: path,
          actorUserId: FIXTURE_USER_ID,
          notes: 'Seeded retention placement for preview review.',
        })
        .onConflictDoUpdate({
          target: schema.storageMovements.id,
          set: {
            toPositionId: ids.occupiedPosition,
            toPath: path,
            notes: 'Seeded retention placement for preview review.',
          },
        })
      await db
        .insert(schema.sampleEvents)
        .values({
          id: ids.custodyEvent,
          workspaceId: FIXTURE_WORKSPACE_ID,
          recordId: ids.occupiedSample,
          operation: 'transfer',
          fromLocation: 'Quarantine release',
          toLocation: path,
          actorUserId: FIXTURE_USER_ID,
          notes: 'Released and placed in -80 °C retention storage.',
        })
        .onConflictDoUpdate({
          target: schema.sampleEvents.id,
          set: {
            toLocation: path,
            notes: 'Released and placed in -80 °C retention storage.',
          },
        })
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
          projectId: null,
          kind: 'protocol_template',
          identifier: DEMO_VIRUS_STABILITY_PROTOCOL_IDENTIFIER,
          title: 'Titration Assay',
          status: 'active',
          tags: ['titration', 'qPCR'],
          properties: { version: '1.2' },
          createdByUserId: FIXTURE_USER_ID,
        })
        .onConflictDoUpdate({
          target: schema.records.id,
          set: {
            title: 'Titration Assay',
            status: 'active',
            tags: ['titration', 'qPCR'],
            properties: { version: '1.2' },
            deletedAt: null,
            archivedAt: null,
          },
        })
    },
  },
  {
    name: 'demo reusable protocol procedure and immutable revision',
    run: async (db) => {
      const definitions = [
        {
          id: DEMO_BLOCK_IDS.protocolStep1,
          order: 1,
          payload: {
            text: 'Prepare a serial dilution of the sample.',
            stepNumber: 1,
          },
        },
        {
          id: DEMO_BLOCK_IDS.protocolStep2,
          order: 2,
          payload: {
            text: 'Measure the assay response and fit the titration curve.',
            stepNumber: 2,
          },
        },
      ] as const
      for (const step of definitions)
        await db
          .insert(schema.blocks)
          .values({
            ...step,
            recordId: DEMO_VIRUS_STABILITY_PROTOCOL_RECORD_ID,
            type: 'procedure_step',
            createdByUserId: FIXTURE_USER_ID,
          })
          .onConflictDoUpdate({
            target: schema.blocks.id,
            set: { payload: step.payload, order: step.order },
          })
      await db
        .insert(schema.revisions)
        .values({
          id: DEMO_PROTOCOL_REVISION_ID,
          recordId: DEMO_VIRUS_STABILITY_PROTOCOL_RECORD_ID,
          structureVersion: 1,
          metadataVersion: 1,
          reason: 'manual',
          createdByUserId: FIXTURE_USER_ID,
          createdAt: new Date('2026-07-21T12:00:00Z'),
          updatedAt: new Date('2026-07-21T12:00:00Z'),
          metadataSnapshot: {
            identifier: DEMO_VIRUS_STABILITY_PROTOCOL_IDENTIFIER,
            title: 'Titration Assay',
            status: 'active',
            properties: { version: '1.2' },
          },
          blockSnapshot: definitions.map((step) => ({
            id: step.id,
            type: 'procedure_step',
            payload: step.payload,
            order: step.order,
          })),
        })
        .onConflictDoNothing({ target: schema.revisions.id })
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
      // SCI-002 changes the two legacy demo blocks' immutable type. Remove
      // only those obsolete stable-id rows once; normal reruns use upserts.
      for (const [id, type] of [
        [DEMO_BLOCK_IDS.materials, 'materials'],
        [DEMO_BLOCK_IDS.linkedProtocol, 'protocol_reference'],
      ] as const) {
        const existing = (
          await db
            .select({ type: schema.blocks.type })
            .from(schema.blocks)
            .where(eq(schema.blocks.id, id))
        ).at(0)
        if (existing && existing.type !== type)
          await db.delete(schema.blocks).where(eq(schema.blocks.id, id))
      }
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
          type: 'materials',
          payload: {
            items: [
              {
                id: 'sample-active',
                materialRecordId: DEMO_SAMPLE_RECORD_ID,
                kind: 'sample',
                identifier: DEMO_SAMPLE_IDENTIFIER,
                title: 'LVV-CAR-T drug substance',
                quantity: 100,
                unit: { code: 'uL', symbol: 'µL', quantityKind: 'volume' },
                observedAt: '2026-07-21T12:00:00Z',
              },
              {
                id: 'reagent-active',
                materialRecordId: DEMO_REAGENT_RECORD_ID,
                kind: 'reagent',
                identifier: DEMO_REAGENT_IDENTIFIER,
                title: 'TaqMan qPCR kit',
                quantity: 20,
                unit: { code: 'uL', symbol: 'µL', quantityKind: 'volume' },
                observedAt: '2026-07-21T12:00:00Z',
              },
              {
                id: 'sample-archived',
                materialRecordId: DEMO_ARCHIVED_SAMPLE_RECORD_ID,
                kind: 'sample',
                identifier: DEMO_ARCHIVED_SAMPLE_IDENTIFIER,
                title: 'LVV reference lot (expired)',
                quantity: 50,
                unit: { code: 'uL', symbol: 'µL', quantityKind: 'volume' },
                observedAt: '2026-07-21T12:00:00Z',
              },
            ],
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
          // Draft placeholder; the SCI-004 scientific-table step populates
          // this with a valid chart specification once its dataset exists.
          payload: {},
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
          type: 'protocol_reference',
          payload: {
            protocolRecordId: DEMO_VIRUS_STABILITY_PROTOCOL_RECORD_ID,
            protocolIdentifier: DEMO_VIRUS_STABILITY_PROTOCOL_IDENTIFIER,
            protocolTitle: 'Titration Assay',
            protocolRevisionId: DEMO_PROTOCOL_REVISION_ID,
            version: '1.2',
            approvalStatus: 'active',
            pinnedAt: '2026-07-21T12:00:00Z',
            pinnedByUserId: FIXTURE_USER_ID,
          },
          order: 10,
        },
        {
          id: DEMO_BLOCK_IDS.copiedStep1,
          type: 'procedure_step',
          payload: {
            text: 'Prepare a serial dilution of the sample.',
            stepNumber: 1,
            sourceProtocolRevisionId: DEMO_PROTOCOL_REVISION_ID,
            sourceStepBlockId: DEMO_BLOCK_IDS.protocolStep1,
            completed: false,
            note: '',
            completedAt: null,
            completedByUserId: null,
          },
          order: 11,
        },
        {
          id: DEMO_BLOCK_IDS.copiedStep2,
          type: 'procedure_step',
          payload: {
            text: 'Measure the assay response and fit the titration curve.',
            stepNumber: 2,
            sourceProtocolRevisionId: DEMO_PROTOCOL_REVISION_ID,
            sourceStepBlockId: DEMO_BLOCK_IDS.protocolStep2,
            completed: false,
            note: '',
            completedAt: null,
            completedByUserId: null,
          },
          order: 12,
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
  {
    name: 'demo file attachments: Virus Stability (SCI-003)',
    run: async (db) => {
      // Four file records exercising every lifecycle state. Storage keys
      // are deterministic so the seed is idempotent and the local backend
      // can materialise the active object. Bytes live behind the storage
      // boundary; only the active file has bytes on disk (the missing file
      // deliberately has none, and quarantined/deleted refuse download).
      const storageRoot = resolve(
        process.env.FILE_STORAGE_DIR ?? './.storage/objects',
      )
      const activeCsv =
        'timepoint,temperature,log_titer\n0,4,7.2\n7,4,7.0\n14,4,6.6\n28,4,5.9\n'
      const activeChecksum = createHash('sha256')
        .update(activeCsv)
        .digest('hex')
      const activeStorageKey = `${FIXTURE_WORKSPACE_ID}/${DEMO_FILE_IDS.activeRecord}/a1b2c3d4e5f60718293a4b5c6d7e8f90`
      const activePath = join(storageRoot, activeStorageKey)
      await mkdir(dirname(activePath), { recursive: true })
      await writeFile(activePath, activeCsv, { encoding: 'utf8' })

      const files = [
        {
          recordId: DEMO_FILE_IDS.activeRecord,
          objectId: DEMO_FILE_IDS.activeObject,
          identifier: DEMO_FILE_IDS.activeIdentifier,
          title: 'Stability run 07 — titer curve (4 °C)',
          displayName: 'stability-run07-4c.csv',
          mediaType: 'text/csv',
          byteSize: BigInt(activeCsv.length),
          checksum: activeChecksum,
          status: 'active' as const,
          statusReason: null as string | null,
          storageKey: activeStorageKey,
          quarantinedAt: null as Date | null,
          deletedAt: null as Date | null,
        },
        {
          recordId: DEMO_FILE_IDS.quarantinedRecord,
          objectId: DEMO_FILE_IDS.quarantinedObject,
          identifier: DEMO_FILE_IDS.quarantinedIdentifier,
          title: 'Raw plate read (quarantined)',
          displayName: 'plate-read-raw.csv',
          mediaType: 'text/csv',
          byteSize: BigInt(2048),
          checksum: null,
          status: 'quarantined' as const,
          statusReason: 'suspected contamination on plate B',
          storageKey: `${FIXTURE_WORKSPACE_ID}/${DEMO_FILE_IDS.quarantinedRecord}/b2c3d4e5f60718293a4b5c6d7e8f9a10`,
          quarantinedAt: new Date('2025-06-18T09:30:00Z'),
          deletedAt: null as Date | null,
        },
        {
          recordId: DEMO_FILE_IDS.deletedRecord,
          objectId: DEMO_FILE_IDS.deletedObject,
          identifier: DEMO_FILE_IDS.deletedIdentifier,
          title: 'Superseded calibration (deleted)',
          displayName: 'calibration-old.pdf',
          mediaType: 'application/pdf',
          byteSize: BigInt(524288),
          checksum: null,
          status: 'deleted' as const,
          statusReason: null as string | null,
          storageKey: `${FIXTURE_WORKSPACE_ID}/${DEMO_FILE_IDS.deletedRecord}/c3d4e5f60718293a4b5c6d7e8f9a1b20`,
          quarantinedAt: null as Date | null,
          deletedAt: new Date('2025-06-20T12:00:00Z'),
        },
        {
          recordId: DEMO_FILE_IDS.missingRecord,
          objectId: DEMO_FILE_IDS.missingObject,
          identifier: DEMO_FILE_IDS.missingIdentifier,
          title: 'Instrument export (missing storage object)',
          displayName: 'qpcr-export.json',
          mediaType: 'application/json',
          byteSize: BigInt(8192),
          checksum: null,
          status: 'missing' as const,
          statusReason: 'storage object absent',
          storageKey: `${FIXTURE_WORKSPACE_ID}/${DEMO_FILE_IDS.missingRecord}/d4e5f60718293a4b5c6d7e8f9a1b2c30`,
          quarantinedAt: null as Date | null,
          deletedAt: null as Date | null,
        },
      ] as const

      for (const f of files) {
        await db
          .insert(schema.records)
          .values({
            id: f.recordId,
            workspaceId: FIXTURE_WORKSPACE_ID,
            projectId: DEMO_VIRUS_STABILITY_PROJECT_ID,
            kind: 'file',
            identifier: f.identifier,
            title: f.title,
            status: 'active',
            tags: [],
            createdByUserId: FIXTURE_USER_ID,
          })
          .onConflictDoUpdate({
            target: [schema.records.projectId, schema.records.identifier],
            set: {
              title: f.title,
              status: 'active',
              tags: [],
              deletedAt: null,
              archivedAt: null,
            },
          })
        await db
          .insert(schema.fileObjects)
          .values({
            id: f.objectId,
            workspaceId: FIXTURE_WORKSPACE_ID,
            recordId: f.recordId,
            storageKey: f.storageKey,
            displayName: f.displayName,
            mediaType: f.mediaType,
            byteSize: f.byteSize,
            checksum: f.checksum,
            status: f.status,
            statusReason: f.statusReason,
            storageBackend: 'local',
            quarantinedAt: f.quarantinedAt,
            deletedAt: f.deletedAt,
            version: 1,
            createdByUserId: FIXTURE_USER_ID,
            updatedByUserId: FIXTURE_USER_ID,
          })
          .onConflictDoUpdate({
            target: schema.fileObjects.recordId,
            set: {
              storageKey: f.storageKey,
              displayName: f.displayName,
              mediaType: f.mediaType,
              byteSize: f.byteSize,
              checksum: f.checksum,
              status: f.status,
              statusReason: f.statusReason,
              storageBackend: 'local',
              quarantinedAt: f.quarantinedAt,
              deletedAt: f.deletedAt,
              updatedByUserId: FIXTURE_USER_ID,
            },
          })
      }

      // Link each file to the experiment with provenance (linkType 'file').
      for (const f of files) {
        await db
          .insert(schema.recordLinks)
          .values({
            sourceRecordId: DEMO_VIRUS_STABILITY_RECORD_ID,
            targetRecordId: f.recordId,
            targetKind: 'file',
            targetIdentifier: f.identifier,
            linkType: 'file',
            createdByUserId: FIXTURE_USER_ID,
          })
          .onConflictDoUpdate({
            target: [
              schema.recordLinks.sourceRecordId,
              schema.recordLinks.targetIdentifier,
              schema.recordLinks.linkType,
            ],
            set: {
              targetRecordId: f.recordId,
              targetKind: 'file',
            },
          })
      }

      // A file block in the notebook referencing the active file, so the
      // canonical block presentation is exercised alongside the inspector.
      await db
        .insert(schema.blocks)
        .values({
          id: DEMO_FILE_IDS.block,
          recordId: DEMO_VIRUS_STABILITY_RECORD_ID,
          type: 'file',
          payload: {
            fileRecordId: DEMO_FILE_IDS.activeRecord,
            fileIdentifier: DEMO_FILE_IDS.activeIdentifier,
            displayName: 'stability-run07-4c.csv',
            mediaType: 'text/csv',
            byteSize: activeCsv.length,
          },
          order: 21,
          createdByUserId: FIXTURE_USER_ID,
        })
        .onConflictDoUpdate({
          target: schema.blocks.id,
          set: {
            type: 'file',
            payload: {
              fileRecordId: DEMO_FILE_IDS.activeRecord,
              fileIdentifier: DEMO_FILE_IDS.activeIdentifier,
              displayName: 'stability-run07-4c.csv',
              mediaType: 'text/csv',
              byteSize: activeCsv.length,
            },
            order: 21,
          },
        })
    },
  },
  {
    name: 'demo SCI-004 chart specifications: Virus Stability',
    run: async (db) => {
      // A scientific 'sheet' block backs the stability dataset; a live chart
      // references it and a second chart is frozen to exercise both lifecycle
      // states. The scientific table is created through the same RPC the UI
      // uses (create_scientific_table), so no parallel identity path exists.
      // The drizzle connection handles the plain sheet-block upsert. The
      // authenticated RPCs (create_scientific_table, freeze_chart) require a
      // session that can SET ROLE authenticated with JWT claims, so a short
      // pg.Client is opened as the authenticator role against the SAME
      // database the drizzle pool targets (parsed from the pool's connection
      // string). This keeps dev seeds and integration tests isolated to their
      // own database without ever reading DATABASE_URL directly.
      const poolCs = db.$client.options.connectionString
      if (!poolCs)
        throw new Error(
          'drizzle pool connection string is required for SCI-004 seed',
        )
      const poolUrl = new URL(poolCs)
      const pgrst = new URL(process.env.PGRST_DB_URI ?? '')
      const authUrl = new URL(poolUrl.toString())
      authUrl.username = pgrst.username
      authUrl.password = pgrst.password
      if (!pgrst.username)
        throw new Error('PGRST_DB_URI is required for SCI-004 seed')
      const client = new Client({ connectionString: authUrl.toString() })
      await client.connect()
      try {
        await db
          .insert(schema.blocks)
          .values({
            id: DEMO_BLOCK_IDS.stabilitySheet,
            recordId: DEMO_VIRUS_STABILITY_RECORD_ID,
            type: 'sheet',
            payload: {},
            order: 22,
            createdByUserId: FIXTURE_USER_ID,
          })
          .onConflictDoUpdate({
            target: schema.blocks.id,
            set: { type: 'sheet', payload: {}, order: 22 },
          })

        await client.query('SET ROLE authenticated')
        await client.query("SELECT set_config('request.jwt.claims',$1,false)", [
          JSON.stringify({
            sub: FIXTURE_USER_ID,
            workspace_id: FIXTURE_WORKSPACE_ID,
            role: 'authenticated',
          }),
        ])

        // Reuse an existing scientific table for the sheet block; create one
        // on first seed. The table id and generated column names are not
        // stable across fresh environments, so look them up each run.
        let tableId: string
        let resourceName: string
        const existing = await client.query(
          `SELECT t.id, t.resource_name FROM api.scientific_tables t WHERE t.block_id=$1 AND t.lifecycle='active'`,
          [DEMO_BLOCK_IDS.stabilitySheet],
        )
        if (existing.rows.length > 0) {
          tableId = existing.rows[0].id
          resourceName = existing.rows[0].resource_name
        } else {
          const created = await client.query(
            `SELECT api.create_scientific_table($1,$2,$3::jsonb) result`,
            [
              DEMO_BLOCK_IDS.stabilitySheet,
              'Stability readings (qPCR)',
              JSON.stringify([
                {
                  label: 'Time (days)',
                  logical_type: 'decimal',
                  unit: { code: 'd', symbol: 'd' },
                },
                {
                  label: 'Log titer',
                  logical_type: 'decimal',
                  unit: { code: 'log10', symbol: 'log₁₀' },
                },
                { label: 'Condition', logical_type: 'text' },
              ]),
            ],
          )
          tableId = created.rows[0].result.table.id
          resourceName = created.rows[0].result.table.resource_name
        }
        // Pin the sheet block payload to the scientific table id so the block
        // validates at the application boundary and renders its dataset.
        await client.query(
          `UPDATE api.blocks SET payload=$2::jsonb WHERE id=$1`,
          [DEMO_BLOCK_IDS.stabilitySheet, JSON.stringify({ tableId })],
        )
        const cols = await client.query(
          `SELECT id, field_name, label FROM api.scientific_columns WHERE table_id=$1 AND lifecycle='active' ORDER BY display_order`,
          [tableId],
        )
        const byLabel = Object.fromEntries(cols.rows.map((c) => [c.label, c]))
        const timeField = byLabel['Time (days)'].field_name
        const recoveryField = byLabel['Log titer'].field_name
        const conditionField = byLabel['Condition'].field_name
        const timeColumnId = byLabel['Time (days)'].id
        const recoveryColumnId = byLabel['Log titer'].id
        const conditionColumnId = byLabel['Condition'].id

        // Idempotent dataset rows: wipe and re-insert the stability series.
        // Clear any formulas from prior test sessions first.
        //
        // DATABASE_URL connects as POSTGRES_USER, which is the PostgreSQL
        // superuser (created by the Docker postgres image). Only superusers
        // can reliably SET session_replication_role = 'replica' to bypass
        // all triggers. The migrator role is non-superuser and cannot
        // disable triggers. The superuser also bypasses RLS (no FORCE RLS
        // is set), so it has full access to formula tables.
        //
        // session_replication_role = 'replica' disables all non-ALWAYS
        // triggers for the session, including the scientific_row_before
        // BEFORE DELETE trigger (which blocks deleting rows with
        // formula_column_ids or incoming formula dependencies). This is
        // the PostgreSQL-standard way to bypass triggers for maintenance
        // operations. The finally block resets to 'origin' before the
        // subsequent INSERT operations (which need triggers enabled).
        const superuserClient = new Client({ connectionString: poolCs })
        await superuserClient.connect()
        try {
          await superuserClient.query(
            "SET session_replication_role = 'replica'",
          )
          try {
            // Delete formula dependencies and definitions first.
            // These reference target_table_id/source_table_id (the
            // scientific_tables UUID), not the resource table directly.
            await superuserClient.query(
              `DELETE FROM api.formula_dependencies WHERE source_table_id = $1`,
              [tableId],
            )
            await superuserClient.query(
              `DELETE FROM api.formula_definitions WHERE target_table_id = $1`,
              [tableId],
            )
            // Clear formula_column_ids on resource rows (the before-update
            // trigger would block this without the replica role).
            await superuserClient.query(
              `UPDATE api."${resourceName}" SET formula_column_ids = '{}' WHERE cardinality(formula_column_ids) > 0`,
            )
            // Delete all resource rows (the before-delete trigger would
            // block this without the replica role).
            await superuserClient.query(`DELETE FROM api."${resourceName}"`)
          } finally {
            await superuserClient.query(
              "SET session_replication_role = 'origin'",
            )
          }
        } finally {
          await superuserClient.end()
        }
        const rows = [
          [0, 7.2, '4 °C'],
          [7, 7.0, '4 °C'],
          [14, 6.6, '4 °C'],
          [28, 5.9, '4 °C'],
          [0, 7.1, '−20 °C'],
          [7, 6.9, '−20 °C'],
          [14, 6.7, '−20 °C'],
          [28, 6.4, '−20 °C'],
        ] as const
        for (const [t, logTiter, condition] of rows) {
          await client.query(
            `INSERT INTO api."${resourceName}" ("${timeField}","${recoveryField}","${conditionField}") VALUES ($1,$2,$3)`,
            [t, logTiter, condition],
          )
        }

        const chartSpec = {
          specVersion: 1,
          type: 'line' as const,
          datasets: [{ tableId }],
          fields: {
            x: { columnId: timeColumnId, fieldName: timeField },
            y: { columnId: recoveryColumnId, fieldName: recoveryField },
            series: { columnId: conditionColumnId, fieldName: conditionField },
            color: null,
            size: null,
          },
          filters: [],
          transformations: [],
          display: {
            axes: {
              x: { label: 'Time (days)', scale: 'linear' as const, unit: 'd' },
              y: { label: 'Log titer', scale: 'log' as const, unit: 'log₁₀' },
            },
            series: [
              { identifier: '4 °C', label: '4 °C', color: '#006EDC' },
              { identifier: '−20 °C', label: '−20 °C', color: '#00A659' },
            ],
            legend: { visible: true },
          },
          overlays: { errorBars: null },
        }

        // Live chart block: upsert the spec onto the placeholder block.
        await client.query(
          `UPDATE api.blocks SET payload=$2::jsonb, version=version+1 WHERE id=$1`,
          [
            DEMO_BLOCK_IDS.resultsChart,
            JSON.stringify({
              title: 'Vector genome copy number (qPCR)',
              spec: chartSpec,
              provenance: 'Stability readings (qPCR)',
              frozen: null,
            }),
          ],
        )

        // Frozen chart block: recreate each run so the frozen snapshot always
        // reflects the current dataset. Remove any prior block at this slot
        // (including orphans left by an interrupted run), insert a draft with
        // the stable fixture id, populate it, then freeze through the
        // transactional RPC so the snapshot/provenance are authoritative.
        await client.query(
          `DELETE FROM api.blocks WHERE record_id=$1 AND "order"=23`,
          [DEMO_VIRUS_STABILITY_RECORD_ID],
        )
        await client.query(
          `INSERT INTO api.blocks(id,record_id,type,payload,"order",created_by_user_id) VALUES($1,$2,'chart','{}'::jsonb,23,$3)`,
          [
            DEMO_BLOCK_IDS.stabilityChartFrozen,
            DEMO_VIRUS_STABILITY_RECORD_ID,
            FIXTURE_USER_ID,
          ],
        )
        const populated = await client.query(
          `UPDATE api.blocks SET payload=$2::jsonb, version=version+1 WHERE id=$1 RETURNING version`,
          [
            DEMO_BLOCK_IDS.stabilityChartFrozen,
            JSON.stringify({
              title: 'Frozen stability snapshot (qPCR)',
              spec: chartSpec,
              provenance: 'Stability readings (qPCR)',
              frozen: null,
            }),
          ],
        )
        await client.query('SELECT * FROM api.freeze_chart($1,$2)', [
          DEMO_BLOCK_IDS.stabilityChartFrozen,
          populated.rows[0].version,
        ])

        await client.query('RESET ROLE')
      } finally {
        await client.end()
      }
    },
  },
  {
    name: 'demo SCI-005 plate map: Virus Stability qPCR plate',
    run: async (db) => {
      const volume = { value: 20, unit: 'µL' }
      const payload = {
        title: 'qPCR titration plate',
        spec: {
          specVersion: 1,
          format: '96_well',
          rows: 8,
          cols: 12,
          wells: [
            ...[0, 1, 2].map((col) => ({
              wellCode: `A${col + 1}`,
              row: 0,
              col,
              role: 'sample',
              sampleRef: {
                recordId: DEMO_SAMPLE_RECORD_ID,
                identifier: DEMO_SAMPLE_IDENTIFIER,
                title: 'LVV-CAR-T drug substance',
              },
              replicate: col + 1,
              volume,
              notes: 'Active stability sample',
            })),
            ...[0, 1, 2].map((col) => ({
              wellCode: `B${col + 1}`,
              row: 1,
              col,
              role: 'sample',
              sampleRef: {
                recordId: DEMO_ARCHIVED_SAMPLE_RECORD_ID,
                identifier: DEMO_ARCHIVED_SAMPLE_IDENTIFIER,
                title: 'LVV reference lot (expired)',
                archived: true,
              },
              replicate: col + 1,
              volume,
              notes: 'Archived reference lot',
            })),
            ...[0, 1, 2].map((col) => ({
              wellCode: `C${col + 1}`,
              row: 2,
              col,
              role: 'positive_control',
              replicate: col + 1,
              volume,
            })),
            ...[0, 1, 2].map((col) => ({
              wellCode: `D${col + 1}`,
              row: 3,
              col,
              role: 'negative_control',
              replicate: col + 1,
              volume,
            })),
            ...[0, 1, 2].map((col) => ({
              wellCode: `E${col + 1}`,
              row: 4,
              col,
              role: 'blank',
              replicate: col + 1,
              volume,
            })),
          ],
          validation: {
            requiredRoles: ['positive_control', 'negative_control'],
            volumeMin: 20,
            volumeMax: 20,
            volumeUnit: 'µL',
          },
        },
        provenance: 'Virus Stability qPCR',
      }

      await db
        .insert(schema.blocks)
        .values({
          id: DEMO_BLOCK_IDS.plateMap,
          recordId: DEMO_VIRUS_STABILITY_RECORD_ID,
          type: 'plate_map',
          payload,
          order: 24,
          createdByUserId: FIXTURE_USER_ID,
        })
        .onConflictDoUpdate({
          target: schema.blocks.id,
          set: { type: 'plate_map', payload, order: 24 },
        })
    },
  },
  // -------------------------------------------------------------------------
  // SCI-009: a linked_record block in the notebook body. The record_links
  // relation rows (below) carry the authoritative graph; this block exercises
  // the in-notebook linked-record render path so every valid block type is
  // represented in the Virus Stability notebook and overview.
  // -------------------------------------------------------------------------
  {
    name: 'demo SCI-009 linked_record block: Virus Stability',
    run: async (db) => {
      await db
        .insert(schema.blocks)
        .values({
          id: DEMO_BLOCK_IDS.linkedRecord,
          recordId: DEMO_VIRUS_STABILITY_RECORD_ID,
          type: 'linked_record',
          payload: {
            targetKind: 'sample',
            targetIdentifier: DEMO_SAMPLE_IDENTIFIER,
            label: 'LVV-CAR-T drug substance',
            linkType: 'sample',
          },
          order: 25,
          createdByUserId: FIXTURE_USER_ID,
        })
        .onConflictDoUpdate({
          target: schema.blocks.id,
          set: {
            type: 'linked_record',
            payload: {
              targetKind: 'sample',
              targetIdentifier: DEMO_SAMPLE_IDENTIFIER,
              label: 'LVV-CAR-T drug substance',
              linkType: 'sample',
            },
            order: 25,
          },
        })
    },
  },
  // -------------------------------------------------------------------------
  // SCI-007: submitted revision of the Virus Stability experiment for the
  // locked/historical overview state. Snapshots all blocks that exist at
  // seed time so the overview can render a historical version.
  // -------------------------------------------------------------------------
  {
    name: 'demo SCI-007 submitted revision: Virus Stability',
    run: async (db) => {
      // Query the live blocks to build the snapshot.
      const blocks = await db
        .select()
        .from(schema.blocks)
        .where(eq(schema.blocks.recordId, DEMO_VIRUS_STABILITY_RECORD_ID))
        .orderBy(asc(schema.blocks.order))
      await db
        .insert(schema.revisions)
        .values({
          id: DEMO_TEMPLATE_IDS.experimentRevision,
          recordId: DEMO_VIRUS_STABILITY_RECORD_ID,
          structureVersion: 1,
          metadataVersion: 1,
          reason: 'submit',
          createdByUserId: FIXTURE_USER_ID,
          createdAt: new Date('2026-07-22T10:00:00Z'),
          updatedAt: new Date('2026-07-22T10:00:00Z'),
          metadataSnapshot: {
            identifier: DEMO_VIRUS_STABILITY_RECORD_IDENTIFIER,
            title: 'Virus Stability at 4°C',
            status: 'in_progress',
            tags: ['stability', 'qPCR', 'LVV-CAR-T'],
          },
          blockSnapshot: blocks.map((b) => ({
            id: b.id,
            type: b.type,
            payload: b.payload,
            payload_schema_version: b.payloadSchemaVersion,
            order: Number(b.order),
            version: b.version,
          })),
        })
        .onConflictDoNothing({ target: schema.revisions.id })
    },
  },
  // -------------------------------------------------------------------------
  // SCI-006: template fixtures. A validated notebook template, a draft
  // notebook template, an archived protocol template, and a record
  // instantiated from the validated template with a source-template link.
  // -------------------------------------------------------------------------
  {
    name: 'demo SCI-006 notebook template: Stability Study (ICH)',
    run: async (db) => {
      const blocks = [
        {
          id: DEMO_TEMPLATE_IDS.notebookTemplateBlock1,
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
                      text: 'Evaluate the stability of the drug substance under ICH-accelerated conditions (40 °C / 75% RH) over 6 months.',
                    },
                  ],
                },
              ],
            },
          },
          order: 1,
        },
        {
          id: DEMO_TEMPLATE_IDS.notebookTemplateBlock2,
          type: 'checklist',
          payload: {
            items: [
              {
                text: 'Prepare stability chambers at 40 °C / 75% RH',
                checked: false,
              },
              {
                text: 'Assign time points: T=0, 1, 2, 3, 6 months',
                checked: false,
              },
              {
                text: 'Define acceptance criteria (potency ≥ 90%, impurities ≤ 5%)',
                checked: false,
              },
            ],
          },
          order: 2,
        },
        {
          id: DEMO_TEMPLATE_IDS.notebookTemplateBlock3,
          type: 'callout',
          payload: {
            text: 'Follow ICH Q1A(R2) guidelines for accelerated stability testing.',
            variant: 'info',
          },
          order: 3,
        },
      ]
      await db
        .insert(schema.records)
        .values({
          id: DEMO_TEMPLATE_IDS.notebookTemplateValidated,
          workspaceId: FIXTURE_WORKSPACE_ID,
          projectId: null,
          kind: 'notebook_template',
          identifier: DEMO_TEMPLATE_IDS.notebookTemplateValidatedIdentifier,
          title: 'Stability Study (ICH)',
          status: 'validated',
          createdByUserId: FIXTURE_USER_ID,
        })
        .onConflictDoUpdate({
          target: schema.records.id,
          set: {
            title: 'Stability Study (ICH)',
            status: 'validated',
            archivedAt: null,
            deletedAt: null,
          },
        })
      for (const block of blocks) {
        await db
          .insert(schema.blocks)
          .values({
            id: block.id,
            recordId: DEMO_TEMPLATE_IDS.notebookTemplateValidated,
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
    name: 'demo SCI-006 draft notebook template: Cell Viability Assay',
    run: async (db) => {
      await db
        .insert(schema.records)
        .values({
          id: DEMO_TEMPLATE_IDS.notebookTemplateDraft,
          workspaceId: FIXTURE_WORKSPACE_ID,
          projectId: null,
          kind: 'notebook_template',
          identifier: DEMO_TEMPLATE_IDS.notebookTemplateDraftIdentifier,
          title: 'Cell Viability Assay',
          status: 'draft',
          createdByUserId: FIXTURE_USER_ID,
        })
        .onConflictDoUpdate({
          target: schema.records.id,
          set: {
            title: 'Cell Viability Assay',
            status: 'draft',
            archivedAt: null,
            deletedAt: null,
          },
        })
      await db
        .insert(schema.blocks)
        .values({
          id: DEMO_TEMPLATE_IDS.notebookTemplateDraftBlock1,
          recordId: DEMO_TEMPLATE_IDS.notebookTemplateDraft,
          type: 'rich_text',
          payload: {
            doc: {
              type: 'doc',
              content: [
                {
                  type: 'heading',
                  attrs: { level: 2 },
                  content: [{ type: 'text', text: 'Overview' }],
                },
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: 'Draft template for measuring cell viability using MTT assay. Work in progress.',
                    },
                  ],
                },
              ],
            },
          },
          order: 1,
          createdByUserId: FIXTURE_USER_ID,
        })
        .onConflictDoUpdate({
          target: schema.blocks.id,
          set: {
            type: 'rich_text',
            payload: {
              doc: {
                type: 'doc',
                content: [
                  {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Overview' }],
                  },
                  {
                    type: 'paragraph',
                    content: [
                      {
                        type: 'text',
                        text: 'Draft template for measuring cell viability using MTT assay. Work in progress.',
                      },
                    ],
                  },
                ],
              },
            },
            order: 1,
          },
        })
    },
  },
  {
    name: 'demo SCI-006 archived protocol template: ELISA Protocol',
    run: async (db) => {
      await db
        .insert(schema.records)
        .values({
          id: DEMO_TEMPLATE_IDS.protocolTemplateArchived,
          workspaceId: FIXTURE_WORKSPACE_ID,
          projectId: null,
          kind: 'protocol_template',
          identifier: DEMO_TEMPLATE_IDS.protocolTemplateArchivedIdentifier,
          title: 'ELISA Protocol (Archived)',
          status: 'active',
          properties: { version: '1.0' },
          archivedAt: new Date('2025-06-01T00:00:00Z'),
          createdByUserId: FIXTURE_USER_ID,
        })
        .onConflictDoUpdate({
          target: schema.records.id,
          set: {
            title: 'ELISA Protocol (Archived)',
            status: 'active',
            properties: { version: '1.0' },
            archivedAt: new Date('2025-06-01T00:00:00Z'),
            deletedAt: null,
          },
        })
      await db
        .insert(schema.blocks)
        .values({
          id: DEMO_TEMPLATE_IDS.protocolTemplateArchivedBlock1,
          recordId: DEMO_TEMPLATE_IDS.protocolTemplateArchived,
          type: 'procedure_step',
          payload: {
            text: 'Coat plate with capture antibody overnight at 4 °C.',
            stepNumber: 1,
          },
          order: 1,
          createdByUserId: FIXTURE_USER_ID,
        })
        .onConflictDoUpdate({
          target: schema.blocks.id,
          set: {
            type: 'procedure_step',
            payload: {
              text: 'Coat plate with capture antibody overnight at 4 °C.',
              stepNumber: 1,
            },
            order: 1,
          },
        })
    },
  },
  {
    name: 'demo SCI-006 instantiated record from template with source link',
    run: async (db) => {
      // Create the instantiated experiment record
      await db
        .insert(schema.records)
        .values({
          id: DEMO_TEMPLATE_IDS.instantiatedRecord,
          workspaceId: FIXTURE_WORKSPACE_ID,
          projectId: DEMO_VIRUS_STABILITY_PROJECT_ID,
          kind: 'experiment',
          identifier: DEMO_TEMPLATE_IDS.instantiatedRecordIdentifier,
          title: 'Stability Study — Batch 2025-001',
          status: 'draft',
          createdByUserId: FIXTURE_USER_ID,
        })
        .onConflictDoUpdate({
          target: schema.records.id,
          set: {
            title: 'Stability Study — Batch 2025-001',
            status: 'draft',
            archivedAt: null,
            deletedAt: null,
          },
        })

      // Deep-copied blocks from the template (matching the template's blocks)
      const copiedBlocks = [
        {
          id: DEMO_TEMPLATE_IDS.instantiatedBlock1,
          type: 'rich_text' as const,
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
                      text: 'Evaluate the stability of the drug substance under ICH-accelerated conditions (40 °C / 75% RH) over 6 months.',
                    },
                  ],
                },
              ],
            },
          },
          order: 1,
        },
        {
          id: DEMO_TEMPLATE_IDS.instantiatedBlock2,
          type: 'checklist' as const,
          payload: {
            items: [
              {
                text: 'Prepare stability chambers at 40 °C / 75% RH',
                checked: false,
              },
              {
                text: 'Assign time points: T=0, 1, 2, 3, 6 months',
                checked: false,
              },
              {
                text: 'Define acceptance criteria (potency ≥ 90%, impurities ≤ 5%)',
                checked: false,
              },
            ],
          },
          order: 2,
        },
        {
          id: DEMO_TEMPLATE_IDS.instantiatedBlock3,
          type: 'callout' as const,
          payload: {
            text: 'Follow ICH Q1A(R2) guidelines for accelerated stability testing.',
            variant: 'info',
          },
          order: 3,
        },
      ]
      for (const block of copiedBlocks) {
        await db
          .insert(schema.blocks)
          .values({
            id: block.id,
            recordId: DEMO_TEMPLATE_IDS.instantiatedRecord,
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

      // Immutable revision of the template at instantiation time
      await db
        .insert(schema.revisions)
        .values({
          id: DEMO_TEMPLATE_IDS.templateRevision,
          recordId: DEMO_TEMPLATE_IDS.notebookTemplateValidated,
          structureVersion: 1,
          metadataVersion: 1,
          metadataSnapshot: {
            id: DEMO_TEMPLATE_IDS.notebookTemplateValidated,
            identifier: DEMO_TEMPLATE_IDS.notebookTemplateValidatedIdentifier,
            title: 'Stability Study (ICH)',
            status: 'validated',
            properties: {},
            tags: [],
            metadataVersion: 1,
            kind: 'notebook_template',
          },
          blockSnapshot: [
            {
              id: DEMO_TEMPLATE_IDS.notebookTemplateBlock1,
              type: 'rich_text',
              payload: copiedBlocks[0].payload,
              payload_schema_version: 1,
              order: 1,
              version: 1,
            },
            {
              id: DEMO_TEMPLATE_IDS.notebookTemplateBlock2,
              type: 'checklist',
              payload: copiedBlocks[1].payload,
              payload_schema_version: 1,
              order: 2,
              version: 1,
            },
            {
              id: DEMO_TEMPLATE_IDS.notebookTemplateBlock3,
              type: 'callout',
              payload: copiedBlocks[2].payload,
              payload_schema_version: 1,
              order: 3,
              version: 1,
            },
          ],
          reason: 'validate',
          createdByUserId: FIXTURE_USER_ID,
        })
        .onConflictDoNothing({ target: schema.revisions.id })

      // Source-template link with revision provenance
      await db
        .insert(schema.recordLinks)
        .values({
          id: DEMO_TEMPLATE_IDS.templateLink,
          sourceRecordId: DEMO_TEMPLATE_IDS.instantiatedRecord,
          targetRecordId: DEMO_TEMPLATE_IDS.notebookTemplateValidated,
          targetKind: 'notebook_template',
          targetIdentifier:
            DEMO_TEMPLATE_IDS.notebookTemplateValidatedIdentifier,
          linkType: 'template',
          linkMetadata: {
            template_revision_id: DEMO_TEMPLATE_IDS.templateRevision,
          },
          createdByUserId: FIXTURE_USER_ID,
        })
        .onConflictDoUpdate({
          target: schema.recordLinks.id,
          set: {
            targetRecordId: DEMO_TEMPLATE_IDS.notebookTemplateValidated,
            targetKind: 'notebook_template',
            targetIdentifier:
              DEMO_TEMPLATE_IDS.notebookTemplateValidatedIdentifier,
            linkType: 'template',
            linkMetadata: {
              template_revision_id: DEMO_TEMPLATE_IDS.templateRevision,
            },
          },
        })
    },
  },
  // -------------------------------------------------------------------------
  // OPS-007: Report Builder demo data. The first report is deliberately ready
  // to export; the second retains stale live references to exercise the export
  // gate. Created through the same RPCs the UI uses (create_report_definition,
  // add_report_section) so invariants fire. Idempotent: lookup-or-create by
  // document_identifier and reconcile the seeded sections on every run.
  // -------------------------------------------------------------------------
  {
    name: 'demo OPS-007 report builder: reports and sections',
    run: async (db) => {
      const poolCs = db.$client.options.connectionString
      if (!poolCs)
        throw new Error(
          'drizzle pool connection string is required for OPS-007 seed',
        )
      const pgrst = new URL(process.env.PGRST_DB_URI ?? '')
      if (!pgrst.username)
        throw new Error('PGRST_DB_URI is required for OPS-007 seed')
      const authUrl = new URL(poolCs)
      authUrl.username = pgrst.username
      authUrl.password = pgrst.password
      const client = new Client({ connectionString: authUrl.toString() })
      await client.connect()
      try {
        await client.query('SET ROLE authenticated')
        await client.query("SELECT set_config('request.jwt.claims',$1,false)", [
          JSON.stringify({
            sub: FIXTURE_USER_ID,
            workspace_id: FIXTURE_WORKSPACE_ID,
            role: 'authenticated',
          }),
        ])

        const rpc = async (name: string, params: unknown[]) => {
          const args = params.map((_, i) => `$${i + 1}`).join(',')
          return client.query(`select * from api.${name}(${args})`, params)
        }

        interface ReportDef {
          title: string
          subtitle: string
          docId: string
          status: 'draft' | 'in_review'
          projectId: string
          sections: Array<{
            title: string
            description: string
            sectionType: string
            sourceType: string
            validationStatus: string
          }>
        }

        const reports: ReportDef[] = [
          {
            title: 'Virus Stability Study Report',
            subtitle:
              'Comprehensive stability analysis of LVV-CAR-T vector at 4 °C',
            docId: 'RPT-2026-0001',
            status: 'in_review',
            projectId: DEMO_VIRUS_STABILITY_PROJECT_ID,
            sections: [
              {
                title: 'Executive Summary',
                description:
                  'Summary of stability findings and recommendations for the LVV-CAR-T drug substance.',
                sectionType: 'text',
                sourceType: 'free_text',
                validationStatus: 'valid',
              },
              {
                title: 'Materials and Methods',
                description:
                  'qPCR titration assay protocol, storage conditions, and timepoint schedule.',
                sectionType: 'text',
                sourceType: 'free_text',
                validationStatus: 'valid',
              },
              {
                title: 'Stability Data — Titer Curve',
                description:
                  'Frozen chart snapshot of vector genome copy number across the 28-day window.',
                sectionType: 'text',
                sourceType: 'free_text',
                validationStatus: 'valid',
              },
              {
                title: 'Raw Data References',
                description:
                  'Links to the underlying qPCR export files and plate maps.',
                sectionType: 'text',
                sourceType: 'free_text',
                validationStatus: 'valid',
              },
              {
                title: 'Conclusions',
                description:
                  'The vector remains within potency specification through day 21 at 4 °C.',
                sectionType: 'text',
                sourceType: 'free_text',
                validationStatus: 'valid',
              },
            ],
          },
          {
            title: 'QC Trend Analysis — Q3 2026',
            subtitle:
              'Cross-project quality control metrics and exception review',
            docId: 'RPT-2026-0002',
            status: 'draft',
            projectId: DEMO_VIRUS_STABILITY_PROJECT_ID,
            sections: [
              {
                title: 'Overview',
                description:
                  'Quarterly QC performance summary across all active projects.',
                sectionType: 'text',
                sourceType: 'free_text',
                validationStatus: 'pending',
              },
              {
                title: 'Assay Performance Metrics',
                description:
                  'Pass/fail rates, CV trends, and outlier flags for all QC assays.',
                sectionType: 'table',
                sourceType: 'table_block',
                validationStatus: 'valid',
              },
              {
                title: 'Exception Log',
                description:
                  'Documented deviations, investigations, and CAPA status.',
                sectionType: 'text',
                sourceType: 'free_text',
                validationStatus: 'missing_source',
              },
              {
                title: 'Locked Reference Snapshot',
                description:
                  'Frozen regulatory snapshot from the previous quarter for comparison.',
                sectionType: 'composite',
                sourceType: 'revision_block',
                validationStatus: 'locked',
              },
            ],
          },
        ]

        for (const report of reports) {
          // Lookup-or-create by document_identifier.
          const found = await client.query(
            'select id from api.report_definitions where workspace_id=$1 and document_identifier=$2',
            [FIXTURE_WORKSPACE_ID, report.docId],
          )
          let reportId: string
          if (found.rowCount) {
            reportId = found.rows[0].id as string
          } else {
            const res = await rpc('create_report_definition', [
              FIXTURE_WORKSPACE_ID,
              report.title,
              report.subtitle,
              report.projectId,
            ])
            reportId = res.rows[0].id as string
            // Pin the stable document_identifier (RPC auto-generates one).
            await client.query(
              'update api.report_definitions set document_identifier=$1 where id=$2',
              [report.docId, reportId],
            )
          }

          // Refresh title, subtitle, and status so reruns converge even if a
          // prior deployment created a report with the same auto-generated
          // identifier (e.g. via the UI "New report" button).
          await client.query(
            'update api.report_definitions set title=$1, subtitle=$2, status=$3 where id=$4 and workspace_id=$5',
            [
              report.title,
              report.subtitle,
              report.status,
              reportId,
              FIXTURE_WORKSPACE_ID,
            ],
          )

          // Add sections only if none exist yet.
          const existing = await client.query(
            'select count(*)::int as n from api.report_sections where report_id=$1',
            [reportId],
          )
          if (existing.rows[0].n === 0) {
            for (const sec of report.sections) {
              await rpc('add_report_section', [
                FIXTURE_WORKSPACE_ID,
                reportId,
                sec.title,
                sec.description,
                sec.sectionType,
                sec.sourceType,
              ])
            }
          }

          // Reconcile the seed fields on every run. This replaces stale source
          // configuration from a previous demo seed instead of merely painting
          // a validation status that validate_report will immediately reject.
          const sections = await client.query(
            'select id, title from api.report_sections where report_id=$1 order by position',
            [reportId],
          )
          for (const [i, target] of report.sections.entries()) {
            const row = sections.rows[i]
            if (!row) break
            await client.query(
              `update api.report_sections set
                title=$1,
                description=$2,
                section_type=$3,
                source_type=$4,
                source_revision_id=null,
                source_ref='{}'::jsonb,
                frozen_payload=$5::jsonb,
                validation_status=$6,
                validation_detail='{}'::jsonb
              where id=$7 and workspace_id=$8`,
              [
                target.title,
                target.description,
                target.sectionType,
                target.sourceType,
                JSON.stringify(
                  target.sourceType === 'free_text'
                    ? { text: target.description }
                    : {},
                ),
                target.validationStatus,
                row.id,
                FIXTURE_WORKSPACE_ID,
              ],
            )
          }
        }

        await client.query('RESET ROLE')
      } finally {
        await client.end()
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
  const withMonth = process.argv.includes('--month')
  const steps = [
    ...fixtureSteps,
    ...(withDemo ? demoSteps : []),
    ...(withMonth ? monthSteps : []),
  ]

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
