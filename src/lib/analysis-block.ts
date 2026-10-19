/**
 * SCI-03 — the `analysis` notebook block payload contract.
 *
 * An analysis block references a saved analysis definition by stable UUID
 * and renders its execution against canonical Dataset rows. Freezing pins
 * an **immutable Dataset Version** (decision 0037) per input dataset plus
 * the verbatim definition snapshot and column metadata — never a copy of
 * the source rows. The block therefore stays small at any Dataset scale,
 * and frozen evidence is reconstructed deterministically by re-executing
 * the pure `runAnalysis` over the pinned Version's rows; the recorded row
 * count and checksum prove the inputs are the ones that were pinned.
 *
 * Validation is mirrored by the database `validate_scientific_block`
 * trigger; direct CRUD can never fabricate, alter or remove a frozen
 * payload — only the SECURITY DEFINER freeze/unfreeze RPCs may write one.
 */

import {
  ANALYSIS_METHOD_VERSION,
  validateAnalysisDefinition,
} from './analysis-definition'
import type { AnalysisBlockDefinition } from './analysis-definition'

/** Column metadata captured at freeze time so frozen blocks can render
 * labels/types even after schema evolution. Metadata only — no rows. */
export interface FrozenAnalysisColumn {
  fieldId: string
  label: string
  logicalType: string
}

/** Provenance for the single immutable Dataset Version backing the freeze. */
export interface FrozenDatasetProvenance {
  /** Canonical `api.datasets.id`. */
  datasetId: string
  /** Immutable snapshot created by `snapshot_dataset` during freeze. */
  datasetVersionId: string
  /** Numeric version of the Dataset Schema Version pinned by the snapshot. */
  schemaVersionNumber: number
  /** Live dataset revision at snapshot time (from dataset_versions). */
  sourceDatasetRevision: number
  rowCount: number
  /** md5 over the Version's normalised per-row values ordered by row_id. */
  checksum: string
}

export interface FrozenAnalysis {
  revisionId: string | null
  frozenAt: string
  frozenByUserId: string
  /** Verbatim definition snapshot; later edits to the saved original do not
   * change what frozen evidence reconstructs. */
  definition: AnalysisBlockDefinition
  definitionName: string | null
  definitionVersion: number
  /**
   * R5-STUDIO-01: the analysis-method definition version this freeze was
   * computed under. Written by `freeze_analysis_block` (migration 0426) and
   * mirrored by `ANALYSIS_METHOD_VERSION`; reconstruction refuses to present
   * numbers under a different method version. Absent on payloads frozen
   * before the method was recorded — those report the method as unrecorded
   * rather than assuming the current kernel still reproduces them.
   */
  methodVersion?: number
  columns: FrozenAnalysisColumn[]
  datasetProvenance: FrozenDatasetProvenance[]
}

/** The recorded method version, or null when the payload predates recording. */
export function frozenAnalysisMethodVersion(
  frozen: FrozenAnalysis,
): number | null {
  const recorded = frozen.methodVersion
  return typeof recorded === 'number' &&
    Number.isInteger(recorded) &&
    recorded > 0
    ? recorded
    : null
}

/**
 * A recorded method version this build cannot reproduce, or null when it can
 * (or when none was recorded). The frozen definition still names the model;
 * the numbers are withheld because they would be produced under a different
 * method definition than the citation recorded.
 */
export function frozenAnalysisMethodMismatch(
  frozen: FrozenAnalysis,
  currentMethodVersion: number = ANALYSIS_METHOD_VERSION,
): { recorded: number; current: number } | null {
  const recorded = frozenAnalysisMethodVersion(frozen)
  if (recorded === null || recorded === currentMethodVersion) return null
  return { recorded, current: currentMethodVersion }
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
 * editor fills it in). Dataset reference integrity, frozen-write authority
 * and checksum correctness are enforced by the database trigger and freeze
 * RPC, not here.
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
        !Array.isArray(f.columns) ||
        f.columns.some((c) => !isObject(c) || !isUuid(c.fieldId))
      )
        errors.push({
          field: 'frozen.columns',
          message:
            'frozen.columns must carry fieldId metadata for each bound field',
        })
      if (
        !Array.isArray(f.datasetProvenance) ||
        f.datasetProvenance.length !== 1 ||
        f.datasetProvenance.some(
          (p) =>
            !isObject(p) ||
            !isUuid(p.datasetId) ||
            !isUuid(p.datasetVersionId) ||
            typeof p.rowCount !== 'number' ||
            typeof p.checksum !== 'string' ||
            p.checksum === '',
        )
      )
        errors.push({
          field: 'frozen.datasetProvenance',
          message:
            'frozen.datasetProvenance must pin exactly one Dataset Version with rowCount and checksum',
        })
      if (
        f.methodVersion !== undefined &&
        (typeof f.methodVersion !== 'number' ||
          !Number.isInteger(f.methodVersion) ||
          f.methodVersion < 1)
      )
        errors.push({
          field: 'frozen.methodVersion',
          message:
            'frozen.methodVersion must be a positive integer when present',
        })
      // A frozen payload carries evidence references only; embedded source
      // rows are never accepted.
      if (f.data !== undefined)
        errors.push({
          field: 'frozen.data',
          message:
            'frozen payloads pin Dataset Versions and must not embed rows',
        })
    }
  }
  return errors
}
