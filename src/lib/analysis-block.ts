/**
 * SCI-03 — the `analysis` notebook block payload contract.
 *
 * An analysis block references a saved analysis definition by stable UUID
 * (ADR 0040) and renders its execution against live dataset rows. Freezing
 * follows the decision-0029 chart pattern: the SECURITY DEFINER
 * `freeze_analysis_block` RPC pins the definition verbatim plus the exact
 * input rows (with schema version, row count and checksum provenance) into
 * the payload; a frozen block re-executes the pure `runAnalysis` over those
 * pinned inputs, so evidence is reproducible even after the datasets evolve.
 *
 * Validation is mirrored by the database `validate_scientific_block` trigger;
 * direct CRUD can never fabricate, alter or remove a frozen payload.
 */

import { validateAnalysisDefinition } from './analysis-definition'
import type { AnalysisDefinition } from './analysis-definition'

/** Reuses the chart frozen-column metadata shape (decision 0029 §5). */
export interface FrozenAnalysisColumn {
  columnId: string
  fieldName: string
  label: string
  logicalType: string
}

export interface FrozenDatasetProvenance {
  tableId: string
  schemaVersion: number
  rowCount: number
  checksum: string
}

export interface FrozenAnalysis {
  revisionId: string | null
  frozenAt: string
  frozenByUserId: string
  /** Verbatim definition snapshot; later edits to the saved original do not
   * change what frozen evidence shows. */
  definition: AnalysisDefinition
  definitionName: string | null
  definitionVersion: number
  datasetProvenance: FrozenDatasetProvenance[]
  data: {
    columns: FrozenAnalysisColumn[]
    rows: Record<string, unknown>[]
  }
}

export interface AnalysisBlockPayload {
  title?: string
  definitionId?: string
  provenance?: string
  frozen?: FrozenAnalysis | null
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type AnalysisBlockError = {
  field?: string
  message: string
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

/**
 * Validate an analysis block payload. An empty draft `{}` is valid (the
 * editor fills it in). Dataset reference integrity and frozen-write
 * authority are enforced by the database trigger, not here.
 */
export function validateAnalysisBlockPayload(
  payload: unknown,
): AnalysisBlockError[] {
  if (!isObject(payload)) return [{ message: 'payload must be an object' }]
  if (Object.keys(payload).length === 0) return []
  const errors: AnalysisBlockError[] = []

  if (typeof payload.title !== 'string' || payload.title.trim() === '')
    errors.push({ field: 'title', message: 'title is required' })
  if (!isUuid(payload.definitionId))
    errors.push({
      field: 'definitionId',
      message: 'definitionId must be a saved analysis definition UUID',
    })
  if (
    payload.provenance !== undefined &&
    payload.provenance !== null &&
    typeof payload.provenance !== 'string'
  )
    errors.push({
      field: 'provenance',
      message: 'provenance must be a string when present',
    })

  if (payload.frozen !== undefined && payload.frozen !== null) {
    if (!isObject(payload.frozen)) {
      errors.push({
        field: 'frozen',
        message: 'frozen must be an object when present',
      })
    } else {
      const f = payload.frozen
      if (typeof f.frozenAt !== 'string' || f.frozenAt === '')
        errors.push({
          field: 'frozen.frozenAt',
          message: 'frozen.frozenAt is required',
        })
      if (typeof f.frozenByUserId !== 'string' || f.frozenByUserId === '')
        errors.push({
          field: 'frozen.frozenByUserId',
          message: 'frozen.frozenByUserId is required',
        })
      if (!isObject(f.definition)) {
        errors.push({
          field: 'frozen.definition',
          message: 'frozen.definition is required',
        })
      } else {
        const defErrors = validateAnalysisDefinition(f.definition)
        errors.push(
          ...defErrors.map((e) => ({
            field: `frozen.definition.${e.field ?? ''}`,
            message: e.message,
          })),
        )
      }
      if (
        !Array.isArray(f.datasetProvenance) ||
        f.datasetProvenance.length === 0
      )
        errors.push({
          field: 'frozen.datasetProvenance',
          message: 'frozen.datasetProvenance must be a non-empty array',
        })
      if (
        !isObject(f.data) ||
        !Array.isArray((f.data).columns) ||
        !Array.isArray((f.data).rows)
      )
        errors.push({
          field: 'frozen.data',
          message: 'frozen.data must carry columns and rows arrays',
        })
    }
  }
  return errors
}
