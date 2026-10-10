/**
 * UI system v3 design seed (DSYS-05). See docs/development/seeds.md.
 *
 * This incomplete fixture creates the people, workspaces and scientific data
 * for the original design screens. DESIGN_CLOCK is a display-data baseline,
 * not an override of native auth, signing, audit or worker clocks. Remaining
 * direct business-table writes are authority gaps, not accepted parity proof.
 */
import { createHmac, randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import * as schema from '../schema'
import type { SeedStep } from './run'
import {
  DESIGN_SESSION_IDS,
  DESIGN_WEBHOOK_IDS,
  FIXTURE_USER_ID,
} from './identities'

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
            set: { role: membership.role, clientId: null },
          })
      }
      await withDesignClaims(
        db,
        DESIGN_USER_IDS.gareth,
        PROCESS,
        async (client) => {
          const existing = await client.query(
            'select 1 from api.workspace_settings where workspace_id=$1',
            [PROCESS],
          )
          if (!existing.rowCount) {
            // The settings authority supplies Europe/London. Do not rewrite an
            // existing workspace's timezone or signature policy on reseed.
            await client.query('select api.update_workspace_settings($1)', [
              PROCESS,
            ])
          }
        },
      )
    },
  },
  {
    name: 'design projects',
    run: async (db) => {
      for (const project of DESIGN_PROJECTS) {
        const details = DESIGN_PROJECT_DETAILS.find(
          (detail) => detail.id === project.id,
        )
        await db
          .insert(schema.projects)
          .values({
            id: project.id,
            workspaceId: project.workspaceId,
            key: project.key,
            title: project.title,
            // The native project-owner trigger needs the actual declared lead
            // at creation, not a late metadata update or a workspace bypass.
            leadUserId: details?.lead,
          })
          .onConflictDoUpdate({
            target: [schema.projects.workspaceId, schema.projects.key],
            set: { title: project.title },
          })
      }
      await seedDesignProjectAccess(db)
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
    name: 'design reagent fields',
    run: async (db) => {
      for (const field of DESIGN_REAGENT_FIELDS) {
        await db
          .insert(schema.recordFieldDefinitions)
          .values({
            id: field.id,
            workspaceId: PROCESS,
            kind: 'reagent',
            fieldName: field.fieldName,
            label: field.label,
            displayOrder: field.displayOrder,
            logicalType: field.logicalType,
            nullable: field.nullable,
            validation: {},
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
              validation: {},
              lifecycle: 'active',
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
            customFields: material.customFields ?? {},
            createdByUserId: DESIGN_USER_IDS.gareth,
          })
          .onConflictDoUpdate({
            target: [schema.records.projectId, schema.records.identifier],
            set: {
              title: material.title,
              status: material.status,
              properties: material.properties,
              customFields: material.customFields ?? {},
              deletedAt: null,
              archivedAt: null,
            },
          })
      }
      // The fixture set is the whole truth for this project: a material the design
      // no longer lists is retired here, so a reseed cannot leave a stale lot
      // behind (an upsert alone never removes one).
      await db.execute(sql`
        DELETE FROM api.records
         WHERE project_id = ${DESIGN_PROJECTS[0].id}
           AND kind = 'reagent'
           AND identifier <> ALL (${sql.raw(
             `ARRAY[${DESIGN_MATERIALS.map((material) => `'${material.identifier}'`).join(',')}]`,
           )})
      `)
      // Continue the MAT- sequence after the seeded lots: the design's workspace
      // settings show MAT-0421 as the next material, so a new lot is 0421 rather
      // than re-issuing an existing identifier.
      const lastMaterial = Math.max(
        ...DESIGN_MATERIALS.map((material) =>
          Number(material.identifier.split('-')[1]),
        ),
      )
      await db.execute(sql`
        INSERT INTO internal.id_sequences (workspace_id, kind, last_number)
        VALUES (${PROCESS}, ${'reagent'}, ${lastMaterial})
        ON CONFLICT (workspace_id, kind)
        DO UPDATE SET last_number = greatest(
          internal.id_sequences.last_number,
          ${lastMaterial}
        )
      `)
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
        const insertedRecord = await db
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
          .onConflictDoNothing()
          .returning({ id: schema.records.id })
        if (insertedRecord.length === 0) continue
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
            .onConflictDoNothing()
        }
      }
    },
  },
  {
    name: 'design material usage',
    run: async (db) => {
      // The registry inspector lists the experiments that cite a lot. The design's
      // MAT-0420 panel shows EXP-0142 using one unit on 23 Sep, so the link carries
      // the quantity and the date the usage happened.
      await db.execute(sql`
        INSERT INTO api.record_links
          (source_record_id, target_record_id, target_kind, target_identifier, link_type,
           link_metadata, created_by_user_id, created_at)
        VALUES (${'00000000-0000-4000-8000-000000000351'},
                ${'00000000-0000-4000-8000-0000000003a8'},
                'reagent', 'MAT-0420', 'reagent',
                ${'{"quantity":1,"unit":"units","usedOn":"2026-09-23"}'}::jsonb,
                ${DESIGN_USER_IDS.gareth},
                ${'2026-09-23T00:00:00Z'})
        ON CONFLICT (source_record_id, target_identifier, link_type) DO NOTHING
      `)

      // LAB-04.2: the lot's certificate of analysis is a file, not a text field.
      // The file is a record of its own, created through the canonical upload RPC
      // and linked to the lot, which is how the file surfaces anywhere else.
      await withDesignClaims(
        db,
        DESIGN_USER_IDS.gareth,
        DESIGN_WORKSPACE_IDS.processDevelopment,
        async (client) => {
          const existing = await client.query<{
            id: string
            identifier: string
          }>(
            `select r.id, r.identifier from api.records r
               join api.file_objects f on f.record_id = r.id
              where r.project_id = $1 and f.display_name = $2`,
            ['00000000-0000-4000-8000-000000000320', 'CoA_L-77310.pdf'],
          )
          // create_file_upload returns a record composite, which the client sees as
          // an opaque string; select its fields in the same statement instead.
          // The upload RPC returns a record composite, which the client sees as an
          // opaque string; look the file up by its file object id instead. An
          // existing certificate is reused, so a reseed does not re-upload it.
          if ((existing.rowCount ?? 0) === 0) {
            await client.query(
              'select api.create_file_upload($1,$2,$3,$4,$5,$6,$7,$8)',
              [
                '00000000-0000-4000-8000-000000000320',
                'CoA_L-77310.pdf',
                'application/pdf',
                148_912,
                `${DESIGN_WORKSPACE_IDS.processDevelopment}/00000000-0000-4000-8000-0000000007a0/${'a'.padStart(32, '0')}`,
                null,
                'local',
                '00000000-0000-4000-8000-0000000007a0',
              ],
            )
          }
          const created = await client.query<{
            id: string
            identifier: string
          }>(
            `select r.id, r.identifier from api.records r
               join api.file_objects f on f.record_id = r.id
              where f.id = $1`,
            ['00000000-0000-4000-8000-0000000007a0'],
          )
          const file = created.rows.at(0) ?? existing.rows.at(0)
          if (!file) throw new Error('certificate file not created')
          await client.query(
            `insert into api.record_links
               (source_record_id, target_record_id, target_kind, target_identifier,
                link_type, link_metadata, created_by_user_id)
             values ($1,$2,'file',$3,'file',$4::jsonb,$5)
             on conflict (source_record_id, target_identifier, link_type) do nothing`,
            [
              '00000000-0000-4000-8000-0000000003a8',
              file.id,
              file.identifier,
              JSON.stringify({ relation: 'certificate' }),
              DESIGN_USER_IDS.gareth,
            ],
          )
        },
        DESIGN_SESSION_IDS.gareth,
      )
    },
  },
  {
    // After `design experiments` so the consume purpose (EXP-0139) exists.
    name: 'design sample custody',
    run: (db) => seedDesignSampleCustody(db),
  },
  {
    // LAB-03: the harvest lot's custody ledger and the derived-sample lineage
    // edges the sample detail, lineage and usage tabs read.
    name: 'design sample lineage',
    run: (db) => seedDesignSampleLineage(db),
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
  {
    name: 'design projects board access',
    run: (db) => seedDesignProjectsBoardAccess(db),
  },
  {
    name: 'design sessions',
    run: (db) => seedDesignSessions(db),
  },
  {
    name: 'design sheets',
    run: (db) => seedDesignSheets(db),
  },
  {
    name: 'design review lifecycle',
    run: (db) => seedDesignReviewLifecycle(db),
  },
  {
    name: 'design folders and files',
    run: (db) => seedDesignFoldersAndFiles(db),
  },
  {
    name: 'design connectors and tokens',
    run: (db) => seedDesignConnectorsAndTokens(db),
  },
  {
    name: 'design webhook deliveries',
    run: (db) => seedDesignWebhookDeliveries(db),
  },
  {
    name: 'design client portal',
    run: (db) => seedDesignClientPortal(db),
  },
  {
    // Last: snapshotting a dataset stamps `updated_at`, so pin the design
    // clock's dates once every dataset step has run.
    name: 'design clock',
    run: (db) => seedDesignClock(db),
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
  /** Model-declared lot detail, stored in custom_fields. */
  customFields?: Record<string, unknown>
}> = [
  {
    id: '00000000-0000-4000-8000-0000000003a0',
    identifier: 'MAT-0342',
    title: 'TFF cassette, 100 kDa',
    status: 'available',
    properties: {
      supplier: 'Supplier G',
      lot: 'T-8810',
      expiry: '2027-08-31',
      quantity: 4,
      unit: 'units',
      storage: 'Consumables store, bay 1',
    },
  },
  {
    id: '00000000-0000-4000-8000-0000000003a1',
    identifier: 'MAT-0355',
    title: 'Pluronic F-68, 10 %',
    status: 'expired',
    properties: {
      supplier: 'Supplier D',
      lot: 'PL-202',
      expiry: '2026-09-20',
      quantity: 0.2,
      unit: 'L',
      storage: 'Room temp store',
    },
  },
  {
    id: '00000000-0000-4000-8000-0000000003a2',
    identifier: 'MAT-0366',
    title: 'HEK293 expression medium',
    status: 'available',
    properties: {
      supplier: 'Supplier E',
      lot: 'M-3301',
      expiry: '2026-11-30',
      quantity: 18,
      unit: 'L',
      storage: 'Cold room CR-1',
    },
  },
  {
    id: '00000000-0000-4000-8000-0000000003a3',
    identifier: 'MAT-0371',
    title: 'PEI transfection reagent',
    status: 'available',
    properties: {
      supplier: 'Supplier D',
      lot: 'P-9914',
      expiry: '2027-02-28',
      quantity: 42,
      unit: 'mL',
      storage: 'F-1 (2–8 °C)',
    },
  },
  {
    id: '00000000-0000-4000-8000-0000000003a4',
    identifier: 'MAT-0377',
    title: 'Capsid ELISA kit',
    status: 'available',
    properties: {
      supplier: 'Supplier C',
      lot: 'K-2208',
      expiry: '2026-12-31',
      quantity: 2,
      unit: 'plates',
      storage: 'F-2 (2–8 °C)',
    },
  },
  {
    id: '00000000-0000-4000-8000-0000000003a5',
    identifier: 'MAT-0402',
    title: 'AEX resin, 5 mL column',
    status: 'quarantined',
    properties: {
      supplier: 'Supplier F',
      lot: 'R-1170',
      expiry: '2027-06-18',
      quantity: 3,
      unit: 'columns',
      storage: 'Consumables store, bay 2',
    },
  },
  {
    id: '00000000-0000-4000-8000-0000000003a6',
    identifier: 'MAT-0418',
    title: 'Filter train A, two-stage depth',
    status: 'available',
    properties: {
      supplier: 'Supplier A',
      lot: 'L-54988',
      expiry: '2027-01-31',
      quantity: 5,
      unit: 'units',
      storage: 'Consumables store, bay 4',
    },
  },
  {
    id: '00000000-0000-4000-8000-0000000003a7',
    identifier: 'MAT-0419',
    title: 'Filter train B, two-stage depth',
    status: 'available',
    properties: {
      supplier: 'Supplier A',
      lot: 'L-55021',
      expiry: '2027-03-31',
      quantity: 6,
      unit: 'units',
      storage: 'Consumables store, bay 4',
    },
  },
  {
    id: '00000000-0000-4000-8000-0000000003a8',
    identifier: 'MAT-0420',
    title: 'Filter train C, single-stage depth',
    status: 'available',
    properties: {
      supplier: 'Supplier B',
      catalog_no: 'DF-C0SP-01',
      lot: 'L-77310',
      expiry: '2026-10-01',
      quantity: 2,
      unit: 'units',
      storage: 'Consumables store, bay 4',
    },
    customFields: {
      initial_quantity: 6,
      received: '2026-06-04',
      released_by: 'QC',
      released_at: '2026-06-06',
      certificate: 'CoA_L-77310.pdf',
    },
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

/**
 * Reagent lot detail the registry inspector shows. Declared as model fields so
 * the record guard accepts the values in custom_fields; the legacy properties
 * allow-list is fixed and cannot carry them.
 */
const DESIGN_REAGENT_FIELDS: ReadonlyArray<{
  id: string
  fieldName: string
  label: string
  displayOrder: number
  logicalType: 'text' | 'decimal' | 'date'
  nullable: boolean
}> = [
  {
    id: '00000000-0000-4000-8000-000000000340',
    fieldName: 'initial_quantity',
    label: 'Quantity received',
    displayOrder: 1,
    logicalType: 'decimal',
    nullable: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000341',
    fieldName: 'received',
    label: 'Received',
    displayOrder: 2,
    logicalType: 'date',
    nullable: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000342',
    fieldName: 'released_by',
    label: 'Released by',
    displayOrder: 3,
    logicalType: 'text',
    nullable: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000343',
    fieldName: 'released_at',
    label: 'Released on',
    displayOrder: 4,
    logicalType: 'date',
    nullable: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000344',
    fieldName: 'certificate',
    label: 'Certificate',
    displayOrder: 5,
    logicalType: 'text',
    nullable: true,
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
    // LAB-03 adds the registry fields the design's detail shows: the cell
    // harvest type, the 15,000 mL registered lot and its cold-room location.
    properties: {
      sampleType: 'Cell harvest',
      quantity: 4600,
      quantityUnit: 'mL',
      storageLocation: 'Cold room CR-1, shelf 3',
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
    properties: {
      sampleType: 'Filtrate',
      quantity: 14.2,
      quantityUnit: 'mL',
      storageLocation: 'F-2, box 14, A9',
    },
  },
  {
    id: '00000000-0000-4000-8000-000000000365',
    identifier: 'SMP-2249',
    title: 'C-150 filtrate, 1:5 dilution',
    status: 'available',
    customFields: { construct: 'AAV9', batch: 'C-150' },
    properties: {
      sampleType: 'Dilution',
      quantity: 1,
      quantityUnit: 'mL',
      storageLocation: 'Plate 4, G1–G2',
    },
  },
  {
    id: '00000000-0000-4000-8000-000000000366',
    identifier: 'SMP-2250',
    title: 'Feed retain',
    status: 'available',
    customFields: { construct: 'AAV9', batch: 'C-150' },
    properties: {
      sampleType: 'Retain',
      quantity: 50,
      quantityUnit: 'mL',
      storageLocation: 'F-2, box 14, B1',
    },
  },
  {
    id: '00000000-0000-4000-8000-000000000367',
    identifier: 'SMP-2238',
    title: 'AMB-25-118 day 6',
    status: 'available',
    customFields: { construct: 'AAV9', batch: 'AMB-25-118' },
    properties: {
      sampleType: 'Culture sample',
      quantity: 2,
      quantityUnit: 'mL',
      storageLocation: 'F-1, box 3, C4',
    },
  },
  {
    id: '00000000-0000-4000-8000-000000000368',
    identifier: 'SMP-2236',
    title: 'LVV hold, day 7 aliquot',
    status: 'available',
    customFields: { construct: 'LVV-CAR-T', batch: 'LVV-hold' },
    properties: {
      sampleType: 'Stability pull',
      quantity: 0.5,
      quantityUnit: 'mL',
      storageLocation: 'F-4 (−80 °C), box 2',
    },
  },
  {
    id: '00000000-0000-4000-8000-000000000369',
    identifier: 'SMP-2227',
    title: 'HEK293 WCB-2, vial 12',
    status: 'available',
    customFields: { construct: 'AAV9', batch: 'WCB-2' },
    properties: {
      sampleType: 'Cell bank vial',
      quantity: 1,
      quantityUnit: 'vial',
      storageLocation: 'LN2 tank 2, rack C, 4',
    },
  },
  {
    id: '00000000-0000-4000-8000-00000000036a',
    identifier: 'SMP-2220',
    title: 'pAAV9-RC, lot P-117',
    status: 'quarantined',
    customFields: { construct: 'AAV9', batch: 'P-117' },
    properties: {
      sampleType: 'Plasmid',
      quantity: 12.5,
      quantityUnit: 'mg',
      storageLocation: 'F-3 (−20 °C), box 7',
    },
  },
  {
    id: '00000000-0000-4000-8000-00000000036b',
    identifier: 'SMP-2214',
    title: 'R1.0 filtrate, hold',
    status: 'available',
    customFields: { construct: 'AAV9', batch: 'R1.0' },
  },
  {
    // SampleConsumed: the design's fully-used viral harvest. The record carries
    // its final state (0 mL, consumed); `seedDesignSampleCustody` writes the
    // canonical register/consume ledger at the design clock's dates.
    id: '00000000-0000-4000-8000-00000000036c',
    identifier: 'SMP-2210',
    title: 'LVV harvest H-22',
    status: 'consumed',
    customFields: { construct: 'LVV', batch: 'H-22' },
    properties: {
      sampleType: 'Viral harvest',
      quantity: 0,
      quantityUnit: 'mL',
    },
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
  {
    // Created here (before the design datasets) as well as in the project
    // details step, because the AAV full/empty and LVV chromatography datasets
    // link to them and the dataset insert checks the project's workspace.
    id: '00000000-0000-4000-8000-000000000328',
    workspaceId: DESIGN_WORKSPACE_IDS.processDevelopment,
    key: 'aav-full-empty-assay-qualification',
    title: 'AAV full/empty assay qualification',
  },
  {
    id: '00000000-0000-4000-8000-00000000032e',
    workspaceId: DESIGN_WORKSPACE_IDS.processDevelopment,
    key: 'lvv-downstream-chromatography',
    title: 'LVV downstream chromatography',
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
  /** Design-clock updated time; the list shows it as the dataset's "Updated". */
  updatedAt: Date
  createdAt?: Date
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
  { key: 'condition', label: 'Condition', logicalType: 'text' },
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
    // A capsid ELISA counts capsid particles, and the design states the ELISA
    // dataset's capsid titre as "8.6 x 10^11 cp/mL" (the bench-reading schema has
    // its own field, so this unit only affects the ELISA datasets).
    unit: '×10¹¹ cp/mL',
  },
  {
    key: 'turbidity',
    label: 'Turbidity',
    logicalType: 'decimal',
    unit: 'NTU',
    validation: {
      extensions: {
        systemFlags: { out_of_range: { min: 0, max: 50 } },
      },
    },
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

/**
 * DSET — the remaining datasets the design's Datasets list shows. Each carries
 * the exact row count from the design so the list's Rows column matches.
 */
const FILTRATION_FIELDS: ReadonlyArray<DesignDatasetField> = [
  { key: 'run', label: 'Run', logicalType: 'text', required: true },
  { key: 'time_min', label: 'Time', logicalType: 'integer', unit: 'min' },
  {
    key: 'pressure_bar',
    label: 'Pressure',
    logicalType: 'decimal',
    unit: 'bar',
  },
  { key: 'flow_lpm', label: 'Flow', logicalType: 'decimal', unit: 'L/min' },
]

const VICELL_FIELDS: ReadonlyArray<DesignDatasetField> = [
  { key: 'sample', label: 'Sample', logicalType: 'text', required: true },
  {
    key: 'vcd',
    label: 'VCD',
    logicalType: 'decimal',
    unit: '×10⁶ cells/mL',
  },
  { key: 'viability', label: 'Viability', logicalType: 'decimal', unit: '%' },
]

const DDPCR_FIELDS: ReadonlyArray<DesignDatasetField> = [
  { key: 'sample', label: 'Sample', logicalType: 'text', required: true },
  {
    key: 'dilution',
    label: 'Dilution',
    logicalType: 'integer',
    required: true,
  },
  {
    key: 'genome_titre',
    label: 'Genome titre',
    logicalType: 'decimal',
    unit: '×10¹⁰ vg/mL',
    required: true,
  },
]

const AUC_FIELDS: ReadonlyArray<DesignDatasetField> = [
  { key: 'sample', label: 'Sample', logicalType: 'text', required: true },
  { key: 'ratio', label: 'Full/empty ratio', logicalType: 'decimal' },
]

const CHROMATOGRAPHY_FIELDS: ReadonlyArray<DesignDatasetField> = [
  { key: 'fraction', label: 'Fraction', logicalType: 'text', required: true },
  { key: 'volume_ml', label: 'Volume', logicalType: 'decimal', unit: 'mL' },
  { key: 'purity', label: 'Purity', logicalType: 'decimal', unit: '%' },
]

const DESIGN_DATASETS: ReadonlyArray<DesignDataset> = [
  {
    // DatasetsList (app-3 order): the seven rows the design's list opens with,
    // inserted in that order. Row counts match the design's Rows column.
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
    updatedAt: new Date('2026-09-25T09:12:00+01:00'),
    createdAt: new Date('2026-09-18T09:00:00+01:00'),
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
    id: '00000000-0000-4000-8000-0000000003f0',
    workspaceId: DESIGN_WORKSPACE_IDS.processDevelopment,
    actorId: DESIGN_USER_IDS.gareth,
    projectId: '00000000-0000-4000-8000-000000000320',
    displayId: 'DS-0310',
    schemaKey: 'filtration_pressure_log',
    schemaName: 'Filtration run',
    name: 'Filtration pressure log',
    description: 'Transmembrane pressure and flux during clarification',
    fields: FILTRATION_FIELDS,
    updatedAt: new Date('2026-09-25T08:40:00+01:00'),
    createdAt: new Date('2026-09-25T08:12:00+01:00'),
    snapshotLabels: [],
    rows: () => filtrationRows(27),
  },
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
    updatedAt: new Date('2026-09-24T09:12:00+01:00'),
    createdAt: new Date('2026-09-18T08:40:00+01:00'),
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
    id: '00000000-0000-4000-8000-0000000003f2',
    workspaceId: DESIGN_WORKSPACE_IDS.processDevelopment,
    // No original creator is specified; Mei is this project's semantic lead.
    // This affects fresh creation only, never existing dataset/audit identity.
    actorId: DESIGN_USER_IDS.mei,
    projectId: '00000000-0000-4000-8000-000000000324',
    displayId: 'DS-0305',
    schemaKey: 'vicell_viability',
    schemaName: 'ViCell',
    name: 'HEK293 WCB viability panel',
    description: 'Viable cell density and viability across the WCB panel',
    fields: VICELL_FIELDS,
    updatedAt: new Date('2026-09-24T08:05:00+01:00'),
    createdAt: new Date('2026-09-19T13:20:00+01:00'),
    snapshotLabels: [],
    rows: () => vicellRows(48),
  },
  {
    id: '00000000-0000-4000-8000-0000000003f3',
    workspaceId: DESIGN_WORKSPACE_IDS.processDevelopment,
    actorId: DESIGN_USER_IDS.gareth,
    projectId: '00000000-0000-4000-8000-000000000320',
    displayId: 'DS-0303',
    schemaKey: 'vicell_viability',
    schemaName: 'ViCell',
    name: 'ViCell, transfection sweep',
    description: 'Viability at harvest for the transfection ratio sweep',
    fields: VICELL_FIELDS,
    updatedAt: new Date('2026-09-23T17:20:00+01:00'),
    createdAt: new Date('2026-09-23T16:40:00+01:00'),
    snapshotLabels: [],
    rows: () => vicellRows(8),
  },
  {
    id: '00000000-0000-4000-8000-0000000003f4',
    workspaceId: DESIGN_WORKSPACE_IDS.processDevelopment,
    actorId: DESIGN_USER_IDS.gareth,
    projectId: '00000000-0000-4000-8000-000000000320',
    displayId: 'DS-0302',
    schemaKey: 'ddpcr_titre',
    schemaName: 'ddPCR titre',
    name: 'ddPCR titre, transfection sweep',
    description: 'Genome titre by ddPCR for the transfection ratio sweep',
    fields: DDPCR_FIELDS,
    updatedAt: new Date('2026-09-23T15:58:00+01:00'),
    createdAt: new Date('2026-09-23T15:20:00+01:00'),
    snapshotLabels: [],
    rows: () => ddpcrRows(16),
  },
  {
    id: '00000000-0000-4000-8000-0000000003f5',
    workspaceId: DESIGN_WORKSPACE_IDS.processDevelopment,
    actorId: DESIGN_USER_IDS.gareth,
    projectId: '00000000-0000-4000-8000-000000000320',
    displayId: 'DS-0297',
    schemaKey: 'vicell_viability',
    schemaName: 'ViCell',
    name: 'ViCell, harvest timing',
    description: 'Viability at 48, 72 and 96 h harvest',
    fields: VICELL_FIELDS,
    updatedAt: new Date('2026-09-22T11:30:00+01:00'),
    createdAt: new Date('2026-09-22T10:50:00+01:00'),
    snapshotLabels: [],
    rows: () => vicellRows(9),
  },
  {
    id: '00000000-0000-4000-8000-0000000003f6',
    workspaceId: DESIGN_WORKSPACE_IDS.processDevelopment,
    actorId: DESIGN_USER_IDS.gareth,
    projectId: '00000000-0000-4000-8000-000000000320',
    displayId: 'DS-0296',
    schemaKey: 'ddpcr_titre',
    schemaName: 'ddPCR titre',
    name: 'ddPCR titre, harvest timing',
    description: 'Genome titre at 48, 72 and 96 h harvest',
    fields: DDPCR_FIELDS,
    updatedAt: new Date('2026-09-22T10:15:00+01:00'),
    createdAt: new Date('2026-09-22T09:40:00+01:00'),
    snapshotLabels: [],
    rows: () => ddpcrRows(18),
  },
  {
    id: '00000000-0000-4000-8000-0000000003f7',
    workspaceId: DESIGN_WORKSPACE_IDS.processDevelopment,
    // No original creator is specified; use the actual analytical project lead.
    actorId: DESIGN_USER_IDS.mei,
    projectId: '00000000-0000-4000-8000-000000000328',
    displayId: 'DS-0290',
    schemaKey: 'auc_full_empty_ratio',
    schemaName: 'AUC',
    name: 'AUC full/empty ratio',
    description:
      'Full and empty capsid ratio by analytical ultracentrifugation',
    fields: AUC_FIELDS,
    updatedAt: new Date('2026-09-19T14:00:00+01:00'),
    createdAt: new Date('2026-09-19T13:10:00+01:00'),
    snapshotLabels: [],
    rows: () => aucRows(30),
  },
  {
    id: '00000000-0000-4000-8000-0000000003f8',
    workspaceId: DESIGN_WORKSPACE_IDS.processDevelopment,
    actorId: DESIGN_USER_IDS.gareth,
    projectId: '00000000-0000-4000-8000-00000000032e',
    displayId: 'DS-0287',
    schemaKey: 'chromatography_fraction',
    schemaName: 'Chromatography fraction',
    name: 'AEX screen fractions',
    description: 'Fraction volumes and purity from the AEX resin screen',
    fields: CHROMATOGRAPHY_FIELDS,
    updatedAt: new Date('2026-09-18T16:45:00+01:00'),
    createdAt: new Date('2026-09-18T15:30:00+01:00'),
    snapshotLabels: [],
    rows: () => chromatographyRows(64),
  },
  {
    // MOB-02's planned plate; kept last so it does not displace a design row.
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
    updatedAt: new Date('2026-09-25T09:40:00+01:00'),
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
  // Immutable DatasetCompare's nine displayed readings. Nullable measurements
  // mean "not recorded", not zero. Values use the schema's ×10¹⁰ scale.
  const comparedReadings = [
    {
      sample: 'SMP-2248',
      condition: 'C-150',
      turbidity: 61.5,
      capsid_titre: null,
    },
    {
      sample: 'SMP-2249',
      condition: 'C-150 1:5',
      turbidity: 12.4,
      capsid_titre: null,
    },
    {
      sample: 'SMP-2249',
      condition: 'C-150 1:5',
      turbidity: 12.1,
      capsid_titre: null,
    },
    {
      sample: 'SMP-2249',
      condition: 'C-150 1:5',
      turbidity: null,
      capsid_titre: 5.4,
    },
    {
      sample: 'SMP-2249',
      condition: 'C-150 1:5',
      turbidity: null,
      capsid_titre: 5.5,
    },
    { sample: 'BLANK', condition: null, turbidity: 0.3, capsid_titre: null },
    { sample: 'BLANK', condition: null, turbidity: 0.2, capsid_titre: null },
    { sample: 'STD-4', condition: null, turbidity: null, capsid_titre: 10 },
    { sample: 'STD-4', condition: null, turbidity: null, capsid_titre: 10 },
  ]
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
      const rowNumber = plateIndex * 12 + wellIndex + 1
      const reading =
        rowNumber >= 88 ? comparedReadings[rowNumber - 88] : undefined
      // The design's SampleDetail cites "DS-0311 rows 1-2" for SMP-2231's capsid
      // titre, and the sample binding runs through the schema's sample text field,
      // so the dataset's first two rows carry that sample identifier.
      const sample =
        reading?.sample ??
        (rowNumber <= 2
          ? 'SMP-2231'
          : `S-${String(rowNumber).padStart(3, '0')}`)
      const dilution = [10, 100, 1000][wellIndex % 3]
      const capsidTitre = reading
        ? reading.capsid_titre
        : rowNumber <= 2
          ? // The two rows the design's sample detail cites for SMP-2231.
            8.6
          : Number(
              (3.4 + ((plateIndex * 12 + wellIndex) % 17) * 0.18).toFixed(2),
            )
      // DatasetCompare identifies these exact readings. They are measurement
      // inputs to the real row-batch validation, not manufactured flag rows.
      const turbidity = reading
        ? reading.turbidity
        : Number((4.2 + ((plateIndex * 7 + wellIndex) % 9) * 0.9).toFixed(1))
      const a260 = Number((0.52 + (wellIndex % 5) * 0.03).toFixed(3))
      const a280 = Number((0.31 + (wellIndex % 4) * 0.02).toFixed(3))
      const outOfRange = turbidity !== null && turbidity > 50
      rows.push({
        sample,
        condition: reading?.condition ?? null,
        plate,
        well,
        dilution,
        capsid_titre: capsidTitre,
        turbidity,
        a260,
        a280,
        ratio: Number((a260 / a280).toFixed(2)),
        out_of_range: outOfRange,
        note: outOfRange ? 'Turbidity outside 0–50 NTU' : null,
      })
    })
  })
  return rows
}

/** Deterministic rows for the datasets the design's list shows. */
function filtrationRows(count: number): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, i) => ({
    run: `R-${String(i + 1).padStart(2, '0')}`,
    time_min: i * 5,
    pressure_bar: Number((0.8 + (i % 7) * 0.12).toFixed(2)),
    flow_lpm: Number((2 + (i % 5) * 0.25).toFixed(2)),
  }))
}

function vicellRows(count: number): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, i) => ({
    sample: `S-${String(i + 1).padStart(3, '0')}`,
    vcd: Number((4.2 + (i % 9) * 0.7).toFixed(1)),
    viability: Number((96.8 - (i % 11) * 1.4).toFixed(1)),
  }))
}

function ddpcrRows(count: number): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, i) => ({
    sample: `S-${String(i + 1).padStart(3, '0')}`,
    dilution: [10, 100, 1000][i % 3],
    genome_titre: Number((3.1 + (i % 13) * 0.42).toFixed(2)),
  }))
}

function aucRows(count: number): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, i) => ({
    sample: `S-${String(i + 1).padStart(3, '0')}`,
    ratio: Number((78.5 + (i % 15) * 1.1).toFixed(1)),
  }))
}

function chromatographyRows(count: number): Array<Record<string, unknown>> {
  const letters = 'ABCDEFGH'
  return Array.from({ length: count }, (_, i) => ({
    fraction: `${letters[Math.floor(i / 8)]}${(i % 8) + 1}`,
    volume_ml: Number((12 + (i % 7) * 3.5).toFixed(1)),
    purity: Number((88 + (i % 10) * 1.1).toFixed(1)),
  }))
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
  sessionId?: string,
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
        ...(sessionId ? { session_id: sessionId } : {}),
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

        // Schema stewardship is workspace authority, not the dataset creator's
        // project Edit rule. Gareth retains the native schema authoring role;
        // the semantic project lead creates the scientific dataset below.
        const schemaVersionId = await withDesignClaims(
          db,
          DESIGN_USER_IDS.gareth,
          dataset.workspaceId,
          async (schemaClient) => {
            const definition = await schemaClient.query(
              'select id from api.dataset_schema_definitions where workspace_id = $1 and key = $2',
              [dataset.workspaceId, dataset.schemaKey],
            )
            let versionId: string
            if ((definition.rowCount ?? 0) > 0) {
              const version = await schemaClient.query(
                'select id, lifecycle from api.dataset_schema_versions where schema_id = $1 order by version desc limit 1',
                [definition.rows[0].id],
              )
              if (!(version.rowCount ?? 0)) {
                throw new Error(
                  `schema version missing for ${dataset.schemaKey}`,
                )
              }
              versionId = version.rows[0].id
              if (version.rows[0].lifecycle !== 'active') {
                await schemaClient.query(
                  'select api.replace_dataset_schema_version_fields($1,$2::jsonb)',
                  [versionId, JSON.stringify(datasetFieldsWire(dataset))],
                )
                await schemaClient.query(
                  'select api.publish_dataset_schema_version($1)',
                  [versionId],
                )
              }
            } else {
              const created = await schemaClient.query(
                'select api.create_dataset_schema_definition($1,$2,$3,$4,$5::jsonb) as result',
                [
                  dataset.workspaceId,
                  dataset.schemaKey,
                  dataset.schemaName,
                  dataset.description,
                  JSON.stringify(datasetFieldsWire(dataset)),
                ],
              )
              versionId = created.rows[0].result.schema_version_id
              await schemaClient.query(
                'select api.publish_dataset_schema_version($1)',
                [versionId],
              )
            }
            return versionId
          },
        )

        await client.query(
          `insert into api.datasets
           (id, workspace_id, schema_version_id, name, description, primary_project_id, created_by_user_id, display_id, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            dataset.id,
            dataset.workspaceId,
            schemaVersionId,
            dataset.name,
            dataset.description,
            dataset.projectId,
            dataset.actorId,
            dataset.displayId,
            dataset.createdAt ?? dataset.updatedAt,
            dataset.updatedAt,
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
              `design-${dataset.displayId}`,
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
    const dataset = await client.query<{ id: string }>(
      'select id from api.datasets where workspace_id = $1 and display_id = $2 and lifecycle = $3',
      [workspaceId, 'DS-0320', 'active'],
    )
    const datasetId = dataset.rows.at(0)?.id
    if (!datasetId) return

    for (const plannedKey of BENCH_READING_PLANNED_KEYS) {
      const existing = await client.query(
        'select 1 from api.dataset_rows where dataset_id = $1 and planned_key = $2 limit 1',
        [datasetId, plannedKey],
      )
      if ((existing.rowCount ?? 0) > 0) continue
      await client.query('select api.plan_dataset_row($1,$2,$3)', [
        datasetId,
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

  // Reviews waiting on Gareth are created through the canonical submit RPC by
  // `seedDesignReviewLifecycle`; the Inbox reads those rows.

  // Follow older first, preserving the intended newest-first order with real
  // server times. Existing follows are untouched, including their timestamps.
  await withDesignClaims(
    db,
    DESIGN_USER_IDS.gareth,
    PROCESS,
    async (client) => {
      for (const identifier of ['EXP-0138', 'EXP-0142']) {
        const record = await client.query<{ id: string }>(
          "select id from api.records where workspace_id=$1 and identifier=$2 and kind='experiment'",
          [PROCESS, identifier],
        )
        const recordId = record.rows.at(0)?.id
        if (!recordId) throw new Error(`record ${identifier} missing`)
        const existing = await client.query(
          'select 1 from api.work_item_follows where user_id=$1 and record_id=$2',
          [DESIGN_USER_IDS.gareth, recordId],
        )
        if (!existing.rowCount)
          await client.query('select api.follow_record($1)', [recordId])
      }
    },
  )

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
          isNull(schema.records.lockedAt),
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

  await withDesignClaims(
    db,
    DESIGN_USER_IDS.gareth,
    PROCESS,
    async (client) => {
      const project = await client.query<{
        id: string
        revision: string
        title: string
        client_id: string | null
        modality: string | null
        stage: string | null
        lead_user_id: string | null
        default_reviewer_user_id: string | null
        agreement_reference: string | null
        started_on: string | null
      }>(
        "select *,started_on::text from api.projects where workspace_id=$1 and key='aav9-process-transfer'",
        [PROCESS],
      )
      const current = project.rows.at(0)
      if (!current) throw new Error('AAV9 project details missing')
      if (
        current.started_on !== '2026-08-03' ||
        current.default_reviewer_user_id !== DESIGN_USER_IDS.mei ||
        current.agreement_reference !== 'MSA-017 · SOW-04'
      ) {
        // This RPC replaces every nullable detail; preserve the complete current
        // snapshot while setting the original board's domain inputs.
        await client.query(
          'select api.update_project_details($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
          [
            current.id,
            current.revision,
            current.title,
            current.client_id,
            current.modality,
            current.stage,
            current.lead_user_id,
            DESIGN_USER_IDS.mei,
            'MSA-017 · SOW-04',
            '2026-08-03',
          ],
        )
      }
      // Member added_at values remain real server times, not "joined today" proof.
    },
  )
}

/** Project access matrix from the design's Settings Access board, established
 * before scoped scientific writes. Group membership follows the design's
 * Settings Members board and Edit/Review/View stay independent flags, never a
 * display label. The review canvases name Gareth as an independent reviewer on
 * LVV and HEK293 where he is not the project lead, so those carry a
 * design-attested explicit Review rule. HEK293 is visible to the whole
 * workspace, as the design states. */
const DESIGN_ACCESS_GROUPS = {
  leads: 'Process Development leads',
  upstream: 'Upstream',
  downstream: 'Downstream',
  analytical: 'Analytical',
  qa: 'QA',
} as const

const DESIGN_ACCESS_GROUP_MEMBERS: Record<
  keyof typeof DESIGN_ACCESS_GROUPS,
  readonly string[]
> = {
  leads: [DESIGN_USER_IDS.gareth],
  upstream: [DESIGN_USER_IDS.priya, DESIGN_USER_IDS.tom],
  downstream: [DESIGN_USER_IDS.tom, DESIGN_USER_IDS.sam],
  analytical: [DESIGN_USER_IDS.mei],
  qa: [DESIGN_USER_IDS.anna],
}

interface DesignProjectRule {
  group?: keyof typeof DESIGN_ACCESS_GROUPS
  user?: string
  view: boolean
  edit: boolean
  review: boolean
}

const DESIGN_PROJECT_ACCESS: Record<string, readonly DesignProjectRule[]> = {
  // Edit: Process Development leads, Upstream, Downstream · Review: Analytical ·
  // View: QA
  'aav9-process-transfer': [
    { group: 'leads', view: true, edit: true, review: false },
    { group: 'upstream', view: true, edit: true, review: false },
    { group: 'downstream', view: true, edit: true, review: false },
    { group: 'analytical', view: true, edit: true, review: true },
    { group: 'qa', view: true, edit: false, review: false },
  ],
  // Edit: Upstream · Review: Analytical · View: QA, Gareth P.
  'lvv-stability-2-8c': [
    { group: 'upstream', view: true, edit: true, review: false },
    { group: 'analytical', view: true, edit: true, review: true },
    { group: 'qa', view: true, edit: false, review: false },
    { user: DESIGN_USER_IDS.gareth, view: true, edit: false, review: true },
  ],
  // Edit: Process Development leads, Upstream · Review: Analytical · View: QA
  'ambr-250-perfusion-scale-down': [
    { group: 'leads', view: true, edit: true, review: false },
    { group: 'upstream', view: true, edit: true, review: false },
    { group: 'analytical', view: true, edit: true, review: true },
    { group: 'qa', view: true, edit: false, review: false },
  ],
  // Edit: Upstream · Review: Analytical · View: QA
  'car-t-expansion-media-screen': [
    { group: 'upstream', view: true, edit: true, review: false },
    { group: 'analytical', view: true, edit: true, review: true },
    { group: 'qa', view: true, edit: false, review: false },
    { user: DESIGN_USER_IDS.gareth, view: true, edit: false, review: false },
  ],
  // Edit: Analytical · Review: Analytical · View: QA, all workspace
  'hek293-cell-bank-characterisation': [
    { group: 'analytical', view: true, edit: true, review: true },
    { group: 'qa', view: true, edit: false, review: false },
    { user: DESIGN_USER_IDS.gareth, view: true, edit: false, review: true },
  ],
  // The Projects board lists these rows for the design user, who is neither the
  // lead nor in the project's group, so each carries a design-attested explicit
  // View rule (the same pattern as LVV and HEK293).
  'aav-full-empty-assay-qualification': [
    { user: DESIGN_USER_IDS.gareth, view: true, edit: false, review: false },
  ],
}

/** Idempotently ensure one design access rule, written by the project's lead. */
async function applyDesignProjectRule(
  client: Client,
  projectId: string,
  rule: DesignProjectRule,
  groupIds: Record<string, string>,
) {
  const principalUser = rule.user ?? null
  const principalGroup = rule.group ? groupIds[rule.group] : null
  const matches = await client.query(
    `select 1 from api.project_access
       where project_id=$1 and user_id is not distinct from $2
         and group_id is not distinct from $3
         and can_view=$4 and can_edit=$5 and can_review=$6
         and not can_manage and not client_portal`,
    [
      projectId,
      principalUser,
      principalGroup,
      rule.view,
      rule.edit,
      rule.review,
    ],
  )
  if (!matches.rowCount)
    await client.query(
      'select api.set_project_access_rule($1,$2,$3,$4,$5,$6,false,false)',
      [
        projectId,
        principalUser,
        principalGroup,
        rule.view,
        rule.edit,
        rule.review,
      ],
    )
}

/**
 * The Projects board lists rows whose design user is neither the lead nor in
 * the project's group (LVV transfection optimisation, AAV8 TFF concentration,
 * capsid ELISA method transfer, T-cell activation reagent comparison, plasmid
 * lot release panel). Those projects are created after the access-matrix step,
 * so their design-attested explicit View rules are applied here, once every
 * declared project exists.
 */
async function seedDesignProjectsBoardAccess(
  db: Parameters<SeedStep['run']>[0],
) {
  const boardRows = [
    'lvv-transfection-optimisation',
    'aav8-tff-concentration',
    'capsid-elisa-method-transfer',
    't-cell-activation-reagent-comparison',
    'plasmid-lot-release-panel',
  ] as const
  await withDesignClaims(
    db,
    DESIGN_USER_IDS.gareth,
    PROCESS,
    async (client) => {
      const groupIds: Record<string, string> = {}
      for (const [key, name] of Object.entries(DESIGN_ACCESS_GROUPS)) {
        const found = await client.query<{ id: string }>(
          'select id from api.workspace_groups_list() where name=$1',
          [name],
        )
        if (found.rows.at(0)?.id) groupIds[key] = found.rows.at(0)!.id
      }
      for (const key of boardRows) {
        const detail = DESIGN_PROJECT_DETAILS.find((d) => d.key === key)
        if (!detail) throw new Error(`Design project ${key} is not declared`)
        await withDesignClaims(db, detail.lead, PROCESS, async (lead) => {
          await applyDesignProjectRule(
            lead,
            detail.id,
            {
              user: DESIGN_USER_IDS.gareth,
              view: true,
              edit: false,
              review: false,
            },
            groupIds,
          )
        })
      }
    },
  )

  // The board reads "Sort: Updated" and lists its rows newest first, so the
  // declared order is expressed in `updated_at` (an access-rule write above
  // bumps it; the list would otherwise fall back to UUID order).
  const orderedRows = DESIGN_PROJECT_DETAILS.filter(
    (detail) => !detail.archived,
  ).sort((a, b) => b.displayId.localeCompare(a.displayId))
  await withDesignClaims(
    db,
    DESIGN_USER_IDS.gareth,
    PROCESS,
    async (client) => {
      for (const [index, detail] of orderedRows.entries()) {
        const updatedAt = new Date(DESIGN_CLOCK.getTime() - index * 60_000)
        await client.query(
          'update api.projects set updated_at=$2 where workspace_id=$3 and id=$1',
          [detail.id, updatedAt, PROCESS],
        )
      }
    },
  )
}

async function seedDesignProjectAccess(db: Parameters<SeedStep['run']>[0]) {
  // Project ids come from the seed's declared constants: a project the caller
  // cannot yet see is not visible through the claimed project read, and access
  // is exactly what this step is establishing.
  const byKey: Record<string, string> = {}
  for (const project of DESIGN_PROJECTS) byKey[project.key] = project.id
  // HEK293's "all workspace" view covers the design's workspace staff, not the
  // later auth-free development member or the client viewers.
  const allWorkspaceUsers = [
    DESIGN_USER_IDS.gareth,
    DESIGN_USER_IDS.priya,
    DESIGN_USER_IDS.mei,
    DESIGN_USER_IDS.tom,
    DESIGN_USER_IDS.sam,
    DESIGN_USER_IDS.anna,
  ]

  // Groups are workspace-scoped and seeded by the workspace owner.
  const groupIds: Record<string, string> = {}
  await withDesignClaims(
    db,
    DESIGN_USER_IDS.gareth,
    PROCESS,
    async (client) => {
      for (const [key, name] of Object.entries(DESIGN_ACCESS_GROUPS)) {
        const found = await client.query<{ id: string }>(
          'select id from api.workspace_groups_list() where name=$1',
          [name],
        )
        const id =
          found.rows.at(0)?.id ??
          (
            await client.query<{ id: string }>(
              'select id from api.create_workspace_group($1)',
              [name],
            )
          ).rows[0].id
        groupIds[key] = id
      }
      for (const [key, members] of Object.entries(
        DESIGN_ACCESS_GROUP_MEMBERS,
      )) {
        const groupId = groupIds[key]
        for (const userId of members) {
          const member = await client.query(
            'select 1 from api.workspace_group_memberships where group_id=$1 and user_id=$2',
            [groupId, userId],
          )
          if (!member.rowCount)
            await client.query(
              'select api.set_workspace_group_member($1,$2,true)',
              [groupId, userId],
            )
        }
      }
    },
  )

  const ensureRule = async (
    client: Client,
    projectId: string,
    rule: DesignProjectRule,
  ) => {
    await applyDesignProjectRule(client, projectId, rule, groupIds)
  }

  // Only a project's own lead may manage its access, so each project's matrix
  // rules are written as its declared lead.
  for (const [key, rules] of Object.entries(DESIGN_PROJECT_ACCESS)) {
    const projectId = byKey[key]
    if (!projectId)
      throw new Error(`Design project ${key} missing before access seeding`)
    const lead = DESIGN_PROJECT_DETAILS.find(
      (detail) => detail.key === key,
    )?.lead
    if (!lead) throw new Error(`Design project ${key} has no declared lead`)
    await withDesignClaims(db, lead, PROCESS, async (client) => {
      for (const rule of rules) await ensureRule(client, projectId, rule)
      // HEK293 is visible to every workspace member. Never overwrite an
      // existing lead or explicit reviewer rule for the same principal.
      if (key === 'hek293-cell-bank-characterisation') {
        for (const user_id of allWorkspaceUsers) {
          const existing = await client.query(
            'select 1 from api.project_access where project_id=$1 and user_id=$2',
            [projectId, user_id],
          )
          if (!existing.rowCount)
            await client.query(
              'select api.set_project_access_rule($1,$2,null,true,false,false,false,false)',
              [projectId, user_id],
            )
        }
      }
    })
  }
}

/**
 * Disposable design fixture, not product credential enrollment or identity
 * acceptance. Better Auth owns the fixture password; the existing Fixture
 * Owner verifies Gareth through the same human-only RPC as an administrator.
 * Every password assertion and token is issued by the real signing handler.
 */
async function designSigningFixture(db: Parameters<SeedStep['run']>[0]) {
  // Load after the seed runner has loaded its environment.
  const { createAuth } = await import('#/lib/auth')
  const { handleSignatureStepUp } =
    await import('#/lib/signature-step-up.server')
  const authentication = createAuth(db)
  const workspaceId = DESIGN_WORKSPACE_IDS.processDevelopment
  const actorId = DESIGN_USER_IDS.gareth
  const sessionId = DESIGN_SESSION_IDS.gareth
  const fixturePassword = 'design-fixture-only-signing-password'
  const verifierSession = 'design-session-fixture-owner-verification'
  await seedDesignSessions(db)
  // This is the same fixture-owner membership the final dev-workspace step
  // creates. Never promote another design member or replace an existing role.
  await db
    .insert(schema.workspaceMemberships)
    .values({
      workspaceId,
      userId: FIXTURE_USER_ID,
      role: 'owner',
    })
    .onConflictDoNothing()
  await db
    .insert(schema.session)
    .values({
      id: verifierSession,
      token: verifierSession,
      userId: FIXTURE_USER_ID,
      expiresAt: new Date(DESIGN_CLOCK.getTime() + 90 * 86_400_000),
    })
    .onConflictDoNothing()
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error('BETTER_AUTH_SECRET required for design signing')
  const origin = new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:3000')
    .origin
  const cookieSignature = createHmac('sha256', secret)
    .update(sessionId)
    .digest('base64')
  const headers = new Headers({
    origin,
    'content-type': 'application/json',
    cookie: `__Secure-better-auth.session_token=${encodeURIComponent(`${sessionId}.${cookieSignature}`)}`,
  })
  const credential = await db
    .select({ id: schema.account.id })
    .from(schema.account)
    .where(
      and(
        eq(schema.account.userId, actorId),
        eq(schema.account.providerId, 'credential'),
      ),
    )
    .limit(1)
  if (!credential.length) {
    await authentication.api.setPassword({
      headers,
      body: { newPassword: fixturePassword },
    })
  }
  const proof = async (
    input:
      | { purpose: 'certify' }
      | {
          purpose: 'sign'
          submissionId: string
          revisionDigest: string
          signatureMeaning: 'reviewed-and-approved'
        },
  ) => {
    const response = await handleSignatureStepUp(
      new Request(`${origin}/api/signatures/step-up`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...input,
          workspaceId,
          password: fixturePassword,
        }),
      }),
      { database: db, authentication },
    )
    if (!response.ok)
      throw new Error(
        `Design fixture password step-up refused (${response.status})`,
      )
    return z
      .object({ token: z.string().min(32), authMethod: z.literal('password') })
      .parse(await response.json()).token
  }
  const certification = (
    await db
      .select()
      .from(schema.userSignatureCertifications)
      .where(
        and(
          eq(schema.userSignatureCertifications.workspaceId, workspaceId),
          eq(schema.userSignatureCertifications.userId, actorId),
        ),
      )
  ).at(0)
  if (
    !certification?.identityVerifiedAt ||
    certification.verifiedEmail !== 'gareth.p@design.sheetbase.dev' ||
    certification.revokedAt ||
    certification.statementVersion !== 1 ||
    certification.authMethod !== 'password'
  ) {
    await withDesignClaims(
      db,
      actorId,
      workspaceId,
      async (client) => {
        await client.query(
          'select api.request_signature_identity_verification()',
        )
      },
      sessionId,
    )
    await withDesignClaims(
      db,
      FIXTURE_USER_ID,
      workspaceId,
      async (client) => {
        await client.query('select api.verify_signature_identity($1,$2)', [
          actorId,
          'gareth.p@design.sheetbase.dev',
        ])
      },
      verifierSession,
    )
    const token = await proof({ purpose: 'certify' })
    await withDesignClaims(
      db,
      actorId,
      workspaceId,
      async (client) => {
        await client.query('select api.certify_signature($1,1,$2)', [
          workspaceId,
          token,
        ])
      },
      sessionId,
    )
  }
  return proof
}

/** Native fixture issuance, with the same session/member/owner gates as the
 * service and personal handlers. No credential material leaves this helper. */
async function designCredential(
  db: Parameters<SeedStep['run']>[0],
  input: {
    actorId: string
    sessionId: string
    name: string
    kind: 'personal' | 'service'
    scopes: string[]
    expiresAt?: Date
  },
): Promise<string> {
  const { createAuth } = await import('#/lib/auth')
  const credentials = await import('#/lib/api-credentials')
  const { emitCredentialAuditEvent } = await import('#/lib/credential-audit')
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret)
    throw new Error('BETTER_AUTH_SECRET required for fixture session')
  const signature = createHmac('sha256', secret)
    .update(input.sessionId)
    .digest('base64')
  const headers = new Headers({
    cookie: `__Secure-better-auth.session_token=${encodeURIComponent(`${input.sessionId}.${signature}`)}`,
  })
  const authentication = createAuth(db)
  return db.transaction(async (tx) => {
    const session = await authentication.api.getSession({ headers })
    if (!session || session.user.id !== input.actorId)
      throw new Error('Current native credential fixture session required')
    if (!(await credentials.isWorkspaceMember(tx, session.user.id, PROCESS)))
      throw new Error('Credential fixture workspace membership required')
    if (
      input.kind === 'service' &&
      !(await credentials.isWorkspaceOwner(tx, session.user.id, PROCESS))
    )
      throw new Error('Only workspace owners can issue service credentials')
    // Use the normal workspace-switch authority before resolving the selected
    // context. In particular, Mei also belongs to Analytical Development.
    const preference = await tx.query.userPreferences.findFirst({
      where: eq(schema.userPreferences.userId, session.user.id),
    })
    if (preference?.activeWorkspaceId !== PROCESS) {
      await tx.execute(
        sql`select set_config('request.jwt.claims',${JSON.stringify({
          role: 'authenticated',
          sub: session.user.id,
          session_id: session.session.id,
          workspace_id: PROCESS,
        })},true)`,
      )
      await tx.execute(sql`select api.set_active_workspace(${PROCESS}::uuid)`)
    }
    const existing = await tx.query.apiCredentials.findFirst({
      where: and(
        eq(schema.apiCredentials.workspaceId, PROCESS),
        eq(schema.apiCredentials.createdByUserId, session.user.id),
        eq(schema.apiCredentials.kind, input.kind),
        eq(schema.apiCredentials.name, input.name),
      ),
    })
    if (existing) {
      if (
        !/^[a-f0-9]{64}$/.test(existing.secretHash) ||
        !/^[a-f0-9]{8}$/.test(existing.displayPrefix)
      )
        throw new Error(
          `Legacy fabricated credential ${input.name} requires a fresh fixture database`,
        )
      return existing.id
    }
    const created = await credentials.createCredential(tx, {
      workspaceId: PROCESS,
      createdByUserId: session.user.id,
      name: input.name,
      scopes: input.scopes,
      kind: input.kind,
      expiresAt: input.expiresAt,
    })
    await emitCredentialAuditEvent(tx, {
      actorUserId: session.user.id,
      workspaceId: PROCESS,
      credentialId: created.id,
      operation: 'create',
      payload: {
        name: created.name,
        displayPrefix: created.displayPrefix,
        kind: created.kind,
      },
    })
    return created.id
  })
}

/**
 * Design agents (RM-116/PIPE-01): a workflow, a few operation proposals and a
 * policy, so the Agents surface shows real work. Proposals and the workflow go
 * through their RPCs (idempotent on the key); the policy needs a service
 * credential and a password-certified human fixture, both ensured first.
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

  await designSigningFixture(db)
  const credentialId = await designCredential(db, {
    actorId,
    sessionId: DESIGN_SESSION_IDS.gareth,
    name: 'Seed agent credential',
    kind: 'service',
    scopes: ['agent_operations:write'],
  })

  await withDesignClaims(db, actorId, workspaceId, async (client) => {
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
    const protocolRecord = await client.query<{ id: string }>(
      'select id from api.records where identifier = $1 and kind = $2',
      [protocol.identifier, 'protocol_template'],
    )
    const protocolId = protocolRecord.rows[0]?.id
    if (!protocolId) throw new Error(`protocol ${protocol.identifier} missing`)

    // A controlled document: the record's rich-text blocks.
    const hasDoc = await client.query(
      'select 1 from api.blocks where record_id = $1 limit 1',
      [protocolId],
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
      await client.query(`select api.insert_block($1,'rich_text',$2::jsonb)`, [
        protocolId,
        JSON.stringify({ doc }),
      ])
    }

    const records = [
      { user: DESIGN_USER_IDS.priya, status: 'trained' },
      { user: DESIGN_USER_IDS.mei, status: 'trained' },
      { user: DESIGN_USER_IDS.tom, status: 'required' },
    ]
    for (const t of records) {
      const existing = await client.query<{ status: string }>(
        'select status from api.protocol_training where protocol_record_id = $1 and user_id = $2',
        [protocolId, t.user],
      )
      if (existing.rows[0]?.status === t.status) continue
      await client.query('select api.record_protocol_training($1,$2,$3)', [
        protocolId,
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
      const analysis = await client.query<{ display_id: string }>(
        `select display_id from api.analysis_views
          where workspace_id = $1 and owner_user_id = $2 and name = $3`,
        [workspaceId, actorId, 'VCD by day'],
      )
      if (!analysis.rows[0]) {
        throw new Error('Design Results analysis view is not readable')
      }
      await client.query('select api.create_record_link($1,$2,$3,$4)', [
        experiment.id,
        'analysis',
        analysis.rows[0].display_id,
        'analysis',
      ])
    }
  })
}

/**
 * SampleConsumed — the append-only custody ledger the design shows for
 * SMP-2210: 900 mL registered on 2 Sep, then fully used in EXP-0139 with a
 * final 420 mL withdrawal on 11 Sep. The samples step already leaves the record
 * in its final state (quantity 0, consumed); this step writes the
 * `sample_events` rows at the design clock's dates. The canonical
 * register/consume RPCs stamp `now()`, so the historical ledger is written
 * directly and only while the ledger is empty — a reseed converges.
 */
async function seedDesignSampleCustody(
  db: Parameters<SeedStep['run']>[0],
): Promise<void> {
  const workspaceId = DESIGN_WORKSPACE_IDS.processDevelopment
  const sampleId = '00000000-0000-4000-8000-00000000036c' // SMP-2210
  const experimentId = '00000000-0000-4000-8000-0000000003c1' // EXP-0139

  const existing = await db
    .select({ id: schema.sampleEvents.id })
    .from(schema.sampleEvents)
    .where(eq(schema.sampleEvents.recordId, sampleId))
    .limit(1)
  if (existing.length > 0) return

  await withDesignClaims(
    db,
    DESIGN_USER_IDS.priya,
    workspaceId,
    async (client) => {
      await client.query(
        `insert into api.sample_events
           (workspace_id, record_id, operation, quantity_delta, quantity_before,
            quantity_after, quantity_unit, to_location, actor_user_id, notes,
            created_at)
         values ($1,$2,'create',900,0,900,'mL','CR-2 shelf 2',$3,
                 '900 mL, CR-2 shelf 2', $4)`,
        [
          workspaceId,
          sampleId,
          DESIGN_USER_IDS.priya,
          new Date('2026-09-02T15:00:00+01:00'),
        ],
      )
    },
    DESIGN_SESSION_IDS.priya,
  )

  await withDesignClaims(
    db,
    DESIGN_USER_IDS.gareth,
    workspaceId,
    async (client) => {
      await client.query(
        `insert into api.sample_events
           (workspace_id, record_id, operation, quantity_delta, quantity_before,
            quantity_after, quantity_unit, actor_user_id, purpose_record_id,
            created_at)
         values ($1,$2,'consume',-480,900,420,'mL',$3,$4,$5)`,
        [
          workspaceId,
          sampleId,
          DESIGN_USER_IDS.gareth,
          experimentId,
          new Date('2026-09-05T11:00:00+01:00'),
        ],
      )
      await client.query(
        `insert into api.sample_events
           (workspace_id, record_id, operation, quantity_delta, quantity_before,
            quantity_after, quantity_unit, actor_user_id, purpose_record_id,
            notes, created_at)
         values ($1,$2,'consume',-420,420,0,'mL',$3,$4,$5,$6)`,
        [
          workspaceId,
          sampleId,
          DESIGN_USER_IDS.gareth,
          experimentId,
          'in EXP-0139 (AEX resin screen)',
          new Date('2026-09-11T10:40:00+01:00'),
        ],
      )
    },
    DESIGN_SESSION_IDS.gareth,
  )
}

/**
 * LAB-03 — the harvest lot's custody ledger (SMP-2231) and the design's
 * derived-sample lineage edges. The ledger writes the 15,000 mL registration
 * and the two design withdrawals through `api.sample_events`; the edges are
 * canonical `api.record_links` rows (`link_type='sample'`) carrying their
 * relation in `link_metadata`, the same shape `api.withdraw_sample` and
 * `api.request_repeat` write. Both steps are idempotent and only run while the
 * ledger/edges are absent, so a reseed converges.
 */
async function seedDesignSampleLineage(
  db: Parameters<SeedStep['run']>[0],
): Promise<void> {
  const workspaceId = DESIGN_WORKSPACE_IDS.processDevelopment
  const harvestId = '00000000-0000-4000-8000-000000000340' // SMP-2231
  const experimentId = '00000000-0000-4000-8000-000000000351' // EXP-0142
  const producedInId = '00000000-0000-4000-8000-0000000003bf' // EXP-0134
  const feedRetainId = '00000000-0000-4000-8000-000000000366' // SMP-2250

  const existing = await db
    .select({ id: schema.sampleEvents.id })
    .from(schema.sampleEvents)
    .where(eq(schema.sampleEvents.recordId, harvestId))
    .limit(1)
  if (existing.length === 0) {
    await withDesignClaims(
      db,
      DESIGN_USER_IDS.mei,
      workspaceId,
      async (client) => {
        await client.query(
          `insert into api.sample_events
             (workspace_id, record_id, operation, quantity_delta, quantity_before,
              quantity_after, quantity_unit, to_location, actor_user_id,
              purpose_record_id, notes, created_at)
           values ($1,$2,'create',15000,0,15000,'mL','Cold room CR-1, shelf 3',
                   $3,$4,'15,000 mL, Cold room CR-1, shelf 3',$5)`,
          [
            workspaceId,
            harvestId,
            DESIGN_USER_IDS.mei,
            producedInId,
            new Date('2026-09-20T16:30:00+01:00'),
          ],
        )
      },
      DESIGN_SESSION_IDS.mei,
    )
    await withDesignClaims(
      db,
      DESIGN_USER_IDS.gareth,
      workspaceId,
      async (client) => {
        await client.query(
          `insert into api.sample_events
             (workspace_id, record_id, operation, quantity_delta, quantity_before,
              quantity_after, quantity_unit, actor_user_id, purpose_record_id,
              notes, created_at)
           values ($1,$2,'consume',-50,15000,14950,'mL',$3,$4,'Feed retain',$5)`,
          [
            workspaceId,
            harvestId,
            DESIGN_USER_IDS.gareth,
            feedRetainId,
            new Date('2026-09-21T10:02:00+01:00'),
          ],
        )
        await client.query(
          `insert into api.sample_events
             (workspace_id, record_id, operation, quantity_delta, quantity_before,
              quantity_after, quantity_unit, actor_user_id, purpose_record_id,
              notes, created_at)
           values ($1,$2,'consume',-10350,14950,4600,'mL',$3,$4,
                   'Filter runs A–C (3 × 3,450 mL)',$5)`,
          [
            workspaceId,
            harvestId,
            DESIGN_USER_IDS.gareth,
            experimentId,
            new Date('2026-09-23T09:15:00+01:00'),
          ],
        )
      },
      DESIGN_SESSION_IDS.gareth,
    )
  }

  // Derived samples: the design's harvest filtrates, the dilution and the feed
  // retain, plus the consumed LVV harvest's AEX fraction.
  const derived: ReadonlyArray<{
    source: string
    target: string
    relation: string
    origin: string
  }> = [
    ...[
      '00000000-0000-4000-8000-0000000003d4', // SMP-2240
      '00000000-0000-4000-8000-0000000003d5', // SMP-2241
      '00000000-0000-4000-8000-0000000003d6', // SMP-2242
      '00000000-0000-4000-8000-0000000003d7', // SMP-2243
      '00000000-0000-4000-8000-0000000003d8', // SMP-2244
      '00000000-0000-4000-8000-0000000003d9', // SMP-2245
      '00000000-0000-4000-8000-0000000003da', // SMP-2246
      '00000000-0000-4000-8000-0000000003db', // SMP-2247
      '00000000-0000-4000-8000-000000000364', // SMP-2248
    ].map((target) => ({
      source: harvestId,
      target,
      relation: 'Filtered from this lot',
      origin: 'withdraw_sample',
    })),
    {
      source: harvestId,
      target: feedRetainId,
      relation: 'Aliquot of this lot',
      origin: 'withdraw_sample',
    },
    {
      source: '00000000-0000-4000-8000-000000000364', // SMP-2248
      target: '00000000-0000-4000-8000-000000000365', // SMP-2249
      relation: 'Diluted from SMP-2248',
      origin: 'request_repeat',
    },
    {
      source: '00000000-0000-4000-8000-00000000036c', // SMP-2210
      target: '00000000-0000-4000-8000-0000000003d2', // SMP-2211
      relation: 'Fractionated in EXP-0139',
      origin: 'withdraw_sample',
    },
    // The design's parent chain: the HEK293 cell bank expanded into the 20 L
    // production culture that was harvested as this lot.
    {
      source: '00000000-0000-4000-8000-0000000003d0', // SMP-1002
      target: '00000000-0000-4000-8000-0000000003d3', // SMP-2226
      relation: 'Expanded in EXP-0134',
      origin: 'withdraw_sample',
    },
    {
      source: '00000000-0000-4000-8000-0000000003d3', // SMP-2226
      target: harvestId,
      relation: 'This sample · harvested 20 Sep',
      origin: 'withdraw_sample',
    },
  ]

  const identifierById = new Map(
    DESIGN_SAMPLES.map((sample) => [sample.id, sample.identifier]),
  )
  await withDesignClaims(
    db,
    DESIGN_USER_IDS.gareth,
    workspaceId,
    async (client) => {
      for (const link of derived) {
        const identifier = identifierById.get(link.target)
        if (!identifier) continue
        await client.query(
          `insert into api.record_links
             (source_record_id, target_record_id, target_kind, target_identifier,
              link_type, link_metadata, created_by_user_id)
           values ($1,$2,'sample',$3,'sample',$4::jsonb,$5)
           on conflict (source_record_id, target_identifier, link_type)
             do nothing`,
          [
            link.source,
            link.target,
            identifier,
            JSON.stringify({ relation: link.relation, origin: link.origin }),
            DESIGN_USER_IDS.gareth,
          ],
        )
      }

      // The design's third usage row: a planned reservation of 3,000 mL for
      // EXP-0145's confirmation run. Written through the canonical RPC so the
      // free/reserved balance stays authoritative.
      const reserved = await client.query(
        `select 1 from api.sample_reservations
          where sample_record_id = $1 and experiment_record_id = $2 limit 1`,
        [harvestId, '00000000-0000-4000-8000-0000000003c5'], // EXP-0145
      )
      if ((reserved.rowCount ?? 0) === 0) {
        await client.query(
          `select api.create_sample_reservation($1,$2,$3,$4,$5,$6)`,
          [
            harvestId,
            '00000000-0000-4000-8000-0000000003c5',
            3000,
            'mL',
            true,
            'Planned feed · reserved',
          ],
        )
      }
    },
    DESIGN_SESSION_IDS.gareth,
  )
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
      const record = await client.query<{ id: string }>(
        "select id from api.records where workspace_id=$1 and identifier=$2 and kind='sample'",
        [workspaceId, sample.identifier],
      )
      const sampleId = record.rows.at(0)?.id
      if (!sampleId) throw new Error(`sample ${sample.identifier} missing`)
      for (const d of defs.slice(0, 2)) {
        const existing = await client.query(
          'select 1 from api.sample_measurements where sample_record_id = $1 and name = $2 limit 1',
          [sampleId, d.name],
        )
        if ((existing.rowCount ?? 0) > 0) continue
        await client.query(
          'select api.record_sample_measurement($1,$2,$3,$4,$5)',
          [sampleId, d.name, d.value, d.unit, d.method],
        )
      }
    }
  })
}

/**
 * The five milestones in the original ProjectDetail board. Target dates and
 * progress are planning inputs, not backdated audit or release evidence.
 * Deliverables have no product creation authority; do not invent receipts.
 */
async function seedDesignMilestones(
  db: Parameters<SeedStep['run']>[0],
): Promise<void> {
  const workspaceId = DESIGN_WORKSPACE_IDS.processDevelopment
  const milestones = [
    {
      title: 'Upstream process locked',
      status: 'completed',
      dueAt: '2026-09-19T00:00:00+01:00',
      progress: 100,
      experiment: 'EXP-0133',
    },
    {
      title: 'Clarification train selected',
      status: 'in_progress',
      dueAt: '2026-09-29T00:00:00+01:00',
      progress: 50,
      experiment: 'EXP-0142',
    },
    {
      title: 'TFF and polish defined',
      status: 'not_started',
      dueAt: '2026-10-16T00:00:00+01:00',
      progress: 0,
      experiment: null,
    },
    {
      title: '50 L engineering run',
      status: 'not_started',
      dueAt: '2026-11-06T00:00:00Z',
      progress: 0,
      experiment: 'EXP-0145',
    },
    {
      title: 'Tech-transfer package to CL-017',
      status: 'not_started',
      dueAt: '2026-11-27T00:00:00Z',
      progress: 0,
      experiment: null,
    },
  ] as const

  await withDesignClaims(
    db,
    DESIGN_USER_IDS.gareth,
    workspaceId,
    async (client) => {
      const project = await client.query<{ id: string }>(
        "select id from api.projects where workspace_id=$1 and key='aav9-process-transfer'",
        [workspaceId],
      )
      const projectId = project.rows.at(0)?.id
      if (!projectId) throw new Error('AAV9 milestone project missing')
      for (const [position, milestone] of milestones.entries()) {
        const existing = await client.query(
          "select id from api.study_tasks where workspace_id=$1 and project_id=$2 and task_type='milestone' and title=$3",
          [workspaceId, projectId, milestone.title],
        )
        if (existing.rowCount) continue
        const experiment = milestone.experiment
          ? await client.query<{ id: string }>(
              "select id from api.records where workspace_id=$1 and project_id=$2 and identifier=$3 and kind='experiment'",
              [workspaceId, projectId, milestone.experiment],
            )
          : null
        const experimentId = experiment?.rows.at(0)?.id ?? null
        if (milestone.experiment && !experimentId)
          throw new Error(
            `milestone experiment ${milestone.experiment} missing`,
          )
        await client.query(
          `select api.create_study_task(p_workspace_id=>$1,p_title=>$2,p_task_type=>'milestone',
          p_project_id=>$3,p_status=>$4,p_due_at=>$5,p_timezone=>'Europe/London',
          p_position=>$6,p_progress_percent=>$7,p_linked_experiment_record_id=>$8)`,
          [
            workspaceId,
            milestone.title,
            projectId,
            milestone.status,
            milestone.dueAt,
            position,
            milestone.progress,
            experimentId,
          ],
        )
      }
    },
  )
}

/**
 * Link design experiments to the datasets they produced, so the Datasets list's
 * Experiment column (and the experiment Datasets tab) has a source, and flag
 * exactly the values the design's Validation column shows: DS-0311 "1 out of
 * range", DS-0298 "2 columns missing units", every other row "Valid".
 */
const DESIGN_DATASET_EXPERIMENTS: Record<string, string> = {
  'DS-0311': 'EXP-0142',
  'DS-0310': 'EXP-0142',
  'DS-0298': 'EXP-0140',
  'DS-0305': 'EXP-0130',
  'DS-0303': 'EXP-0138',
  'DS-0302': 'EXP-0138',
  'DS-0297': 'EXP-0133',
  'DS-0296': 'EXP-0133',
  'DS-0290': 'EXP-0125',
  'DS-0287': 'EXP-0139',
}

/** Open issues per design dataset: field key + flag kind. */
const DESIGN_DATASET_FLAGS: Record<
  string,
  ReadonlyArray<{ fieldKey: string; kind: string; reason: string }>
> = {
  'DS-0298': [
    {
      fieldKey: 'glucose',
      kind: 'missing_unit',
      reason: 'Unit missing on the recorded value',
    },
    {
      fieldKey: 'osmolality',
      kind: 'missing_unit',
      reason: 'Unit missing on the recorded value',
    },
  ],
}

async function seedDesignDatasetFlags(
  db: Parameters<SeedStep['run']>[0],
): Promise<void> {
  const workspaceId = DESIGN_WORKSPACE_IDS.processDevelopment
  const experimentIdByIdentifier = new Map<string, string>(
    DESIGN_EXPERIMENTS.map((e) => [e.identifier, e.id]),
  )

  for (const [displayId, experimentIdentifier] of Object.entries(
    DESIGN_DATASET_EXPERIMENTS,
  )) {
    const dataset = DESIGN_DATASETS.find((d) => d.displayId === displayId)
    if (!dataset) continue
    const experimentId = experimentIdByIdentifier.get(experimentIdentifier)
    if (!experimentId) continue

    await withDesignClaims(db, dataset.actorId, workspaceId, async (client) => {
      // Link the experiment that produced the dataset.
      const lockState = await client.query(
        'select locked_at from api.records where id = $1',
        [experimentId],
      )
      if (!lockState.rows[0]?.locked_at) {
        const existing = await client.query(
          `select 1 from api.record_links
            where source_record_id = $1 and target_kind = 'dataset'
              and target_identifier = $2 and link_type = 'dataset'`,
          [experimentId, displayId],
        )
        if ((existing.rowCount ?? 0) === 0) {
          await client.query('select api.create_record_link($1,$2,$3,$4)', [
            experimentId,
            'dataset',
            displayId,
            'dataset',
          ])
        }
      }

      const flags = DESIGN_DATASET_FLAGS[displayId] ?? []
      if (flags.length === 0) return

      const rows = await client.query(
        'select id from api.dataset_rows where dataset_id = $1 order by id limit 1',
        [dataset.id],
      )
      const rowId: string | undefined = rows.rows[0]?.id
      if (!rowId) return

      const fields = await client.query(
        `select f.field_id, f.key from api.dataset_schema_version_fields f
           join api.dataset_schema_versions v on v.id = f.schema_version_id
           join api.dataset_schema_definitions s on s.id = v.schema_id
          where s.workspace_id = $1 and s.key = $2`,
        [workspaceId, dataset.schemaKey],
      )
      const fieldIdByKey = new Map<string, string>(
        fields.rows.map((r: { field_id: string; key: string }) => [
          r.key,
          r.field_id,
        ]),
      )

      for (const flag of flags) {
        const fieldId = fieldIdByKey.get(flag.fieldKey)
        if (!fieldId) continue
        const existing = await client.query(
          `select 1 from api.dataset_value_flags
            where dataset_id = $1 and row_id = $2 and field_id = $3
              and cleared_at is null`,
          [dataset.id, rowId, fieldId],
        )
        if ((existing.rowCount ?? 0) > 0) continue
        await client.query('select api.flag_dataset_value($1,$2,$3,$4,$5,$6)', [
          dataset.id,
          rowId,
          fieldId,
          flag.kind,
          flag.reason,
          null,
        ])
      }
    })
  }
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
    const datasetId = DESIGN_DATASETS.find(
      (d) => d.schemaKey === 'ambr_250_daily_reading',
    )?.id
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
        failed: 0,
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

      if (p.key === 'plate_reader_pr_01_export') {
        const latest = await client.query<{
          id: string
          definition_version_id: string
          status: string
          error_code: string | null
          error_message: string | null
          actor_user_id: string
          trigger_kind: string
          parameters: Record<string, unknown>
          input_versions: Record<string, unknown>
          trigger_occurrence_id: string | null
          schedule_id: string | null
        }>(
          `select r.* from api.pipeline_runs r
             join api.pipeline_definition_versions v on v.id = r.definition_version_id
            where v.definition_id = $1
            order by r.started_at desc nulls last limit 1`,
          [definitionId],
        )
        const previous = latest.rows.at(0)
        // Older design seeds manufactured this failure. Preserve that attempt
        // and its pinned inputs, but make PR-01's latest state match the design
        // through a linked retry. Other failures are not seed corrections.
        if (
          previous?.status === 'failed' &&
          previous.actor_user_id === actorId &&
          previous.error_code === 'SB070' &&
          previous.error_message === 'Step failed: input column missing'
        ) {
          const retry = await client.query(
            'select * from api.start_pipeline_run($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8)',
            [
              workspaceId,
              previous.definition_version_id,
              previous.trigger_kind,
              JSON.stringify(previous.parameters),
              JSON.stringify(previous.input_versions),
              previous.id,
              previous.trigger_occurrence_id,
              previous.schedule_id,
            ],
          )
          await client.query(
            'select api.complete_pipeline_run($1,$2,$3::jsonb)',
            [workspaceId, retry.rows[0].id, '{}'],
          )
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

// ---------------------------------------------------------------------------
// DSYS-05.5+ — working sheets, review lifecycle, folders/files, integrations
// and the client portal. All domain rows go through the canonical RPCs; the
// claims connection carries a live session; signing also needs password proof.
// ---------------------------------------------------------------------------

/**
 * DSYS-05 — authentication sessions for the design actors. The review, sign,
 * submit and amendment RPCs require a live session in `internal.session`
 * just as a signed-in browser would. This alone cannot authorize a signature.
 */
async function seedDesignSessions(
  db: Parameters<SeedStep['run']>[0],
): Promise<void> {
  const sessions: Array<{ id: string; userId: string }> = [
    { id: DESIGN_SESSION_IDS.gareth, userId: DESIGN_USER_IDS.gareth },
    { id: DESIGN_SESSION_IDS.priya, userId: DESIGN_USER_IDS.priya },
    { id: DESIGN_SESSION_IDS.mei, userId: DESIGN_USER_IDS.mei },
    { id: DESIGN_SESSION_IDS.sam, userId: DESIGN_USER_IDS.sam },
  ]
  const expiresAt = new Date(DESIGN_CLOCK.getTime() + 90 * 86_400_000)
  for (const session of sessions) {
    await db
      .insert(schema.session)
      .values({
        id: session.id,
        token: session.id,
        userId: session.userId,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: schema.session.id,
        set: { userId: session.userId, expiresAt },
      })
  }
}

function designSheetField(
  fieldId: string,
  key: string,
  label: string,
  logicalType: 'text' | 'decimal' | 'integer' | 'boolean',
  _unit?: string,
) {
  return {
    fieldId,
    key,
    label,
    description: null,
    logicalType,
    nullable: true,
    defaultValue: null,
    cardinality: 'one' as const,
    quantity: null,
    validation: {},
    category: null,
    relationship: null,
    computation: { mode: 'stored' as const },
    lifecycle: 'active' as const,
  }
}

const CLARIFICATION_SHEET_FIELDS = [
  designSheetField(
    '00000000-0000-4000-8000-000000000710',
    'filter_train',
    'Filter train',
    'text',
  ),
  designSheetField(
    '00000000-0000-4000-8000-000000000711',
    'load',
    'Load',
    'decimal',
    'L/m²',
  ),
  designSheetField(
    '00000000-0000-4000-8000-000000000712',
    'turbidity',
    'Turbidity',
    'decimal',
    'NTU',
  ),
  designSheetField(
    '00000000-0000-4000-8000-000000000713',
    'capsid_titre',
    'Capsid titre',
    'decimal',
    'cp/mL',
  ),
  designSheetField(
    '00000000-0000-4000-8000-000000000714',
    'step_yield',
    'Step yield',
    'decimal',
    '%',
  ),
  designSheetField(
    '00000000-0000-4000-8000-000000000715',
    'visual_clarity',
    'Visual clarity',
    'text',
  ),
  designSheetField(
    '00000000-0000-4000-8000-000000000716',
    'adj_yield',
    'Adj. yield',
    'decimal',
    '%',
  ),
  designSheetField(
    '00000000-0000-4000-8000-000000000717',
    'keep',
    'Keep?',
    'decimal',
    '%',
  ),
] as const

const CLARIFICATION_SHEET_ROWS: ReadonlyArray<
  [string, number, number, number, number, string, number | null, number | null]
> = [
  ['A-50', 50, 6.2, 7.4e11, 86.0, 'Clear', 85, 1],
  ['A-100', 100, 9.8, 7.1e11, 82.6, 'Clear', 82, 1],
  ['A-150', 150, 18.4, 6.5e11, 75.6, 'Slight haze', null, null],
  ['B-50', 50, 4.1, 7.8e11, 90.7, 'Clear', 90, 1],
  ['B-100', 100, 5.6, 7.6e11, 88.4, 'Clear', 88, 1],
  ['B-150', 150, 8.9, 7.3e11, 84.9, 'Clear', 84, 1],
  ['C-50', 50, 12.7, 6.9e11, 80.2, 'Slight haze', 79, 1],
  ['C-100', 100, 24.3, 6.2e11, 72.1, 'Hazy', null, null],
  ['C-150', 150, 61.5, 5.4e11, 62.8, 'Hazy', null, null],
]

function designSheetState(input: {
  name: string
  fields: ReadonlyArray<ReturnType<typeof designSheetField>>
  rows: ReadonlyArray<Partial<Record<string, string | number | null>>>
}): Record<string, unknown> {
  const localValues: Record<string, Record<string, unknown>> = {}
  for (const row of input.rows) {
    const rowKey = randomUUID()
    const values: Record<string, unknown> = {}
    for (const field of input.fields) {
      const value = row[field.key]
      if (value !== undefined && value !== null) values[field.fieldId] = value
    }
    localValues[rowKey] = values
  }
  return {
    bindings: [],
    localFields: input.fields,
    localValues,
    calculationOverrides: {},
    presentation: {
      columnOrder: input.fields.map((field) => field.fieldId),
      hiddenColumnIds: [],
      columnWidths: {},
      frozenColumnCount: 0,
      density: 'standard',
      filters: [],
      sorts: [],
    },
    provenance: { createdFrom: 'ad_hoc' },
  }
}

/**
 * DSYS-05 — the design's working sheets. `create_sheet_instance` is the
 * canonical writer; the sequence is pinned so the two design ids (SHT-0019,
 * SHT-0020) are reproduced, which the coverage gate and the parity suite
 * assert. The Clarification sheet carries the design's nine rows as local
 * columns; the second is the empty "Untitled sheet".
 */
async function seedDesignSheets(
  db: Parameters<SeedStep['run']>[0],
): Promise<void> {
  const workspaceId = DESIGN_WORKSPACE_IDS.processDevelopment
  const actorId = DESIGN_USER_IDS.gareth
  const projectId = DESIGN_PROJECTS[0]?.id ?? null

  const existing = await db
    .select({ name: schema.sheetInstances.name })
    .from(schema.sheetInstances)
    .where(eq(schema.sheetInstances.workspaceId, workspaceId))
  if (existing.some((row) => row.name === 'Clarification working sheet')) return

  // Pin the SHT sequence so the first design sheet is SHT-0019.
  await db.execute(
    sql`insert into internal.id_sequences (workspace_id, kind, last_number)
        values (${workspaceId}, 'display:sheet', 18)
        on conflict (workspace_id, kind) do update set last_number = 18`,
  )

  const clarificationRows = CLARIFICATION_SHEET_ROWS.map((row) => ({
    filter_train: row[0],
    load: row[1],
    turbidity: row[2],
    capsid_titre: row[3],
    step_yield: row[4],
    visual_clarity: row[5],
    adj_yield: row[6],
    keep: row[7],
  }))
  await withDesignClaims(
    db,
    actorId,
    workspaceId,
    async (client) => {
      await client.query(
        'select * from api.create_sheet_instance($1,$2,$3,$4,$5,$6,$7::jsonb)',
        [
          workspaceId,
          'Clarification working sheet',
          'Working sheet, not a dataset. Columns pinned to DS-0311 snapshot S-15.',
          null,
          projectId,
          null,
          JSON.stringify(
            designSheetState({
              name: 'Clarification working sheet',
              fields: CLARIFICATION_SHEET_FIELDS,
              rows: clarificationRows,
            }),
          ),
        ],
      )
      await client.query(
        'select * from api.create_sheet_instance($1,$2,$3,$4,$5,$6,$7::jsonb)',
        [
          workspaceId,
          'Untitled sheet',
          null,
          null,
          projectId,
          null,
          JSON.stringify(
            designSheetState({
              name: 'Untitled sheet',
              fields: [
                designSheetField(
                  '00000000-0000-4000-8000-000000000718',
                  'column_1',
                  'Column 1',
                  'text',
                ),
              ],
              rows: [],
            }),
          ),
        ],
      )
    },
    DESIGN_SESSION_IDS.gareth,
  )
}

interface DesignReviewTarget {
  recordId: string
  identifier: string
  submitActorId: string
  submitSessionId: string
  reviewerIds: string[]
  outcome: 'approve-sign' | 'request-changes' | 'submit-only'
  signerName?: string
  note: string
}

/**
 * DSYS-05 — the review lifecycle the Review/NbSigned screens show, driven by
 * the canonical RPCs (preview → submit → run checks → approve/request changes
 * → password proof → sign). Reseeds preserve existing decisions and signed
 * evidence, completing only a missing signature after an interrupted approval.
 */
async function seedDesignReviewLifecycle(
  db: Parameters<SeedStep['run']>[0],
): Promise<void> {
  const workspaceId = DESIGN_WORKSPACE_IDS.processDevelopment

  const targets: DesignReviewTarget[] = [
    {
      recordId: '00000000-0000-4000-8000-000000000350', // EXP-0138
      identifier: 'EXP-0138',
      submitActorId: DESIGN_USER_IDS.priya,
      submitSessionId: DESIGN_SESSION_IDS.priya,
      reviewerIds: [DESIGN_USER_IDS.gareth],
      outcome: 'approve-sign',
      signerName: 'Gareth P.',
      note: 'Results meet acceptance criteria. Approved for release.',
    },
    {
      recordId: '00000000-0000-4000-8000-000000000352', // EXP-0136
      identifier: 'EXP-0136',
      submitActorId: DESIGN_USER_IDS.priya,
      submitSessionId: DESIGN_SESSION_IDS.priya,
      reviewerIds: [DESIGN_USER_IDS.gareth],
      outcome: 'approve-sign',
      signerName: 'Gareth P.',
      note: 'Approved; seeding density conclusion is supported.',
    },
    {
      recordId: '00000000-0000-4000-8000-0000000003b9', // EXP-0127
      identifier: 'EXP-0127',
      submitActorId: DESIGN_USER_IDS.priya,
      submitSessionId: DESIGN_SESSION_IDS.priya,
      reviewerIds: [DESIGN_USER_IDS.mei],
      outcome: 'request-changes',
      note: 'Please clarify the statistical method used for the replicate analysis.',
    },
    {
      recordId: '00000000-0000-4000-8000-0000000003bc', // EXP-0130
      identifier: 'EXP-0130',
      submitActorId: DESIGN_USER_IDS.mei,
      submitSessionId: DESIGN_SESSION_IDS.mei,
      reviewerIds: [DESIGN_USER_IDS.gareth],
      outcome: 'submit-only',
      note: 'Awaiting review.',
    },
  ]

  const sessionFor = (userId: string): string => {
    if (userId === DESIGN_USER_IDS.gareth) return DESIGN_SESSION_IDS.gareth
    if (userId === DESIGN_USER_IDS.mei) return DESIGN_SESSION_IDS.mei
    if (userId === DESIGN_USER_IDS.sam) return DESIGN_SESSION_IDS.sam
    if (userId === DESIGN_USER_IDS.priya) return DESIGN_SESSION_IDS.priya
    throw new Error(`no design session for ${userId}`)
  }

  for (const target of targets) {
    const key = `design-review-${target.identifier.toLowerCase()}`

    // Phase 1 — the author submits (or the idempotent retry resolves the
    // existing submission).
    const submission = await withDesignClaims(
      db,
      target.submitActorId,
      workspaceId,
      async (client) => {
        const existing = await client.query<{
          submission_id: string
          state: string
          revision_id: string
          integrity_digest: string
        }>(
          `select s.id as submission_id, s.state, r.id as revision_id, r.integrity_digest
             from api.review_submissions s
             join api.revisions r on r.id = s.revision_id
            where s.record_id = $1 and s.idempotency_key = $2
            limit 1`,
          [target.recordId, key],
        )
        if (existing.rows[0]) {
          return {
            submissionId: existing.rows[0].submission_id,
            state: existing.rows[0].state,
            revisionId: existing.rows[0].revision_id,
            digest: existing.rows[0].integrity_digest,
          }
        }

        const preview = await client.query<{ source_digest: string }>(
          "select api.preview_submission_digest($1)->>'sourceDigest' as source_digest",
          [target.recordId],
        )
        const sourceDigest = preview.rows[0]?.source_digest
        if (!sourceDigest) throw new Error(`no digest for ${target.identifier}`)
        const submitted = await client.query<{
          result: {
            revision: { id: string; integrityDigest: string }
            submission: { id: string; state: string }
          }
        }>(
          `select api.submit_record_revision(
             $1,$2,'default-scientific-review',1,$3::text[],true,$4,$5
           ) as result`,
          [target.recordId, sourceDigest, target.reviewerIds, key, null],
        )
        const result = submitted.rows.at(0)?.result
        if (!result) throw new Error(`submit failed for ${target.identifier}`)
        return {
          submissionId: result.submission.id,
          state: result.submission.state,
          revisionId: result.revision.id,
          digest: result.revision.integrityDigest,
        }
      },
      target.submitSessionId,
    )

    // Phase 2 — the assigned reviewer runs checks, then decides and (for an
    // approval) signs. Approval and signing are reviewer-only guards, so they
    // must run as the reviewer, never as the author.
    if (target.outcome !== 'submit-only' && submission.state === 'submitted') {
      const reviewerId = target.reviewerIds[0]
      if (!reviewerId) throw new Error(`no reviewer for ${target.identifier}`)
      await withDesignClaims(
        db,
        reviewerId,
        workspaceId,
        async (client) => {
          await client.query(
            `select api.run_revision_checks($1,'default-scientific-checks',1,true,$2)`,
            [submission.revisionId, `${key}-checks`],
          )
          if (target.outcome === 'request-changes') {
            await client.query(
              'select api.request_changes_on_review($1,$2,$3,$4) as result',
              [
                submission.submissionId,
                target.note,
                'submitted',
                submission.digest,
              ],
            )
            return
          }
          const approved = await client.query(
            'select api.approve_review($1,$2,$3,$4) as result',
            [
              submission.submissionId,
              target.note,
              'submitted',
              submission.digest,
            ],
          )
          if (!approved.rows[0]?.result) {
            throw new Error(`approve failed for ${target.identifier}`)
          }
          submission.state = 'approved'
        },
        sessionFor(reviewerId),
      )
    }

    // An interrupted seed may have approved but not signed. Resume only that
    // missing signature, never rewrite a historical signature or its evidence.
    if (target.outcome === 'approve-sign' && submission.state === 'approved') {
      const reviewerId = target.reviewerIds[0]
      if (reviewerId !== DESIGN_USER_IDS.gareth)
        throw new Error('No signing fixture for reviewer')
      await withDesignClaims(
        db,
        reviewerId,
        workspaceId,
        async (client) => {
          const existing = await client.query(
            'select 1 from api.signatures where submission_id=$1 and signer_user_id=$2',
            [submission.submissionId, reviewerId],
          )
          if (existing.rowCount) return
          const proof = await designSigningFixture(db)
          const signingToken = await proof({
            purpose: 'sign',
            submissionId: submission.submissionId,
            revisionDigest: submission.digest,
            signatureMeaning: 'reviewed-and-approved',
          })
          const signed = await client.query(
            'select api.sign_revision($1,$2,$3,$4,$5) as result',
            [
              submission.submissionId,
              'reviewed-and-approved',
              target.signerName ?? 'Gareth P.',
              submission.digest,
              signingToken,
            ],
          )
          if (!signed.rows[0]?.result) {
            throw new Error(`sign failed for ${target.identifier}`)
          }
        },
        sessionFor(reviewerId),
      )
    }

    // The frozen-vs-live amendment: EXP-0136 is signed (locked) above, so an
    // amendment records the 'amend' revision and supersedes the locked one.
    if (target.identifier === 'EXP-0136') {
      await withDesignClaims(
        db,
        DESIGN_USER_IDS.gareth,
        workspaceId,
        async (client) => {
          const locked = await client.query<{ locked_at: string | null }>(
            'select locked_at from api.records where id = $1',
            [target.recordId],
          )
          if (!locked.rows[0]?.locked_at) return
          const existingAmend = await client.query(
            `select 1 from api.revisions
              where record_id = $1 and reason = 'amend' limit 1`,
            [target.recordId],
          )
          if ((existingAmend.rowCount ?? 0) > 0) return
          await client.query('select api.create_amendment($1,$2)', [
            target.recordId,
            'Corrected the seeding-density footnote after signature (frozen vs live).',
          ])
        },
        DESIGN_SESSION_IDS.gareth,
      )
    }
  }
}

/**
 * Isolated screen preparation, deliberately absent from the convergent seed.
 * Provision/migrate/seed the exact local scenario database before each screen.
 * Never run against a default database or reuse a prepared screen database.
 * All evidence dates are actual server dates, not historical canvas dates.
 */
export async function prepareDesignScenario(
  db: Parameters<SeedStep['run']>[0],
  screen: 'ReviewSign' | 'SettingsSignature' | 'HomeFirstRun',
) {
  const databaseName = {
    ReviewSign: 'sheetbase_parity_review_sign',
    SettingsSignature: 'sheetbase_parity_settings_signature',
    HomeFirstRun: 'sheetbase_parity_home_first_run',
  }[screen]
  const urls = [
    db.$client.options.connectionString,
    process.env.DATABASE_URL,
    process.env.MIGRATION_DATABASE_URL,
    process.env.PGRST_DB_URI,
    process.env.FORMULA_DATABASE_URL,
  ].map((value) => {
    try {
      return new URL(value ?? '')
    } catch {
      return null
    }
  })
  if (
    process.env.SHEETBASE_ENV !== 'test' ||
    process.env.SHEETBASE_DEV_AUTH_FREE !== 'false' ||
    urls.some(
      (url) =>
        !url ||
        !['postgres:', 'postgresql:'].includes(url.protocol) ||
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
        url.pathname !== `/${databaseName}`,
    )
  ) {
    throw new Error(
      'Design scenarios require every role URL to target the exact isolated local scenario database in test mode without auth-free sessions',
    )
  }
  const workspaceId = DESIGN_WORKSPACE_IDS.processDevelopment
  const project = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.workspaceId, workspaceId),
        eq(schema.projects.key, 'aav9-process-transfer'),
      ),
    )
  const projectId = project[0]?.id
  if (!projectId)
    throw new Error('Seed the design baseline before preparing a scenario')

  if (screen === 'ReviewSign') {
    const key = 'design-scenario-review-sign-round-2'
    const submission = await withDesignClaims(
      db,
      DESIGN_USER_IDS.priya,
      workspaceId,
      async (client) => {
        const record = await client.query<{
          id: string
          locked_at: string | null
        }>(
          "select id, locked_at from api.records where project_id=$1 and identifier='EXP-0138'",
          [projectId],
        )
        const current = record.rows.at(0)
        if (!current) throw new Error('EXP-0138 missing')
        const existing = await client.query<{
          id: string
          revision_id: string
          state: string
          integrity_digest: string
        }>(
          `select s.id,s.revision_id,s.state,r.integrity_digest from api.review_submissions s
           join api.revisions r on r.id=s.revision_id where s.record_id=$1 and s.idempotency_key=$2`,
          [current.id, key],
        )
        if (existing.rows[0]) return existing.rows[0]
        if (current.locked_at) {
          await client.query('select api.create_amendment($1,$2)', [
            current.id,
            'Isolated ReviewSign scenario: prepare a new review round.',
          ])
        }
        const preview = await client.query<{ digest: string }>(
          "select api.preview_submission_digest($1)->>'sourceDigest' as digest",
          [current.id],
        )
        const submitted = await client.query<{
          result: {
            revision: { id: string; integrityDigest: string }
            submission: { id: string; state: string }
          }
        }>(
          "select api.submit_record_revision($1,$2,'default-scientific-review',1,$3::text[],true,$4,null) as result",
          [current.id, preview.rows[0]?.digest, [DESIGN_USER_IDS.gareth], key],
        )
        const result = submitted.rows.at(0)?.result
        if (!result)
          throw new Error('Scenario submission did not return a revision')
        return {
          id: result.submission.id,
          revision_id: result.revision.id,
          state: result.submission.state,
          integrity_digest: result.revision.integrityDigest,
        }
      },
      DESIGN_SESSION_IDS.priya,
    )
    await withDesignClaims(
      db,
      DESIGN_USER_IDS.gareth,
      workspaceId,
      async (client) => {
        if (submission.state === 'submitted') {
          await client.query(
            "select api.run_revision_checks($1,'default-scientific-checks',1,true,$2)",
            [submission.revision_id, `${key}-checks`],
          )
          await client.query(
            "select api.approve_review($1,$2,'submitted',$3)",
            [
              submission.id,
              'Approved in an isolated fixture; awaiting a real signature.',
              submission.integrity_digest,
            ],
          )
        }
        const ready = await client.query(
          `select 1 from api.review_submissions s where s.id=$1 and s.state='approved'
          and not exists(select 1 from api.signatures sig where sig.submission_id=s.id)`,
          [submission.id],
        )
        if (!ready.rowCount)
          throw new Error(
            'ReviewSign requires an approved unsigned submission; reset the scenario database',
          )
      },
      DESIGN_SESSION_IDS.gareth,
    )
    return {
      screen,
      workspaceId,
      projectId,
      userId: DESIGN_USER_IDS.gareth,
      sessionId: DESIGN_SESSION_IDS.gareth,
      revisionId: submission.revision_id,
      submissionId: submission.id,
      route: `/review/${submission.revision_id}`,
      prerequisites: { approved: true, unsigned: true },
    }
  }

  if (screen === 'SettingsSignature') {
    const userId = DESIGN_USER_IDS.sam
    const sessionId = DESIGN_SESSION_IDS.sam
    const certification = (
      await db
        .select()
        .from(schema.userSignatureCertifications)
        .where(
          and(
            eq(schema.userSignatureCertifications.workspaceId, workspaceId),
            eq(schema.userSignatureCertifications.userId, userId),
          ),
        )
    ).at(0)
    if (certification?.certifiedAt)
      throw new Error(
        'SettingsSignature requires an uncertified Sam; reset the scenario database',
      )
    const { createAuth } = await import('#/lib/auth')
    const secret = process.env.BETTER_AUTH_SECRET
    if (!secret)
      throw new Error(
        'BETTER_AUTH_SECRET required for native fixture credentials',
      )
    const origin = new URL(
      process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
    ).origin
    const signature = createHmac('sha256', secret)
      .update(sessionId)
      .digest('base64')
    const headers = new Headers({
      origin,
      cookie: `__Secure-better-auth.session_token=${encodeURIComponent(`${sessionId}.${signature}`)}`,
    })
    const credential = await db
      .select({ id: schema.account.id })
      .from(schema.account)
      .where(
        and(
          eq(schema.account.userId, userId),
          eq(schema.account.providerId, 'credential'),
        ),
      )
      .limit(1)
    if (!credential.length) {
      await createAuth(db).api.setPassword({
        headers,
        body: { newPassword: 'design-fixture-only-signing-password' },
      })
    }
    if (!certification?.identityVerifiedAt) {
      await withDesignClaims(
        db,
        userId,
        workspaceId,
        async (client) => {
          await client.query(
            'select api.request_signature_identity_verification()',
          )
        },
        sessionId,
      )
      await withDesignClaims(
        db,
        DESIGN_USER_IDS.gareth,
        workspaceId,
        async (client) => {
          await client.query('select api.verify_signature_identity($1,$2)', [
            userId,
            'sam.r@design.sheetbase.dev',
          ])
        },
        DESIGN_SESSION_IDS.gareth,
      )
    } else if (
      certification.identityVerifiedBy !== DESIGN_USER_IDS.gareth ||
      certification.verifiedEmail !== 'sam.r@design.sheetbase.dev'
    ) {
      throw new Error(
        'SettingsSignature has different existing verification; reset the scenario database',
      )
    }
    const verified = (
      await db
        .select()
        .from(schema.userSignatureCertifications)
        .where(
          and(
            eq(schema.userSignatureCertifications.workspaceId, workspaceId),
            eq(schema.userSignatureCertifications.userId, userId),
          ),
        )
    ).at(0)
    if (
      !verified?.identityVerifiedAt ||
      verified.certifiedAt ||
      verified.identityVerifiedBy !== DESIGN_USER_IDS.gareth ||
      verified.verifiedEmail !== 'sam.r@design.sheetbase.dev'
    )
      throw new Error('Sam must be independently verified but uncertified')
    return {
      screen,
      workspaceId,
      projectId,
      userId,
      sessionId,
      route: '/settings/signatures',
      prerequisites: {
        identityVerifiedBy: verified.identityVerifiedBy,
        verifiedEmail: verified.verifiedEmail,
        certified: false,
      },
    }
  }

  const userId = 'design-scenario-first-run-editor'
  const sessionId = 'design-session-first-run-editor'
  const email = 'first-run-editor@design.sheetbase.dev'
  // Explicit auth fixture bootstrap, not product enrolment/identity acceptance.
  await db
    .insert(schema.user)
    .values({ id: userId, name: 'New Editor', email, emailVerified: false })
    .onConflictDoNothing()
  await db
    .insert(schema.session)
    .values({
      id: sessionId,
      token: sessionId,
      userId,
      expiresAt: sql`now() + interval '90 days'`,
    })
    .onConflictDoNothing()
  const membership = await db
    .select({ id: schema.workspaceMemberships.id })
    .from(schema.workspaceMemberships)
    .where(
      and(
        eq(schema.workspaceMemberships.workspaceId, workspaceId),
        eq(schema.workspaceMemberships.userId, userId),
      ),
    )
  if (!membership.length) {
    const token = await withDesignClaims(
      db,
      DESIGN_USER_IDS.gareth,
      workspaceId,
      async (client) => {
        const invitation = await client.query<{ result: { token: string } }>(
          "select api.create_invitation($1,$2,'member') as result",
          [workspaceId, email],
        )
        const result = invitation.rows.at(0)?.result
        if (!result?.token)
          throw new Error('Scenario invitation did not return a token')
        return result.token
      },
      DESIGN_SESSION_IDS.gareth,
    )
    await withDesignClaims(
      db,
      userId,
      workspaceId,
      async (client) => {
        await client.query('select api.accept_invitation($1,$2)', [
          token,
          userId,
        ])
      },
      sessionId,
    )
  }
  await withDesignClaims(
    db,
    DESIGN_USER_IDS.gareth,
    workspaceId,
    async (client) => {
      const access = await client.query(
        'select 1 from api.project_access where project_id=$1 and user_id=$2 and access_level=$3',
        [projectId, userId, 'editor'],
      )
      if (!access.rowCount)
        await client.query(
          "select api.grant_project_access($1,$2,$3,'editor')",
          [workspaceId, projectId, userId],
        )
    },
    DESIGN_SESSION_IDS.gareth,
  )
  const activity = await db.$client.query(
    `select 1 from api.recently_viewed where user_id=$1
     union all select 1 from api.records where created_by_user_id=$1
     union all select 1 from api.user_signature_certifications where user_id=$1
     union all select 1 from api.change_events where actor_user_id=$1 and entity_type in ('record','block','record_link','dataset','sheet_instance','project','notebook_template','review_submission') limit 1`,
    [userId],
  )
  if (activity.rowCount)
    throw new Error(
      'HomeFirstRun has personal activity; reset the scenario database',
    )
  return {
    screen,
    workspaceId,
    projectId,
    userId,
    sessionId,
    route: '/',
    prerequisites: {
      projectAccess: 'editor',
      personalActivity: false,
      certified: false,
    },
  }
}

const DESIGN_FOLDER_NAMES = {
  upstream: 'Upstream',
  transfection: 'Transfection',
  harvest: 'Harvest',
  downstream: 'Downstream',
  clarification: 'Clarification',
  tff: 'TFF and polish',
  analytical: 'Analytical',
  reports: 'Reports for CL-017',
} as const

/**
 * DSYS-05 — project folders and files (ProjectFolders/FolderMove/ProjectFiles),
 * plus the folder links that put the design's records in them. Folders and the
 * record moves go through `create_project_folder` / `move_records_to_folder`;
 * files go through `create_file_upload`.
 */
async function seedDesignFoldersAndFiles(
  db: Parameters<SeedStep['run']>[0],
): Promise<void> {
  const workspaceId = DESIGN_WORKSPACE_IDS.processDevelopment
  const actorId = DESIGN_USER_IDS.gareth
  const project = DESIGN_PROJECTS.at(0)
  if (!project) return
  const projectRow = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.workspaceId, workspaceId),
        eq(schema.projects.key, project.key),
      ),
    )
  const projectId = projectRow[0]?.id
  if (!projectId) throw new Error(`project ${project.key} missing`)

  const existingFolders = await db
    .select({ id: schema.folders.id, name: schema.folders.name })
    .from(schema.folders)
    .where(eq(schema.folders.projectId, projectId))
  const byName = new Map(existingFolders.map((f) => [f.name, f.id]))

  await withDesignClaims(
    db,
    actorId,
    workspaceId,
    async (client) => {
      const ensureFolder = async (
        name: string,
        parentName?: string,
      ): Promise<string> => {
        const cached = byName.get(name)
        if (cached) return cached
        const parentId = parentName ? byName.get(parentName) : null
        const created = await client.query<{ id: string }>(
          'select * from api.create_project_folder($1,$2,$3)',
          [projectId, name, parentId ?? null],
        )
        const id = created.rows[0]?.id
        if (!id) throw new Error(`folder ${name} not created`)
        byName.set(name, id)
        return id
      }

      await ensureFolder(DESIGN_FOLDER_NAMES.upstream)
      await ensureFolder(DESIGN_FOLDER_NAMES.transfection)
      await ensureFolder(DESIGN_FOLDER_NAMES.harvest)
      await ensureFolder(DESIGN_FOLDER_NAMES.downstream)
      await ensureFolder(
        DESIGN_FOLDER_NAMES.clarification,
        DESIGN_FOLDER_NAMES.downstream,
      )
      await ensureFolder(
        DESIGN_FOLDER_NAMES.tff,
        DESIGN_FOLDER_NAMES.downstream,
      )
      await ensureFolder(DESIGN_FOLDER_NAMES.analytical)
      await ensureFolder(DESIGN_FOLDER_NAMES.reports)

      const moves: Array<[string, string]> = [
        ['EXP-0138', DESIGN_FOLDER_NAMES.transfection],
        ['EXP-0136', DESIGN_FOLDER_NAMES.transfection],
        ['EXP-0133', DESIGN_FOLDER_NAMES.harvest],
        ['EXP-0142', DESIGN_FOLDER_NAMES.clarification],
        ['EXP-0145', DESIGN_FOLDER_NAMES.clarification],
      ]
      for (const [identifier, folderName] of moves) {
        const folderId = byName.get(folderName)
        if (!folderId) throw new Error(`folder ${folderName} missing`)
        const record = await client.query<{
          id: string
          folder_id: string | null
          locked_at: string | null
        }>(
          'select id, folder_id, locked_at from api.records where project_id = $1 and identifier = $2',
          [projectId, identifier],
        )
        const current = record.rows.at(0)
        if (!current) throw new Error(`record ${identifier} missing`)
        if (current.locked_at || current.folder_id === folderId) continue
        await client.query(
          'select api.move_records_to_folder($1,$2::uuid[],$3)',
          [projectId, [current.id], folderId],
        )
      }

      const files: Array<{
        id: string
        name: string
        mediaType: string
        byteSize: number
        storageKey: string
      }> = [
        {
          id: '00000000-0000-4000-8000-000000000720',
          name: 'PR-01 plate reader export.csv',
          mediaType: 'text/csv',
          byteSize: 184_320,
          storageKey: `${workspaceId}/00000000-0000-4000-8000-000000000720/${'1'.padStart(32, '0')}`,
        },
        {
          id: '00000000-0000-4000-8000-000000000721',
          name: 'TB-02 turbidity export.csv',
          mediaType: 'text/csv',
          byteSize: 96_512,
          storageKey: `${workspaceId}/00000000-0000-4000-8000-000000000721/${'2'.padStart(32, '0')}`,
        },
        {
          id: '00000000-0000-4000-8000-000000000722',
          name: 'Clarification filter datasheet.pdf',
          mediaType: 'application/pdf',
          byteSize: 524_288,
          storageKey: `${workspaceId}/00000000-0000-4000-8000-000000000722/${'3'.padStart(32, '0')}`,
        },
      ]
      for (const file of files) {
        const existing = await client.query(
          `select f.id from api.file_objects f
             join api.records r on r.id = f.record_id
            where r.project_id = $1 and f.display_name = $2`,
          [projectId, file.name],
        )
        if ((existing.rowCount ?? 0) > 0) continue
        await client.query(
          'select * from api.create_file_upload($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            projectId,
            file.name,
            file.mediaType,
            file.byteSize,
            file.storageKey,
            null,
            'local',
            file.id,
          ],
        )
      }
    },
    DESIGN_SESSION_IDS.gareth,
  )
}

/**
 * DSYS-05 — integrations and API tokens (SettingsIntegrations, IntegrationConnect,
 * TokenCreate/TokenExpired). Connectors use `register_connector`; personal
 * tokens use native server issuance after current session/member validation.
 * Historical expiry/refusal evidence remains unmet, not manufactured.
 */
async function seedDesignConnectorsAndTokens(
  db: Parameters<SeedStep['run']>[0],
): Promise<void> {
  const workspaceId = DESIGN_WORKSPACE_IDS.processDevelopment
  const actorId = DESIGN_USER_IDS.gareth

  await withDesignClaims(
    db,
    actorId,
    workspaceId,
    async (client) => {
      const connectors: Array<{
        key: string
        name: string
        type: 'instrument' | 'storage' | 'webhook' | 'database' | 'custom'
        direction: 'inbound' | 'outbound' | 'bidirectional'
        parserId?: string
        config: Record<string, unknown>
      }> = [
        {
          key: 'qc-lims',
          name: 'QC LIMS',
          type: 'custom',
          direction: 'inbound',
          config: {
            description: 'Release results (bioburden, endotoxin) onto samples',
          },
        },
        {
          key: 'microsoft-teams',
          name: 'Microsoft Teams',
          type: 'webhook',
          direction: 'outbound',
          config: { description: 'Pipeline and review notifications' },
        },
        {
          key: 'instrument-gateway',
          name: 'Instrument gateway',
          type: 'instrument',
          direction: 'inbound',
          parserId: 'generic-instrument',
          config: {
            description: 'PR-01, TB-02 and ViCell exports as webhooks',
          },
        },
        {
          key: 'document-management',
          name: 'Document management',
          type: 'storage',
          direction: 'outbound',
          config: { description: 'Controlled copies of signed PDFs' },
        },
      ]
      for (const connector of connectors) {
        const existing = await client.query(
          'select 1 from api.connectors where workspace_id = $1 and key = $2',
          [workspaceId, connector.key],
        )
        if ((existing.rowCount ?? 0) > 0) continue
        await client.query(
          'select * from api.register_connector($1,$2,$3,$4,$5,$6::jsonb,$7)',
          [
            workspaceId,
            connector.key,
            connector.name,
            connector.type,
            connector.direction,
            JSON.stringify(connector.config),
            connector.parserId ?? null,
          ],
        )
      }
    },
    DESIGN_SESSION_IDS.gareth,
  )

  for (const token of [
    {
      name: 'Plate-map exporter',
      scopes: ['datasets:read', 'datasets:write'],
      actorId: DESIGN_USER_IDS.mei,
      sessionId: DESIGN_SESSION_IDS.mei,
      expiresAt: new Date('2026-12-12T00:00:00Z'),
    },
    {
      name: 'Jupyter, Gareth',
      scopes: ['projects:read', 'datasets:read'],
      actorId: DESIGN_USER_IDS.gareth,
      sessionId: DESIGN_SESSION_IDS.gareth,
      expiresAt: new Date('2026-10-30T00:00:00Z'),
    },
  ]) {
    await designCredential(db, { ...token, kind: 'personal' })
  }
  // Stability export's Sep24 expiry/refusal history cannot be issued at the
  // native Oct clock. It remains an explicit unmet fixture, not a fake hash.
  console.warn(
    'seed unmet: Stability export historical expiry/refusals require operation-clock authority',
  )
}

/**
 * IntegrationDeliveries — the Document-management webhook and its failing
 * delivery history. The design shows five attempts against
 * https://dms.cdmo.example/api/ingest for `record.signed`: four still retrying
 * and one delivered. The existing direct writes below do not prove delivery:
 * canonical delivery-engine execution against a real receiver is still needed.
 */
async function seedDesignWebhookDeliveries(
  db: Parameters<SeedStep['run']>[0],
): Promise<void> {
  const workspaceId = DESIGN_WORKSPACE_IDS.processDevelopment

  await db
    .insert(schema.webhookSubscriptions)
    .values({
      id: DESIGN_WEBHOOK_IDS.subscription,
      workspaceId,
      key: 'document-management',
      description: 'Controlled copies of signed PDFs',
      url: 'https://dms.cdmo.example/api/ingest',
      eventTypes: ['record.signed'],
      maxRetries: 25,
      failureThreshold: 100,
      status: 'active',
      createdByUserId: DESIGN_USER_IDS.tom,
      updatedByUserId: DESIGN_USER_IDS.tom,
      createdAt: new Date('2026-08-01T09:00:00+01:00'),
      updatedAt: DESIGN_CLOCK,
    })
    .onConflictDoUpdate({
      target: [
        schema.webhookSubscriptions.workspaceId,
        schema.webhookSubscriptions.key,
      ],
      set: {
        description: 'Controlled copies of signed PDFs',
        url: 'https://dms.cdmo.example/api/ingest',
        eventTypes: ['record.signed'],
        maxRetries: 25,
        failureThreshold: 100,
        status: 'active',
      },
    })

  const deliveries: Array<{
    identifier: string
    version: number
    createdAt: Date
    attempt: number
    status: 'retrying' | 'delivered'
    responseStatus: number | null
    errorCode: string | null
    errorMessage: string | null
    nextAttemptAt: Date | null
    deliveredAt: Date | null
  }> = [
    {
      identifier: 'EXP-0141',
      version: 1,
      createdAt: new Date('2026-09-26T09:40:00+01:00'),
      attempt: 4,
      status: 'retrying',
      responseStatus: 503,
      errorCode: null,
      errorMessage: null,
      nextAttemptAt: new Date('2026-09-26T10:10:00+01:00'),
      deliveredAt: null,
    },
    {
      identifier: 'EXP-0139',
      version: 2,
      createdAt: new Date('2026-09-26T08:15:00+01:00'),
      attempt: 6,
      status: 'retrying',
      responseStatus: 503,
      errorCode: null,
      errorMessage: null,
      nextAttemptAt: new Date('2026-09-26T10:10:00+01:00'),
      deliveredAt: null,
    },
    {
      identifier: 'EXP-0138',
      version: 1,
      createdAt: new Date('2026-09-25T17:02:00+01:00'),
      attempt: 9,
      status: 'retrying',
      responseStatus: null,
      errorCode: 'timeout',
      errorMessage: 'Timed out after 30 s',
      nextAttemptAt: new Date('2026-09-26T10:10:00+01:00'),
      deliveredAt: null,
    },
    {
      identifier: 'EXP-0137',
      version: 1,
      createdAt: new Date('2026-09-25T06:00:00+01:00'),
      attempt: 12,
      status: 'retrying',
      responseStatus: 503,
      errorCode: null,
      errorMessage: null,
      nextAttemptAt: new Date('2026-09-26T10:10:00+01:00'),
      deliveredAt: null,
    },
    {
      identifier: 'EXP-0136',
      version: 1,
      createdAt: new Date('2026-09-24T16:40:00+01:00'),
      attempt: 1,
      status: 'delivered',
      responseStatus: 200,
      errorCode: null,
      errorMessage: null,
      nextAttemptAt: null,
      deliveredAt: new Date('2026-09-24T16:40:05+01:00'),
    },
  ]

  for (const [index, delivery] of deliveries.entries()) {
    const payload = {
      event: 'record.signed',
      record: {
        identifier: delivery.identifier,
        version: delivery.version,
      },
    }
    await db
      .insert(schema.webhookDeliveries)
      .values({
        id: DESIGN_WEBHOOK_IDS.deliveries[index],
        workspaceId,
        subscriptionId: DESIGN_WEBHOOK_IDS.subscription,
        changeEventId: `00000000-0000-4000-8000-00000000074${index}`,
        eventType: 'record.signed',
        payload,
        body: JSON.stringify(payload),
        signature: 'design-seed',
        attempt: delivery.attempt,
        status: delivery.status,
        responseStatus: delivery.responseStatus,
        responseBody:
          delivery.responseStatus === 503 ? 'Service unavailable' : null,
        errorCode: delivery.errorCode,
        errorMessage: delivery.errorMessage,
        nextAttemptAt: delivery.nextAttemptAt,
        deliveredAt: delivery.deliveredAt,
        createdAt: delivery.createdAt,
        updatedAt: delivery.deliveredAt ?? delivery.createdAt,
      })
      .onConflictDoNothing()
  }
}

/**
 * DSYS-05.1 — pin the seeded datasets' timestamps to the design clock. A
 * dataset's `updated_at` is stamped by `snapshot_dataset`, so this runs after
 * every dataset step and keeps date-bearing list rows from drifting with
 * wall-clock time.
 */
async function seedDesignClock(
  db: Parameters<SeedStep['run']>[0],
): Promise<void> {
  for (const dataset of DESIGN_DATASETS) {
    await db.execute(sql`
      update api.datasets
         set created_at = ${dataset.createdAt ?? dataset.updatedAt},
             updated_at = ${dataset.updatedAt}
       where id = ${dataset.id}`)
  }
}

/**
 * DSYS-05 — the client portal (ClientPortal): approved records shared with the
 * CL-017 client, the report documents, the message thread and the client's
 * portal membership. Shares and messages go through `share_record_with_client`
 * and `post_client_portal_message`; reports through `create_report_definition`.
 */
async function seedDesignClientPortal(
  db: Parameters<SeedStep['run']>[0],
): Promise<void> {
  const workspaceId = DESIGN_WORKSPACE_IDS.processDevelopment
  const actorId = DESIGN_USER_IDS.gareth

  const clientRow = (
    await db
      .select({ id: schema.clients.id })
      .from(schema.clients)
      .where(
        and(
          eq(schema.clients.workspaceId, workspaceId),
          eq(schema.clients.code, 'CL-017'),
        ),
      )
      .limit(1)
  ).at(0)
  if (!clientRow) return

  // The client users are portal viewers, not internal viewers.
  for (const userId of [DESIGN_USER_IDS.clientAna, DESIGN_USER_IDS.clientBen]) {
    await db
      .insert(schema.workspaceMemberships)
      .values({
        workspaceId,
        userId,
        role: 'client_viewer',
        clientId: clientRow.id,
      })
      .onConflictDoUpdate({
        target: [
          schema.workspaceMemberships.workspaceId,
          schema.workspaceMemberships.userId,
        ],
        set: { role: 'client_viewer', clientId: clientRow.id },
      })
  }

  const projectId = DESIGN_PROJECTS[0]?.id
  if (!projectId) return

  await withDesignClaims(
    db,
    actorId,
    workspaceId,
    async (client) => {
      // Reports: create, populate a section, approve, then share the record.
      const reports: Array<{ title: string; section: string }> = [
        {
          title: 'Transfection ratio report',
          section: 'Genome titre by PEI:DNA ratio',
        },
        {
          title: 'Upstream process lock summary',
          section: 'Process lock evidence',
        },
        { title: 'Monthly progress, August', section: 'August highlights' },
      ]
      for (const report of reports) {
        const existing = await client.query(
          `select d.id, d.record_id from api.report_definitions d
            where d.workspace_id = $1 and d.title = $2 limit 1`,
          [workspaceId, report.title],
        )
        let reportId: string
        let recordId: string
        if (existing.rows[0]) {
          reportId = existing.rows[0].id
          recordId = existing.rows[0].record_id
        } else {
          const created = await client.query<{ id: string; record_id: string }>(
            'select * from api.create_report_definition($1,$2,$3,$4,$5)',
            [workspaceId, report.title, null, projectId, null],
          )
          reportId = created.rows[0].id
          recordId = created.rows[0].record_id
          await client.query(
            'select * from api.add_report_section($1,$2,$3,$4,$5,$6)',
            [workspaceId, reportId, report.section, null, 'text', 'free_text'],
          )
        }
        await client.query(
          'select * from api.update_report_definition($1,$2,$3,$4,$5)',
          [workspaceId, reportId, null, null, 'approved'],
        )
        await client.query('select api.share_record_with_client($1,$2)', [
          clientRow.id,
          recordId,
        ])
      }

      // The approved experiment records the design shares.
      for (const recordId of [
        '00000000-0000-4000-8000-000000000352', // EXP-0136
        '00000000-0000-4000-8000-000000000353', // EXP-0133
      ]) {
        await client.query('select api.share_record_with_client($1,$2)', [
          clientRow.id,
          recordId,
        ])
      }

      const messages = [
        {
          projectId,
          body: 'Transfection ratio report is approved and attached. Clarification results expected 29 Sep.',
        },
      ]
      for (const message of messages) {
        const existing = await client.query(
          `select 1 from api.client_portal_messages
            where client_id = $1 and body = $2 limit 1`,
          [clientRow.id, message.body],
        )
        if ((existing.rowCount ?? 0) > 0) continue
        await client.query('select api.post_client_portal_message($1,$2,$3)', [
          clientRow.id,
          message.projectId,
          message.body,
        ])
      }

      // The design's portal is on. `client_portal_projects` only returns a
      // project while its portal switch is on (PORTAL-01), so without this the
      // CL-017 users saw "No shared projects yet" even though shares existed.
      await client.query(
        'select api.update_project_settings($1,null,null,true)',
        [projectId],
      )
    },
    DESIGN_SESSION_IDS.gareth,
  )

  // Pin the design clock's dates; the report/share/message RPCs stamp now(),
  // so every reseed would otherwise drift with wall-clock time. The share and
  // message tables grant SELECT only to `authenticated`, so the owner
  // connection writes the two timestamps after the RPCs have run.
  const sharedAtByIdentifier: Array<[string, Date]> = [
    ['RPT-2026-0001', new Date('2026-09-25T09:40:00+01:00')],
    ['RPT-2026-0002', new Date('2026-09-20T10:00:00+01:00')],
    ['RPT-2026-0003', new Date('2026-09-02T09:00:00+01:00')],
    ['EXP-0136', new Date('2026-09-20T09:00:00+01:00')],
    ['EXP-0133', new Date('2026-09-20T09:00:00+01:00')],
  ]
  for (const [identifier, sharedAt] of sharedAtByIdentifier) {
    await db.execute(sql`
      update api.client_portal_shares s
         set shared_at = ${sharedAt}
        from api.records r
       where r.id = s.record_id
         and s.client_id = ${clientRow.id}
         and r.identifier = ${identifier}`)
  }
  await db.execute(sql`
    update api.client_portal_messages
       set created_at = ${new Date('2026-09-25T09:40:00+01:00')}
     where client_id = ${clientRow.id}
       and body = ${'Transfection ratio report is approved and attached. Clarification results expected 29 Sep.'}`)
}
