/**
 * The notebook template story the Templates boards tell: "Depth-filter
 * clarification screen" with four published versions, an open draft v5, the
 * sheet definitions it pins (Clarification runs, Pressure and ΔP), approvals,
 * and the experiments made from each version. Published template and sheet
 * definition versions are immutable, so every write is insert-if-missing.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'

import * as schema from '../schema'
import type { SeedStep } from './run'

type Db = Parameters<SeedStep['run']>[0]

const PROCESS = '00000000-0000-4000-8000-000000000300'
const GARETH = '00000000-0000-4000-8000-000000000310'
const MEI = '00000000-0000-4000-8000-000000000312'
const ANNA = '00000000-0000-4000-8000-000000000315'

const TEMPLATE = '00000000-0000-4000-8000-000000000382'
const SHEET_A = '00000000-0000-4000-8000-000000000800'
const SHEET_B = '00000000-0000-4000-8000-000000000801'
const id = (n: number) =>
  `00000000-0000-4000-8000-0000000008${n.toString(16).padStart(2, '0')}`

const COL = {
  condition: id(0x10),
  filterTrain: id(0x11),
  load: id(0x12),
  turbidityOut: id(0x13),
  capsidTitre: id(0x14),
  stepYield: id(0x15),
  meetsCriteria: id(0x16),
  maxDp: id(0x17),
}
const COL_B = {
  filterTrain: id(0x20),
  inlet: id(0x21),
  outlet: id(0x22),
  dp: id(0x23),
}
const CALC = { stepYield: id(0x30), meets: id(0x31), dp: id(0x32) }

interface ColumnSpec {
  id: string
  key: string
  label: string
  type: 'text' | 'decimal' | 'reference'
  required?: boolean
  unit?: string
  min?: number
  max?: number
  description?: string
  calc?: { id: string; source: string; inputs: string[] }
}

function column(spec: ColumnSpec) {
  const field = {
    fieldId: spec.id,
    key: spec.key,
    label: spec.label,
    description: spec.description ?? null,
    logicalType: spec.type,
    nullable: !spec.required,
    defaultValue: null,
    cardinality: 'one',
    quantity: spec.unit
      ? {
          kind: 'measurement',
          dimension: spec.unit,
          storageUnit: spec.unit,
        }
      : null,
    validation: {
      ...(spec.min === undefined ? {} : { min: spec.min }),
      ...(spec.max === undefined ? {} : { max: spec.max }),
    },
    category: null,
    relationship:
      spec.type === 'reference'
        ? {
            target: { kind: 'model', modelKey: 'material' },
            cardinality: 'one',
          }
        : null,
    computation: spec.calc
      ? { mode: 'computed', expressionId: spec.calc.id }
      : { mode: 'stored' },
    lifecycle: 'active',
  }
  return {
    id: spec.id,
    field,
    source: spec.calc
      ? { kind: 'calculated', calculationId: spec.calc.id }
      : { kind: 'declared' },
  }
}

function sheetConfiguration(
  specs: ColumnSpec[],
  identityColumn: string,
  calcLabels: Record<string, string>,
) {
  return {
    formatVersion: 1,
    parameters: [],
    bindings: [],
    rowIdentity: { kind: 'local', columnIds: [identityColumn] },
    joins: [],
    columns: specs.map(column),
    calculations: specs
      .filter((s) => s.calc)
      .map((s) => ({
        id: s.calc!.id,
        key: s.key,
        label: calcLabels[s.key] ?? s.label,
        outputColumnId: s.id,
        inputColumnIds: s.calc!.inputs,
        expression: {
          language: 'sheetbase-formula-v1',
          source: s.calc!.source,
        },
      })),
    writeBackRules: [],
    actions: [],
    presentation: {
      columnOrder: specs.map((s) => s.id),
      hiddenColumnIds: [],
      columnWidths: {},
      frozenColumnCount: 1,
      density: 'standard',
      filters: [],
      sorts: [],
    },
  }
}

/** Clarification runs: what each sheet version holds. */
function clarificationColumns(version: number): ColumnSpec[] {
  const specs: ColumnSpec[] = [
    {
      id: COL.condition,
      key: 'condition',
      label: 'Condition',
      type: 'text',
      required: true,
      description: 'Unique in sheet',
    },
    {
      id: COL.filterTrain,
      key: 'filter_train',
      label: 'Filter train',
      type: 'reference',
      required: true,
      description: 'Status is Released',
    },
    {
      id: COL.load,
      key: 'load',
      label: 'Load',
      type: 'decimal',
      required: true,
      unit: 'L/m²',
      min: 10,
      max: version >= 4 ? 300 : 200,
    },
    {
      id: COL.turbidityOut,
      key: 'turbidity_out',
      label: 'Turbidity out',
      type: 'decimal',
      required: true,
      unit: 'NTU',
      min: 0,
      max: 50,
      description: '0–50, else out of range',
    },
  ]
  if (version >= 2)
    specs.push({
      id: COL.capsidTitre,
      key: 'capsid_titre',
      label: 'Capsid titre',
      type: 'decimal',
      required: true,
      unit: 'cp/mL',
      description: 'From the ELISA and turbidity model',
    })
  specs.push({
    id: COL.stepYield,
    key: 'step_yield',
    label: 'Step yield',
    type: 'decimal',
    unit: '%',
    calc: {
      id: CALC.stepYield,
      source: '=capsid_titre_out / capsid_titre_in',
      inputs: [version >= 2 ? COL.capsidTitre : COL.turbidityOut],
    },
  })
  if (version >= 3)
    specs.push({
      id: COL.meetsCriteria,
      key: 'meets_criteria',
      label: 'Meets criteria',
      type: 'text',
      calc: {
        id: CALC.meets,
        source: '=AND(turbidity_out <= 20, step_yield >= 80)',
        inputs: [COL.turbidityOut, COL.stepYield],
      },
    })
  if (version >= 4)
    specs.push({
      id: COL.maxDp,
      key: 'max_dp',
      label: 'Max ΔP',
      type: 'decimal',
      unit: 'bar',
      max: 1.5,
    })
  return specs
}

function pressureColumns(): ColumnSpec[] {
  return [
    {
      id: COL_B.filterTrain,
      key: 'filter_train',
      label: 'Filter train',
      type: 'reference',
      required: true,
    },
    {
      id: COL_B.inlet,
      key: 'inlet_pressure',
      label: 'Inlet pressure',
      type: 'decimal',
      unit: 'bar',
    },
    {
      id: COL_B.outlet,
      key: 'outlet_pressure',
      label: 'Outlet pressure',
      type: 'decimal',
      unit: 'bar',
    },
    {
      id: COL_B.dp,
      key: 'delta_p',
      label: 'ΔP',
      type: 'decimal',
      unit: 'bar',
      calc: {
        id: CALC.dp,
        source: '=inlet_pressure - outlet_pressure',
        inputs: [COL_B.inlet, COL_B.outlet],
      },
    },
  ]
}

const SHEET_A_VERSIONS = [
  { id: id(0x40), version: 1, at: '2026-04-14T09:00:00Z' },
  { id: id(0x41), version: 2, at: '2026-06-09T09:00:00Z' },
  { id: id(0x42), version: 3, at: '2026-09-02T09:00:00Z' },
  { id: id(0x43), version: 4, at: '2026-09-25T08:00:00+01:00' },
] as const
const SHEET_B_VERSION = { id: id(0x44), at: '2026-09-25T08:00:00+01:00' }

function narrative(
  n: number,
  order: number,
  blockType: string,
  payload: Record<string, unknown>,
) {
  return { id: id(0x50 + n), kind: 'narrative', order, blockType, payload }
}

/** The template's placements for a template version, in order. */
function placements(version: number, sheetAVersion: string) {
  const out: Array<Record<string, unknown>> = []
  out.push(
    narrative(1, 0, 'rich_text', {
      title: 'Objective',
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Compare depth filter loads for harvest clarification.',
              },
            ],
          },
        ],
      },
    }),
    narrative(2, 0, 'materials', {
      title: 'Materials',
      modelKey: 'material',
      label: 'Material lot',
    }),
    version >= 3
      ? narrative(3, 0, 'protocol_reference', {
          title: 'Method',
          protocol: 'PRT-021',
          version: 3,
        })
      : narrative(3, 0, 'rich_text', {
          title: 'Method',
          doc: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Describe the method.' }],
              },
            ],
          },
        }),
    {
      id: id(0x54),
      kind: 'sheet',
      order: 0,
      definitionVersionId: sheetAVersion,
      title: 'Clarification runs',
      parameterMappings: [],
    },
  )
  if (version >= 4)
    out.push({
      id: id(0x55),
      kind: 'sheet',
      order: 0,
      definitionVersionId: SHEET_B_VERSION.id,
      title: 'Pressure and ΔP',
      parameterMappings: [],
    })
  out.push(
    narrative(6, 0, 'chart', {
      title: 'Figure 1',
      source: 'Clarification runs',
    }),
    narrative(7, 0, 'metric', {
      title: 'Result summary',
      fields: [
        'Best load',
        'Step yield',
        'Turbidity out',
        'Capsid titre',
        ...(version >= 4 ? ['Max ΔP'] : []),
      ],
    }),
  )
  return out.map((p, index) => ({ ...p, order: index + 1 }))
}

const TEMPLATE_VERSIONS = [
  {
    id: id(0x60),
    version: 1,
    at: '2026-04-14T09:30:00Z',
    sheetA: SHEET_A_VERSIONS[0].id,
    approver: ANNA,
    reason: 'Created with 6 sections',
  },
  {
    id: id(0x61),
    version: 2,
    at: '2026-06-09T09:30:00Z',
    sheetA: SHEET_A_VERSIONS[1].id,
    approver: ANNA,
    reason: 'Capsid titre column linked to the ELISA model',
  },
  {
    id: id(0x62),
    version: 3,
    at: '2026-09-02T09:30:00Z',
    sheetA: SHEET_A_VERSIONS[2].id,
    approver: ANNA,
    reason: 'Method from PRT-021 v3; Meets criteria column',
  },
  {
    id: id(0x63),
    version: 4,
    at: '2026-09-25T08:30:00+01:00',
    sheetA: SHEET_A_VERSIONS[2].id,
    approver: MEI,
    reason: 'Pressure and ΔP sheet; Max ΔP field in the result summary',
  },
] as const
const DRAFT = { id: id(0x64), version: 5 }

export async function seedDesignTemplateStory(db: Db) {
  await db
    .insert(schema.notebookTemplates)
    .values({
      id: TEMPLATE,
      workspaceId: PROCESS,
      key: 'depth_filter_clarification_screen',
      name: 'Depth-filter clarification screen',
      description:
        'Harvest clarification screening with step yield, turbidity and pressure.',
      lifecycle: 'active',
      createdByUserId: GARETH,
    })
    .onConflictDoUpdate({
      target: [
        schema.notebookTemplates.workspaceId,
        schema.notebookTemplates.key,
      ],
      set: {
        name: 'Depth-filter clarification screen',
        description:
          'Harvest clarification screening with step yield, turbidity and pressure.',
      },
    })

  for (const [definitionId, key, name] of [
    [SHEET_A, 'clarification_runs', 'Clarification runs'],
    [SHEET_B, 'pressure_and_dp', 'Pressure and ΔP'],
  ] as const) {
    await db
      .insert(schema.sheetDefinitions)
      .values({
        id: definitionId,
        workspaceId: PROCESS,
        key,
        name,
        description:
          key === 'clarification_runs'
            ? 'Record one row per filter train and load. Enter turbidity from TB-02 and titre from the ELISA plate; both are read from DS-0311 when you link the dataset.'
            : `${name}: rows filled in the notebook.`,
        lifecycle: 'active',
        createdByUserId: GARETH,
      })
      .onConflictDoUpdate({
        target: schema.sheetDefinitions.id,
        set: {
          description:
            key === 'clarification_runs'
              ? 'Record one row per filter train and load. Enter turbidity from TB-02 and titre from the ELISA plate; both are read from DS-0311 when you link the dataset.'
              : `${name}: rows filled in the notebook.`,
        },
      })
  }

  const publishSheetVersion = async (
    definitionId: string,
    versionId: string,
    version: number,
    at: string,
    configuration: unknown,
  ) => {
    const existing = await db
      .select({ id: schema.sheetDefinitionVersions.id })
      .from(schema.sheetDefinitionVersions)
      .where(eq(schema.sheetDefinitionVersions.id, versionId))
    if (existing.length) return
    await db.insert(schema.sheetDefinitionVersions).values({
      id: versionId,
      definitionId,
      version,
      lifecycle: 'draft',
      revision: 1n,
      configuration,
      createdByUserId: GARETH,
      createdAt: new Date(at),
    })
    await db
      .update(schema.sheetDefinitionVersions)
      .set({
        lifecycle: 'published',
        publishedAt: new Date(at),
        publishedByUserId: GARETH,
      })
      .where(eq(schema.sheetDefinitionVersions.id, versionId))
  }

  for (const v of SHEET_A_VERSIONS)
    await publishSheetVersion(
      SHEET_A,
      v.id,
      v.version,
      v.at,
      sheetConfiguration(clarificationColumns(v.version), COL.filterTrain, {}),
    )
  await publishSheetVersion(
    SHEET_B,
    SHEET_B_VERSION.id,
    1,
    SHEET_B_VERSION.at,
    sheetConfiguration(pressureColumns(), COL_B.filterTrain, {}),
  )

  for (const v of TEMPLATE_VERSIONS) {
    const existing = await db
      .select({ id: schema.notebookTemplateVersions.id })
      .from(schema.notebookTemplateVersions)
      .where(eq(schema.notebookTemplateVersions.id, v.id))
    if (existing.length) continue
    await db.insert(schema.notebookTemplateVersions).values({
      id: v.id,
      templateId: TEMPLATE,
      version: v.version,
      lifecycle: 'draft',
      revision: 1n,
      configuration: {
        formatVersion: 1,
        parameters: [],
        placements: placements(v.version, v.sheetA),
      },
      reason: v.reason,
      createdByUserId: GARETH,
      createdAt: new Date(v.at),
    })
    await db
      .update(schema.notebookTemplateVersions)
      .set({
        lifecycle: 'published',
        publishedAt: new Date(v.at),
        publishedByUserId: GARETH,
      })
      .where(eq(schema.notebookTemplateVersions.id, v.id))
  }

  // Draft v5: the sheet's Max ΔP column and the load range widened to 300.
  const draftExists = await db
    .select({ id: schema.notebookTemplateVersions.id })
    .from(schema.notebookTemplateVersions)
    .where(eq(schema.notebookTemplateVersions.id, DRAFT.id))
  if (!draftExists.length) {
    await db.insert(schema.notebookTemplateVersions).values({
      id: DRAFT.id,
      templateId: TEMPLATE,
      version: DRAFT.version,
      lifecycle: 'draft',
      revision: 1n,
      configuration: {
        formatVersion: 1,
        parameters: [],
        placements: placements(4, SHEET_A_VERSIONS[2].id),
      },
      createdByUserId: GARETH,
      createdAt: new Date('2026-09-25T08:40:00+01:00'),
    })
  }
  await db
    .update(schema.notebookTemplateVersions)
    .set({
      configuration: {
        formatVersion: 1,
        parameters: [],
        placements: placements(5, SHEET_A_VERSIONS[3].id),
      },
      reason:
        'Max ΔP column in Clarification runs; load range widened to 300 L/m²',
      revision: 12n,
      updatedAt: new Date('2026-09-25T09:30:00+01:00'),
      updatedByUserId: GARETH,
    })
    .where(
      and(
        eq(schema.notebookTemplateVersions.id, DRAFT.id),
        eq(schema.notebookTemplateVersions.lifecycle, 'draft'),
      ),
    )

  // v1 and v2 were retired once v3 and v4 replaced them; retiring is e-signed.
  for (const v of TEMPLATE_VERSIONS.slice(0, 2)) {
    await db
      .update(schema.notebookTemplateVersions)
      .set({
        lifecycle: 'retired',
        retiredAt: new Date('2026-09-25T08:35:00+01:00'),
        retiredByUserId: ANNA,
        signedByUserId: ANNA,
        signedMeaning: 'Retired — no longer for new records',
        signedAt: new Date('2026-09-25T08:35:00+01:00'),
      })
      .where(
        and(
          eq(schema.notebookTemplateVersions.id, v.id),
          eq(schema.notebookTemplateVersions.lifecycle, 'published'),
        ),
      )
  }

  // Each published version was approved when it went out (direct rows: the
  // approval RPCs sign as the caller and stamp the real time).
  for (const v of TEMPLATE_VERSIONS) {
    const existing = await db
      .select({ id: schema.approvalRequests.id })
      .from(schema.approvalRequests)
      .where(eq(schema.approvalRequests.objectId, v.id))
    if (existing.length) continue
    const at = new Date(v.at)
    const [request] = await db
      .insert(schema.approvalRequests)
      .values({
        workspaceId: PROCESS,
        objectKind: 'notebook_template_version',
        objectId: v.id,
        objectRevision: 1,
        requiredApproverRoles: ['steward', 'admin', 'owner'],
        state: 'approved',
        reason: v.reason,
        approvedByUserIds: [v.approver],
        submittedByUserId: GARETH,
        submittedAt: at,
        decidedByUserId: v.approver,
        decidedAt: at,
      })
      .returning({ id: schema.approvalRequests.id })
    await db.insert(schema.approvalRequestDecisions).values({
      requestId: request.id,
      workspaceId: PROCESS,
      userId: v.approver,
      role: 'steward',
      decision: 'approved',
      createdAt: at,
    })
  }

  // The 13 experiments made from the template, as the InUse board lists them.
  const pinsByVersion: Array<[string, string[]]> = [
    [TEMPLATE_VERSIONS[0].id, ['EXP-0101', 'EXP-0097']],
    [TEMPLATE_VERSIONS[1].id, ['EXP-0121', 'EXP-0116', 'EXP-0109']],
    [TEMPLATE_VERSIONS[2].id, ['EXP-0142', 'EXP-0139', 'EXP-0141', 'EXP-0137']],
    [TEMPLATE_VERSIONS[3].id, ['EXP-0145', 'EXP-0146', 'EXP-0147', 'EXP-0148']],
  ]
  for (const [versionId, identifiers] of pinsByVersion)
    await db
      .update(schema.records)
      .set({ sourceNotebookTemplateVersionId: versionId })
      .where(
        and(
          eq(schema.records.workspaceId, PROCESS),
          inArray(schema.records.identifier, identifiers),
        ),
      )

  // Identifiers the seed lacks are topped up with other experiments, so each
  // version keeps the board's count (2, 3, 4 and 4).
  const targets = [2, 3, 4, 4]
  for (const [index, [versionId]] of pinsByVersion.entries()) {
    const have = await db
      .select({ id: schema.records.id })
      .from(schema.records)
      .where(eq(schema.records.sourceNotebookTemplateVersionId, versionId))
    const missing = targets[index] - have.length
    if (missing <= 0) continue
    const spare = await db
      .select({ id: schema.records.id })
      .from(schema.records)
      .where(
        and(
          eq(schema.records.workspaceId, PROCESS),
          eq(schema.records.kind, 'experiment'),
          isNull(schema.records.sourceNotebookTemplateVersionId),
        ),
      )
      .orderBy(schema.records.identifier)
      .limit(missing)
    if (spare.length)
      await db
        .update(schema.records)
        .set({ sourceNotebookTemplateVersionId: versionId })
        .where(
          inArray(
            schema.records.id,
            spare.map((r) => r.id),
          ),
        )
  }
}
