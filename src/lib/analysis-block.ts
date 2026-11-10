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

import { z } from 'zod'
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
  unit?: unknown
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
  /** Absent on historical evidence, which included every recorded value. */
  exclusionPolicy?: 'include_flagged' | 'exclude_bound_fields'
  columns: FrozenAnalysisColumn[]
  datasetProvenance: FrozenDatasetProvenance[]
}

/** The recorded method version, or null when the payload predates recording. */
export function frozenAnalysisMethodVersion(
  frozen: FrozenAnalysis,
): number | null {
  const recorded = methodVersion.safeParse(frozen.methodVersion).data

  return recorded ?? null
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

/** A stored payload: its keys, and whatever was stored under them. */
const jsonObject = z.record(z.string(), z.unknown())

/** A saved analysis definition or Dataset Version id. */
const uuidText = z.string().regex(UUID_RE)

/** A required, non-blank text field. */
const nonEmptyText = z.string().min(1)

/** A required Dataset row count. */
const rowCount = z.number().int()

/** A frozen payload's method version. */
const methodVersion = z.number().int().min(1)

/**
 * Validate an analysis block payload. An empty draft `{}` is valid (the
 * editor fills it in). Dataset reference integrity, frozen-write authority
 * and checksum correctness are enforced by the database trigger and freeze
 * RPC, not here.
 */
export function validateAnalysisBlockPayload(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- A stored block payload arrives unparsed; this validator is the boundary that reports each declared field's problem in the editor's order.
  payload: unknown,
): AnalysisBlockError[] {
  const given = jsonObject.safeParse(payload)

  if (!given.success) return [{ message: 'payload must be an object' }]

  if (Object.keys(given.data).length === 0) return []
  const stored = given.data
  const errors: AnalysisBlockError[] = []

  if (!nonEmptyText.safeParse(stored['title']).success)
    errors.push({ field: 'title', message: 'title is required' })

  if (!uuidText.safeParse(stored['definitionId']).success)
    errors.push({
      field: 'definitionId',
      message: 'definitionId must be a saved analysis definition UUID',
    })

  if (
    stored['provenance'] !== undefined &&
    stored['provenance'] !== null &&
    !z.string().safeParse(stored['provenance']).success
  )
    errors.push({
      field: 'provenance',
      message: 'provenance must be a string when present',
    })

  if (stored['frozen'] !== undefined && stored['frozen'] !== null) {
    const frozenObject = jsonObject.safeParse(stored['frozen'])

    if (!frozenObject.success) {
      errors.push({
        field: 'frozen',
        message: 'frozen must be an object when present',
      })
    } else {
      const f = frozenObject.data

      if (!nonEmptyText.safeParse(f['frozenAt']).success)
        errors.push({
          field: 'frozen.frozenAt',
          message: 'frozen.frozenAt is required',
        })

      if (!nonEmptyText.safeParse(f['frozenByUserId']).success)
        errors.push({
          field: 'frozen.frozenByUserId',
          message: 'frozen.frozenByUserId is required',
        })

      const definition = jsonObject.safeParse(f['definition'])

      if (!definition.success) {
        errors.push({
          field: 'frozen.definition',
          message: 'frozen.definition is required',
        })
      } else {
        const defErrors = validateAnalysisDefinition(definition.data)
        errors.push(
          ...defErrors.map((e) => ({
            field: `frozen.definition.${e.field ?? ''}`,
            message: e.message,
          })),
        )
      }

      const columns = Array.isArray(f['columns']) ? f['columns'] : null

      const columnsValid =
        columns !== null &&
        columns.every((column) => {
          const parsed = jsonObject.safeParse(column)

          return (
            parsed.success && uuidText.safeParse(parsed.data['fieldId']).success
          )
        })

      if (!columnsValid)
        errors.push({
          field: 'frozen.columns',
          message:
            'frozen.columns must carry fieldId metadata for each bound field',
        })

      const provenanceRows = Array.isArray(f['datasetProvenance'])
        ? f['datasetProvenance']
        : null

      const provenanceValid =
        provenanceRows !== null &&
        provenanceRows.length === 1 &&
        provenanceRows.every((entry) => {
          const row = jsonObject.safeParse(entry)

          if (!row.success) return false
          const value = row.data

          return (
            uuidText.safeParse(value['datasetId']).success &&
            uuidText.safeParse(value['datasetVersionId']).success &&
            rowCount.safeParse(value['rowCount']).success &&
            nonEmptyText.safeParse(value['checksum']).success
          )
        })

      if (!provenanceValid)
        errors.push({
          field: 'frozen.datasetProvenance',
          message:
            'frozen.datasetProvenance must pin exactly one Dataset Version with rowCount and checksum',
        })

      if (
        f['methodVersion'] !== undefined &&
        !methodVersion.safeParse(f['methodVersion']).success
      )
        errors.push({
          field: 'frozen.methodVersion',
          message:
            'frozen.methodVersion must be a positive integer when present',
        })

      // A frozen payload carries evidence references only; embedded source
      // rows are never accepted.
      if (f['data'] !== undefined)
        errors.push({
          field: 'frozen.data',
          message:
            'frozen payloads pin Dataset Versions and must not embed rows',
        })
    }
  }

  return errors
}
