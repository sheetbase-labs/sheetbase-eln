import { Client } from 'pg'
import { z } from 'zod'

import { env } from '#/env.server'
import { getAppSession } from '#/lib/auth'
import {
  buildFlagIndex,
  summariseExcludedValues,
  toDatasetValueFlag,
} from './dataset-flags'
import type {
  DatasetValueFlag,
  DatasetValueFlagWire,
  ExcludedValue,
  ExclusionSummary,
} from './dataset-flags'
import type { FieldDefinition } from './field-definition'
import {
  evaluateSheetCalculation,
  flaggedValueForProvenance,
  sheetInstanceCalculationSchema,
} from './sheet-calculation'
import type {
  SheetCalculationDependency,
  SheetCalculationInput,
} from './sheet-calculation'
import { fetchComposedSheetRows } from './sheet-composition-data'
import type { DataClient } from './data-client'
import { sheetInstanceStateSchema } from './sheet-instance'
import { parseSheetDefinitionConfiguration } from './sheet-definition'

const requestSchema = z
  .object({
    instanceId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
    retryToken: z.string().uuid(),
    offset: z.number().int().min(0).max(10_000).default(0),
    limit: z.number().int().min(1).max(200).default(200),
  })
  .strict()

type Snapshot = {
  instanceId: string
  workspaceId: string
  definitionVersionId: string
  revision: number
  state: z.infer<typeof sheetInstanceStateSchema>
  composition: Awaited<ReturnType<typeof fetchComposedSheetRows>>
  /** DSET-01.2 — active Dataset Value Flags for the composed bindings. */
  flags?: DatasetValueFlag[]
}

type TrustedResult = {
  calculationId: string
  rowKey: string
  scope: 'definition' | 'instance'
  definitionVersionId: string | null
  expression: { language: 'sheetbase-formula-v1'; source: string }
  dependencies: SheetCalculationDependency[]
  outputField: FieldDefinition
  sourceRevisions: unknown[]
  dependencyProvenance: unknown[]
  resultKind: 'value' | 'error'
  value: number | null
  errorCode: string | null
  diagnostic: string | null
}

function sourceRevisions(row: Snapshot['composition']['rows'][number]) {
  return row.sources.map((source) =>
    source.sourceKind === 'dataset'
      ? {
          kind: 'dataset-row',
          bindingId: source.bindingId,
          datasetId: source.datasetId,
          rowId: source.rowId,
          revision: source.revision,
          matched: source.matched,
        }
      : {
          kind: 'record',
          bindingId: source.bindingId,
          recordId: source.recordId,
        },
  )
}

/**
 * DSET-01.2 — active-flag index shared with every other exclusion surface.
 */
function snapshotFlagIndex(snapshot: Snapshot) {
  return buildFlagIndex(snapshot.flags ?? [])
}

interface SnapshotEvaluation {
  results: TrustedResult[]
  /** Distinct flagged Dataset values dropped from ƒx evaluation. */
  excluded: ExcludedValue[]
}

/** Pure bounded calculation over the authoritative composition snapshot. */
function evaluateSheetSnapshot(snapshot: Snapshot): SnapshotEvaluation {
  if (
    !snapshot.composition.definitionConfiguration ||
    !snapshot.composition.boundProjection
  )
    throw new Error('Calculation requires a pinned composed Definition.')
  const flagIndex = snapshotFlagIndex(snapshot)
  const configuration = parseSheetDefinitionConfiguration(
    snapshot.composition.definitionConfiguration,
  )
  const definitionColumns = new Map(
    configuration.columns.map((column) => [column.id, column]),
  )
  const localFields = new Map(
    snapshot.state.localFields.map((field) => [field.fieldId, field]),
  )
  const definitionCalculations = configuration.calculations.flatMap(
    (calculation) => {
      const hasOverride = Object.hasOwn(
        snapshot.state.calculationOverrides,
        calculation.id,
      )
      const override = hasOverride
        ? snapshot.state.calculationOverrides[calculation.id]
        : undefined
      if (override && !override.enabled) return []
      const output = definitionColumns.get(calculation.outputColumnId)
      if (!output) throw new Error('Definition calculation output is missing.')
      return [
        {
          id: calculation.id,
          scope: 'definition' as const,
          expression: override ? override.expression : calculation.expression,
          outputField: output.field,
          dependencies: calculation.inputColumnIds.map((id) => ({
            kind: 'column' as const,
            id,
          })),
        },
      ]
    },
  )
  const instanceCalculations = (snapshot.state.instanceCalculations ?? [])
    .filter((calculation) => calculation.lifecycle === 'active')
    .map((calculation) => ({
      ...sheetInstanceCalculationSchema.parse(calculation),
      scope: 'instance' as const,
    }))
  const calculations = [...definitionCalculations, ...instanceCalculations]
  const calculationById = new Map(
    calculations.map((calculation) => [calculation.id, calculation]),
  )
  const projectionRows = new Map(
    snapshot.composition.boundProjection.rows.map((row) => [row.rowKey, row]),
  )
  const results: TrustedResult[] = []
  const excluded: ExcludedValue[] = []

  for (const row of snapshot.composition.rows) {
    const projected = projectionRows.get(row.rowKey)
    if (!projected) throw new Error('Bound projection row is missing.')
    const rowResults = new Map<string, TrustedResult>()
    const evaluating = new Set<string>()
    const evaluate = (calculationId: string): TrustedResult => {
      const cached = rowResults.get(calculationId)
      if (cached) return cached
      const calculation = calculationById.get(calculationId)
      if (!calculation) throw new Error('Unknown calculation dependency.')
      if (evaluating.has(calculationId)) {
        const cycle: TrustedResult = {
          calculationId,
          rowKey: row.rowKey,
          scope: calculation.scope,
          definitionVersionId:
            calculation.scope === 'definition'
              ? snapshot.definitionVersionId
              : null,
          expression: calculation.expression,
          dependencies: calculation.dependencies,
          outputField: calculation.outputField,
          sourceRevisions: sourceRevisions(row),
          dependencyProvenance: [],
          resultKind: 'error',
          value: null,
          errorCode: 'EVALUATION',
          diagnostic: 'Calculation dependency cycle.',
        }
        rowResults.set(calculationId, cycle)
        return cycle
      }
      evaluating.add(calculationId)
      const inputs: SheetCalculationInput[] = calculation.dependencies.map(
        (dependency) => {
          if (dependency.kind === 'local-field') {
            const field = localFields.get(dependency.id)
            if (!field) throw new Error('Unknown local calculation field.')
            const hasValues = Object.hasOwn(
              snapshot.state.localValues,
              row.rowKey,
            )
            const values = hasValues
              ? snapshot.state.localValues[row.rowKey]
              : undefined
            return {
              dependency,
              field,
              state:
                values !== undefined && Object.hasOwn(values, dependency.id)
                  ? 'present'
                  : 'missing',
              value: values?.[dependency.id],
              provenance: {
                kind: 'instance-local',
                instanceId: snapshot.instanceId,
                rowKey: row.rowKey,
                fieldId: dependency.id,
                instanceRevision: snapshot.revision,
              },
            }
          }
          if (dependency.kind === 'calculation') {
            const dependencyResult = evaluate(dependency.id)
            const dependencyCalculation = calculationById.get(dependency.id)!
            return {
              dependency,
              field: dependencyCalculation.outputField,
              state:
                dependencyResult.resultKind === 'value'
                  ? 'present'
                  : dependencyResult.errorCode === 'EXCLUDED'
                    ? 'excluded'
                    : 'missing',
              value: dependencyResult.value,
              provenance: {
                kind: 'calculation',
                calculationId: dependency.id,
                rowKey: row.rowKey,
                resultKind: dependencyResult.resultKind,
              },
            }
          }
          const column = definitionColumns.get(dependency.id)
          if (!column) throw new Error('Unknown Definition column dependency.')
          if (column.source.kind === 'calculated') {
            const dependencyResult = evaluate(column.source.calculationId)
            return {
              dependency,
              field: column.field,
              state:
                dependencyResult.resultKind === 'value'
                  ? 'present'
                  : dependencyResult.errorCode === 'EXCLUDED'
                    ? 'excluded'
                    : 'missing',
              value: dependencyResult.value,
              provenance: {
                kind: 'calculation',
                calculationId: column.source.calculationId,
                rowKey: row.rowKey,
                resultKind: dependencyResult.resultKind,
              },
            }
          }
          if (!Object.hasOwn(projected.values, dependency.id))
            return {
              dependency,
              field: column.field,
              state: 'missing',
              provenance: {
                kind: 'definition-column',
                columnId: dependency.id,
              },
            }
          const bound = projected.values[dependency.id]
          // DSET-01.2 — a flagged Dataset value is excluded by default.
          const flag =
            bound.kind === 'present'
              ? flaggedValueForProvenance(bound.provenance, flagIndex)
              : undefined
          if (flag) {
            excluded.push({ rowId: flag.rowId, fieldId: flag.fieldId, flag })
            return {
              dependency,
              field: column.field,
              state: 'excluded',
              provenance: bound.provenance,
            }
          }
          return {
            dependency,
            field: column.field,
            state: bound.kind === 'unmatched' ? 'unmatched' : 'present',
            value: bound.kind === 'present' ? bound.value : undefined,
            provenance: bound.provenance,
          }
        },
      )
      const evaluated = evaluateSheetCalculation({
        calculationId,
        expression: calculation.expression.source,
        outputField: calculation.outputField,
        inputs,
      })
      const result: TrustedResult = {
        calculationId,
        rowKey: row.rowKey,
        scope: calculation.scope,
        definitionVersionId:
          calculation.scope === 'definition'
            ? snapshot.definitionVersionId
            : null,
        expression: calculation.expression,
        dependencies: calculation.dependencies,
        outputField: calculation.outputField,
        sourceRevisions: sourceRevisions(row),
        dependencyProvenance: evaluated.dependencyProvenance,
        resultKind: evaluated.status,
        value: evaluated.status === 'value' ? evaluated.value : null,
        errorCode: evaluated.status === 'error' ? evaluated.errorCode : null,
        diagnostic: evaluated.status === 'error' ? evaluated.diagnostic : null,
      }
      rowResults.set(calculationId, result)
      evaluating.delete(calculationId)
      return result
    }
    for (const calculation of calculations) evaluate(calculation.id)
    results.push(...rowResults.values())
  }
  return { results, excluded }
}

/** Pure bounded calculation results; exclusions are applied but not reported. */
export function calculateSheetSnapshot(snapshot: Snapshot): TrustedResult[] {
  return evaluateSheetSnapshot(snapshot).results
}

/**
 * DSET-01.2 — calculation results plus how many flagged Dataset values were
 * excluded from ƒx evaluation, so a caller can report them instead of dropping
 * them silently.
 */
export function calculateSheetSnapshotReport(snapshot: Snapshot): {
  results: TrustedResult[]
  exclusions: ExclusionSummary
} {
  const { results, excluded } = evaluateSheetSnapshot(snapshot)
  return { results, exclusions: summariseExcludedValues(excluded) }
}

export interface SheetCalculationServerDeps {
  getSession: typeof getAppSession
  loadSnapshot: (
    actor: string,
    instanceId: string,
    offset: number,
    limit: number,
  ) => Promise<Snapshot>
  finalize: (
    actor: string,
    snapshot: Snapshot,
    retryToken: string,
    results: TrustedResult[],
  ) => Promise<unknown>
}

async function loadSnapshot(
  actor: string,
  instanceId: string,
  offset: number,
  limit: number,
): Promise<Snapshot> {
  const client = new Client({ connectionString: env.DATABASE_URL })
  await client.connect()
  try {
    await client.query(
      'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
    )
    const instance = (
      await client.query<{
        id: string
        workspace_id: string
        source_definition_version_id: string | null
        revision: string
        state: unknown
      }>(
        `SELECT i.id,i.workspace_id,i.source_definition_version_id,i.revision,i.state
           FROM api.sheet_instances i JOIN api.workspace_memberships m
             ON m.workspace_id=i.workspace_id AND m.user_id=$2
          WHERE i.id=$1 AND i.lifecycle='active'`,
        [instanceId, actor],
      )
    ).rows.at(0)
    if (!instance || !instance.source_definition_version_id)
      throw Object.assign(
        new Error('Composed Sheet Instance is unavailable.'),
        {
          code: '42501',
        },
      )
    await client.query('SET LOCAL ROLE authenticated')
    await client.query(`SELECT set_config('request.jwt.claims',$1,true)`, [
      JSON.stringify({
        sub: actor,
        workspace_id: instance.workspace_id,
        role: 'authenticated',
      }),
    ])
    const raw = (
      await client.query<{ result: unknown }>(
        `SELECT api.query_sheet_instance_rows($1,$2,$3) result`,
        [instanceId, limit, offset],
      )
    ).rows[0].result
    const dataClient: DataClient = {
      rpc: async <T>() => raw as T,
      list: async () => [],
      count: async () => 0,
      insert: async () => {
        throw new Error('unsupported')
      },
      patch: async () => [],
      remove: async () => [],
    }
    const composition = await fetchComposedSheetRows(
      instanceId,
      { offset, limit },
      dataClient,
    )
    // DSET-01.2 — read the active flags for every Dataset the composition
    // binds, so ƒx evaluation excludes flagged values by default. Flags are
    // only visible to workspace members; the RLS context is already set.
    const datasetIds = Array.from(
      new Set(
        composition.rows.flatMap((row) =>
          row.sources
            .filter((source) => source.sourceKind === 'dataset')
            .map((source) => source.datasetId),
        ),
      ),
    )
    const flags: DatasetValueFlag[] =
      datasetIds.length > 0
        ? (
            await client.query<DatasetValueFlagWire>(
              `SELECT id,dataset_id,row_id,field_id,kind,source,reason,comment,set_at,cleared_at
                 FROM api.dataset_value_flags
                WHERE cleared_at IS NULL AND dataset_id = ANY($1::uuid[])`,
              [datasetIds],
            )
          ).rows.map(toDatasetValueFlag)
        : []
    await client.query('COMMIT')
    return {
      instanceId,
      workspaceId: instance.workspace_id,
      definitionVersionId: instance.source_definition_version_id,
      revision: Number(instance.revision),
      state: sheetInstanceStateSchema.parse(instance.state),
      composition,
      flags,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    await client.end()
  }
}

async function finalize(
  actor: string,
  snapshot: Snapshot,
  retryToken: string,
  results: TrustedResult[],
) {
  const client = new Client({ connectionString: env.FORMULA_DATABASE_URL })
  await client.connect()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE formula_writer')
    const response = await client.query<{ result: unknown }>(
      `SELECT internal.apply_trusted_sheet_calculation($1,$2,$3,$4,$5::jsonb) result`,
      [
        actor,
        snapshot.instanceId,
        snapshot.revision,
        retryToken,
        JSON.stringify(results),
      ],
    )
    await client.query('COMMIT')
    return response.rows[0].result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    await client.end()
  }
}

export async function handleSheetCalculation(
  request: Request,
  deps: SheetCalculationServerDeps = {
    getSession: getAppSession,
    loadSnapshot,
    finalize,
  },
) {
  const session = await deps.getSession(request.headers)
  if (!session)
    return Response.json(
      {
        error: {
          code: 'unauthenticated',
          message: 'Authentication is required.',
        },
      },
      { status: 401 },
    )
  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success)
    return Response.json(
      {
        error: {
          code: 'invalid_request',
          message: 'Invalid calculation request.',
        },
      },
      { status: 400 },
    )
  try {
    const snapshot = await deps.loadSnapshot(
      session.user.id,
      parsed.data.instanceId,
      parsed.data.offset,
      parsed.data.limit,
    )
    if (snapshot.revision !== parsed.data.expectedRevision)
      return Response.json(
        {
          error: {
            code: 'stale_revision',
            message: 'Sheet Instance changed; retry.',
          },
        },
        { status: 409 },
      )
    const { results, exclusions } = calculateSheetSnapshotReport(snapshot)
    const finalized = await deps.finalize(
      session.user.id,
      snapshot,
      parsed.data.retryToken,
      results,
    )
    // DSET-01.2 — surface the exclusion count alongside the persisted result
    // batch. Data-layer only; no UI is mandated here.
    return Response.json(
      finalized !== null && typeof finalized === 'object'
        ? { ...(finalized as Record<string, unknown>), exclusions }
        : { result: finalized, exclusions },
    )
  } catch (error) {
    const candidate = error as { code?: string }
    const status =
      candidate.code === 'SB073' ? 409 : candidate.code === '42501' ? 403 : 500
    return Response.json(
      {
        error: {
          code:
            status === 409
              ? 'stale_revision'
              : status === 403
                ? 'forbidden'
                : 'calculation_failed',
          message:
            status === 409
              ? 'Sheet Instance changed; retry.'
              : status === 403
                ? 'Sheet Instance is unavailable.'
                : 'Sheet calculation failed.',
        },
      },
      { status },
    )
  }
}
