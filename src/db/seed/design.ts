/**
 * UI system v3 design seed (DSYS-05). See docs/development/seeds.md.
 *
 * This frame creates the people and workspaces the design screens show, on a
 * fixed clock (Friday 25 September 2026, Europe/London) so relative times
 * ("09:32", "Yesterday") render as the design does. Per-screen data is added
 * by later steps; each step runs through the canonical data layer.
 */
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
