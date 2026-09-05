/**
 * SCI-005 — Plate map specification model and validation (decision 0030).
 *
 * A `plate_map` notebook block carries a `PlateMapSpec` on its JSONB payload.
 * This module is the application-boundary source of truth for the spec shape:
 * the block validator (`src/lib/blocks`) delegates plate-map-payload
 * validation here, the DB trigger (`validate_scientific_block`) mirrors the
 * structural rules and enforces reference integrity, and the renderer/preview
 * consume the typed shapes.
 *
 * The spec is intentionally generic: it stores well assignments with generic
 * roles (sample, positive control, negative control, blank, empty), optional
 * sample record links, replicates, and volumes with structured units. No
 * biotech-specific assay semantics are baked into global infrastructure.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PLATE_MAP_SPEC_VERSION = 1 as const

/**
 * Approved plate formats. Initially 96-well (8×12). Extensible to 384-well
 * and other approved future formats by extending this union and updating the
 * DB trigger's format guard — no data migration required.
 */
export const PLATE_FORMATS = ['96_well'] as const
export type PlateFormat = (typeof PLATE_FORMATS)[number]

/**
 * Format dimensions lookup. Adding a format requires adding its dimensions
 * here, in the DB trigger, and in the application validator.
 */
export const FORMAT_DIMENSIONS: Record<
  PlateFormat,
  { rows: number; cols: number }
> = {
  '96_well': { rows: 8, cols: 12 },
}

/**
 * Generic, extensible assignment roles. No biotech-specific assay semantics.
 */
export const ASSIGNMENT_ROLES = [
  'sample',
  'positive_control',
  'negative_control',
  'blank',
  'empty',
] as const
export type AssignmentRole = (typeof ASSIGNMENT_ROLES)[number]

/**
 * Assignment-role display metadata: label and Tailwind colour classes for
 * the presentational PlateMap component and legend.
 */
export interface RoleStyle {
  label: string
  /** Background colour class for the well cell. */
  cellClass: string
  /** Badge colour class for the inspector. */
  badgeClass: string
}

export const ROLE_STYLES: Record<AssignmentRole, RoleStyle> = {
  sample: {
    label: 'Sample',
    cellClass: 'bg-blue-300 dark:bg-blue-700',
    badgeClass: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  },
  positive_control: {
    label: 'Positive control',
    cellClass: 'bg-emerald-400 dark:bg-emerald-600',
    badgeClass:
      'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  },
  negative_control: {
    label: 'Negative control',
    cellClass: 'bg-orange-400 dark:bg-orange-600',
    badgeClass:
      'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  },
  blank: {
    label: 'Blank',
    cellClass: 'bg-slate-300 dark:bg-slate-600',
    badgeClass:
      'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  },
  empty: {
    label: 'Empty',
    cellClass: 'bg-muted-foreground/10',
    badgeClass: 'bg-muted text-muted-foreground',
  },
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Stable, honest snapshot of a sample record reference. The `recordId` is
 * authoritative; `identifier` and `title` are observed display values captured
 * at assignment time so archived, renamed, or soft-deleted samples remain
 * historically resolvable. The `archived` flag is a snapshot of the record's
 * archived state at observation time.
 */
export interface SampleRef {
  recordId: string
  identifier: string
  title: string
  archived?: boolean
}

/**
 * Structured volume with a numeric value and string unit (e.g. µL, mL).
 */
export interface Volume {
  value: number
  unit: string
}

/**
 * A single well assignment on a plate.
 */
export interface WellAssignment {
  /** Canonical well code, e.g. "A1", "B12". */
  wellCode: string
  /** 0-based row index. */
  row: number
  /** 0-based column index. */
  col: number
  role: AssignmentRole
  /** Optional link to a sample record (required for `sample` role). */
  sampleRef?: SampleRef
  /** Optional 1-based replicate index. */
  replicate?: number
  /** Optional volume with structured unit. */
  volume?: Volume
  /** Optional free-text notes. */
  notes?: string
}

/**
 * Optional validation configuration for the plate.
 */
export interface PlateValidationConfig {
  /** Roles that must be present on the plate (e.g. positive_control). */
  requiredRoles?: AssignmentRole[]
  /** Minimum volume value when configured. */
  volumeMin?: number
  /** Maximum volume value when configured. */
  volumeMax?: number
  /** Expected volume unit for constraint checking. */
  volumeUnit?: string
}

/**
 * The plate map specification stored in the block payload.
 */
export interface PlateMapSpec {
  specVersion: number
  format: PlateFormat
  rows: number
  cols: number
  wells: WellAssignment[]
  validation: PlateValidationConfig
}

/**
 * The full plate_map block payload. An empty draft `{}` is valid.
 */
export interface PlateMapBlockPayload {
  title?: string
  spec?: PlateMapSpec
  provenance?: string
}

// ---------------------------------------------------------------------------
// Validation errors
// ---------------------------------------------------------------------------

export type PlateMapSpecError = {
  code:
    | 'invalid_shape'
    | 'missing_field'
    | 'invalid_value'
    | 'unsupported_format'
    | 'unsupported_spec_version'
    | 'unsupported_role'
    | 'invalid_well_code'
    | 'duplicate_well'
    | 'out_of_bounds'
    | 'invalid_sample_ref'
    | 'invalid_volume'
    | 'invalid_replicate'
    | 'missing_required_role'
    | 'duplicate_assignment'
  field?: string
  message: string
}

// ---------------------------------------------------------------------------
// Coordinate helpers
// ---------------------------------------------------------------------------

/**
 * Convert a 0-based row index to a row label (A, B, C, …).
 * Uses bijective base-26 labels past Z (26 → "AA", 27 → "AB", …) so large
 * plate formats (e.g. 32-row 1536-well) keep canonical, parseable codes.
 */
export function rowLabel(row: number): string {
  let label = ''
  let n = row
  do {
    label = String.fromCharCode(65 + (n % 26)) + label
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return label
}

/**
 * Convert a row label back to a 0-based row index. Returns null when the
 * label is not a non-empty run of A–Z.
 */
export function rowIndex(label: string): number | null {
  if (!/^[A-Z]+$/.test(label)) return null
  let row = 0
  for (const ch of label) row = row * 26 + (ch.charCodeAt(0) - 64)
  return row - 1
}

/**
 * Build the canonical well code from 0-based row and column indices.
 * e.g. (0, 0) → "A1", (1, 11) → "B12".
 */
export function wellCode(row: number, col: number): string {
  return `${rowLabel(row)}${col + 1}`
}

/**
 * Parse a canonical well code into 0-based row and column indices.
 * Returns null if the code is malformed.
 */
export function parseWellCode(
  code: string,
): { row: number; col: number } | null {
  const match = /^([A-Z]+)([1-9][0-9]*)$/.exec(code)
  if (!match) return null
  const row = rowIndex(match[1])
  if (row === null) return null
  return { row, col: parseInt(match[2], 10) - 1 }
}

/**
 * Check if a well code is valid for the given dimensions.
 */
export function isValidWellCode(
  code: string,
  rows: number,
  cols: number,
): boolean {
  const parsed = parseWellCode(code)
  if (!parsed) return false
  return (
    parsed.row >= 0 && parsed.row < rows && parsed.col >= 0 && parsed.col < cols
  )
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

function isPositiveInteger(v: unknown): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v > 0
}

function isPositiveFinite(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
}

function isString(v: unknown): v is string {
  return typeof v === 'string'
}

/**
 * Validate a `PlateMapSpec` structurally. Does NOT query the database;
 * reference integrity (same-workspace sample existence) is enforced by the
 * DB trigger. Returns all discoverable errors.
 */
export function validatePlateMapSpec(spec: unknown): PlateMapSpecError[] {
  const errors: PlateMapSpecError[] = []
  if (!isObject(spec)) {
    return [{ code: 'invalid_shape', message: 'spec must be an object' }]
  }

  // specVersion
  const specVersion = spec.specVersion
  if (specVersion !== PLATE_MAP_SPEC_VERSION) {
    errors.push({
      code: 'unsupported_spec_version',
      field: 'spec.specVersion',
      message: `specVersion must be ${PLATE_MAP_SPEC_VERSION}`,
    })
  }

  // format
  const format = spec.format
  if (!isString(format) || !PLATE_FORMATS.includes(format as PlateFormat)) {
    errors.push({
      code: 'unsupported_format',
      field: 'spec.format',
      message: `format must be one of: ${PLATE_FORMATS.join(', ')}`,
    })
    return errors // Can't validate dimensions without a known format
  }

  const expectedDims = FORMAT_DIMENSIONS[format as PlateFormat]

  // rows
  const rows = spec.rows
  if (
    typeof rows !== 'number' ||
    !Number.isInteger(rows) ||
    rows !== expectedDims.rows
  ) {
    errors.push({
      code: 'invalid_value',
      field: 'spec.rows',
      message: `rows must be ${expectedDims.rows} for format ${format}`,
    })
  }

  // cols
  const cols = spec.cols
  if (
    typeof cols !== 'number' ||
    !Number.isInteger(cols) ||
    cols !== expectedDims.cols
  ) {
    errors.push({
      code: 'invalid_value',
      field: 'spec.cols',
      message: `cols must be ${expectedDims.cols} for format ${format}`,
    })
  }

  // Can't validate wells without valid dimensions
  if (errors.some((e) => e.field === 'spec.rows' || e.field === 'spec.cols')) {
    return errors
  }

  const actualRows = rows as number
  const actualCols = cols as number

  // wells
  const wells = spec.wells
  if (!Array.isArray(wells)) {
    errors.push({
      code: 'missing_field',
      field: 'spec.wells',
      message: 'wells is required and must be an array',
    })
    return errors
  }

  // Well-count vs dimensions
  if (wells.length > actualRows * actualCols) {
    errors.push({
      code: 'invalid_value',
      field: 'spec.wells',
      message: `wells array length (${wells.length}) exceeds plate capacity (${actualRows * actualCols})`,
    })
  }

  // validation config
  const validation = spec.validation
  if (!isObject(validation)) {
    errors.push({
      code: 'missing_field',
      field: 'spec.validation',
      message: 'validation is required and must be an object',
    })
  }

  const seenWellCodes = new Map<string, number>()
  const assignmentMap = new Map<string, number[]>() // key: recordId:role:replicate → well indices

  wells.forEach((well, i) => {
    const prefix = `spec.wells[${i}]`

    if (!isObject(well)) {
      errors.push({
        code: 'invalid_shape',
        field: prefix,
        message: 'well must be an object',
      })
      return
    }

    // wellCode
    const code = well.wellCode
    if (!isString(code)) {
      errors.push({
        code: 'missing_field',
        field: `${prefix}.wellCode`,
        message: 'wellCode is required and must be a string',
      })
    } else if (!isValidWellCode(code, actualRows, actualCols)) {
      errors.push({
        code: 'invalid_well_code',
        field: `${prefix}.wellCode`,
        message: `wellCode "${code}" is invalid or out of bounds for ${actualRows}×${actualCols} plate`,
      })
    }

    // row
    const r = well.row
    if (
      typeof r !== 'number' ||
      !Number.isInteger(r) ||
      r < 0 ||
      r >= actualRows
    ) {
      errors.push({
        code: 'out_of_bounds',
        field: `${prefix}.row`,
        message: `row must be an integer in [0, ${actualRows - 1}]`,
      })
    }

    // col
    const c = well.col
    if (
      typeof c !== 'number' ||
      !Number.isInteger(c) ||
      c < 0 ||
      c >= actualCols
    ) {
      errors.push({
        code: 'out_of_bounds',
        field: `${prefix}.col`,
        message: `col must be an integer in [0, ${actualCols - 1}]`,
      })
    }

    // Cross-check wellCode ↔ row/col
    if (
      isString(code) &&
      typeof r === 'number' &&
      Number.isInteger(r) &&
      r >= 0 &&
      r < actualRows &&
      typeof c === 'number' &&
      Number.isInteger(c) &&
      c >= 0 &&
      c < actualCols
    ) {
      const expected = wellCode(r, c)
      if (code !== expected) {
        errors.push({
          code: 'invalid_well_code',
          field: `${prefix}.wellCode`,
          message: `wellCode "${code}" does not match row ${r}, col ${c} (expected "${expected}")`,
        })
      }
    }

    // Duplicate well codes
    if (isString(code)) {
      if (seenWellCodes.has(code)) {
        errors.push({
          code: 'duplicate_well',
          field: `${prefix}.wellCode`,
          message: `duplicate wellCode "${code}" (also at index ${seenWellCodes.get(code)})`,
        })
      } else {
        seenWellCodes.set(code, i)
      }
    }

    // role
    const role = well.role
    if (!isString(role) || !ASSIGNMENT_ROLES.includes(role as AssignmentRole)) {
      errors.push({
        code: 'unsupported_role',
        field: `${prefix}.role`,
        message: `role must be one of: ${ASSIGNMENT_ROLES.join(', ')}`,
      })
    }

    // sampleRef
    const sampleRef = well.sampleRef
    if (sampleRef !== undefined && sampleRef !== null) {
      if (!isObject(sampleRef)) {
        errors.push({
          code: 'invalid_sample_ref',
          field: `${prefix}.sampleRef`,
          message: 'sampleRef must be an object',
        })
      } else {
        const ref = sampleRef
        if (!isString(ref.recordId) || ref.recordId.length === 0) {
          errors.push({
            code: 'invalid_sample_ref',
            field: `${prefix}.sampleRef.recordId`,
            message:
              'sampleRef.recordId is required and must be a non-empty string',
          })
        }
        if (!isString(ref.identifier)) {
          errors.push({
            code: 'invalid_sample_ref',
            field: `${prefix}.sampleRef.identifier`,
            message: 'sampleRef.identifier is required and must be a string',
          })
        }
        if (!isString(ref.title)) {
          errors.push({
            code: 'invalid_sample_ref',
            field: `${prefix}.sampleRef.title`,
            message: 'sampleRef.title is required and must be a string',
          })
        }
      }
    }

    // replicate
    if (well.replicate !== undefined && well.replicate !== null) {
      if (!isPositiveInteger(well.replicate)) {
        errors.push({
          code: 'invalid_replicate',
          field: `${prefix}.replicate`,
          message: 'replicate must be a positive integer',
        })
      }
    }

    // volume
    if (well.volume !== undefined && well.volume !== null) {
      const vol = well.volume
      if (!isObject(vol)) {
        errors.push({
          code: 'invalid_volume',
          field: `${prefix}.volume`,
          message: 'volume must be an object',
        })
      } else {
        if (!isPositiveFinite(vol.value)) {
          errors.push({
            code: 'invalid_volume',
            field: `${prefix}.volume.value`,
            message: 'volume.value must be a positive finite number',
          })
        }
        if (!isNonEmptyString(vol.unit)) {
          errors.push({
            code: 'invalid_volume',
            field: `${prefix}.volume.unit`,
            message: 'volume.unit is required and must be a non-empty string',
          })
        }
      }
    }

    // notes
    if (well.notes !== undefined && well.notes !== null) {
      if (!isString(well.notes)) {
        errors.push({
          code: 'invalid_value',
          field: `${prefix}.notes`,
          message: 'notes must be a string',
        })
      }
    }

    // Track assignments for duplicate detection
    if (isString(role) && isObject(sampleRef) && isString(sampleRef.recordId)) {
      const ref = sampleRef
      const repKey = well.replicate ?? 0
      const key = `${ref.recordId}:${role}:${repKey}`
      if (!assignmentMap.has(key)) {
        assignmentMap.set(key, [i])
      } else {
        assignmentMap.get(key)!.push(i)
      }
    }
  })

  // Duplicate assignment detection: same sample + role + replicate in multiple wells
  for (const [key, indices] of assignmentMap) {
    if (indices.length > 1) {
      errors.push({
        code: 'duplicate_assignment',
        field: `spec.wells`,
        message: `duplicate assignment (sample:role:replicate ${key}) at well indices ${indices.join(', ')}`,
      })
    }
  }

  // Required roles check
  if (isObject(validation)) {
    const requiredRoles = validation.requiredRoles
    if (Array.isArray(requiredRoles)) {
      const presentRoles = new Set(
        wells
          .filter((w: unknown): w is Record<string, unknown> => isObject(w))
          .map((w) => w.role)
          .filter((r): r is string => isString(r)),
      )
      for (const required of requiredRoles) {
        if (
          isString(required) &&
          ASSIGNMENT_ROLES.includes(required as AssignmentRole)
        ) {
          if (!presentRoles.has(required)) {
            errors.push({
              code: 'missing_required_role',
              field: 'spec.validation.requiredRoles',
              message: `required role "${required}" is not present on the plate`,
            })
          }
        }
      }
    }

    // Volume constraints
    const volMin = validation.volumeMin
    const volMax = validation.volumeMax
    if (volMin !== undefined && typeof volMin !== 'number') {
      errors.push({
        code: 'invalid_value',
        field: 'spec.validation.volumeMin',
        message: 'volumeMin must be a number',
      })
    }
    if (volMax !== undefined && typeof volMax !== 'number') {
      errors.push({
        code: 'invalid_value',
        field: 'spec.validation.volumeMax',
        message: 'volumeMax must be a number',
      })
    }
    if (
      typeof volMin === 'number' &&
      typeof volMax === 'number' &&
      volMin > volMax
    ) {
      errors.push({
        code: 'invalid_value',
        field: 'spec.validation',
        message: 'volumeMin must not exceed volumeMax',
      })
    }

    // Check volumes against constraints
    if (typeof volMin === 'number' || typeof volMax === 'number') {
      wells.forEach((well, i) => {
        if (!isObject(well)) return
        const vol = well.volume
        if (!isObject(vol) || typeof vol.value !== 'number') return
        if (typeof volMin === 'number' && vol.value < volMin) {
          errors.push({
            code: 'invalid_volume',
            field: `spec.wells[${i}].volume`,
            message: `volume ${vol.value} ${vol.unit ?? ''} is below minimum ${volMin}`,
          })
        }
        if (typeof volMax === 'number' && vol.value > volMax) {
          errors.push({
            code: 'invalid_volume',
            field: `spec.wells[${i}].volume`,
            message: `volume ${vol.value} ${vol.unit ?? ''} exceeds maximum ${volMax}`,
          })
        }
      })
    }
  }

  return errors
}

/**
 * Validate a `PlateMapBlockPayload`. An empty draft `{}` is valid. A
 * populated payload requires a non-empty title and a valid spec.
 */
export function validatePlateMapPayload(payload: unknown): PlateMapSpecError[] {
  if (!isObject(payload)) {
    return [{ code: 'invalid_shape', message: 'payload must be an object' }]
  }
  if (Object.keys(payload).length === 0) return []

  const errors: PlateMapSpecError[] = []

  // title
  if (!isNonEmptyString(payload.title)) {
    errors.push({
      code: 'missing_field',
      field: 'title',
      message: 'title is required and must be a non-empty string',
    })
  }

  // spec
  if (payload.spec === undefined || payload.spec === null) {
    errors.push({
      code: 'missing_field',
      field: 'spec',
      message: 'spec is required',
    })
  } else {
    errors.push(...validatePlateMapSpec(payload.spec))
  }

  // provenance (optional, must be string if present)
  if (payload.provenance !== undefined && payload.provenance !== null) {
    if (!isString(payload.provenance)) {
      errors.push({
        code: 'invalid_value',
        field: 'provenance',
        message: 'provenance must be a string',
      })
    }
  }

  return errors
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

/**
 * Convert a `PlateMapSpec` into the `PlateWell[]` shape the presentational
 * `PlateMap` component expects. Each well gets a label combining its well
 * code, role label, and sample identifier (if any).
 */
export function wellsToPlateWells(spec: PlateMapSpec): Array<{
  row: number
  col: number
  label: string
  role: AssignmentRole
  sampleRef?: SampleRef
  volume?: Volume
  replicate?: number
  notes?: string
}> {
  return spec.wells.map((w) => {
    const roleLabel = ROLE_STYLES[w.role].label
    const parts = [w.wellCode, roleLabel]
    if (w.sampleRef) {
      parts.push(w.sampleRef.identifier)
    }
    if (w.replicate) {
      parts.push(`rep ${w.replicate}`)
    }
    return {
      row: w.row,
      col: w.col,
      label: parts.join(' · '),
      role: w.role,
      sampleRef: w.sampleRef,
      volume: w.volume,
      replicate: w.replicate,
      notes: w.notes,
    }
  })
}

/**
 * Create a default 96-well plate spec with no well assignments.
 */
export function defaultPlateMapSpec(): PlateMapSpec {
  return {
    specVersion: PLATE_MAP_SPEC_VERSION,
    format: '96_well',
    rows: FORMAT_DIMENSIONS['96_well'].rows,
    cols: FORMAT_DIMENSIONS['96_well'].cols,
    wells: [],
    validation: {},
  }
}

// ---------------------------------------------------------------------------
// Well → record binding resolution
// ---------------------------------------------------------------------------

/**
 * A caller's live observation of one linked sample record, or undefined when
 * the caller renders without live reads (frozen/historical mode — the stored
 * `SampleRef` snapshot is the only evidence).
 */
export type LiveSampleObservation =
  | { status: 'loading' }
  | { status: 'found'; archivedAt: string | null }
  | { status: 'not_found' }
  | { status: 'restricted' }
  | { status: 'error' }

/**
 * Honest display state of a well's sample link. `missing` covers records that
 * are deleted or otherwise unresolvable; `restricted` covers reads the caller
 * is not permitted to see. Both stay distinct from `error` (the read itself
 * failed) and from `archived` (resolved, but the sample is archived).
 */
export type WellSampleState =
  | 'unassigned'
  | 'loading'
  | 'active'
  | 'archived'
  | 'missing'
  | 'restricted'
  | 'error'

export interface WellSampleResolution {
  state: WellSampleState
  recordId: string
  /** True when resolved from the stored snapshot only (no live read). */
  snapshotOnly: boolean
}

/**
 * Resolve a well's sample link to an honest display state. The well binds by
 * stable record ID (`sampleRef.recordId`); identifier/title are observed
 * display values and never identity. Returns null for unassigned wells.
 */
export function resolveWellSample(
  well: WellAssignment,
  live?: LiveSampleObservation,
): WellSampleResolution | null {
  const ref = well.sampleRef
  if (!ref) return null
  if (!live) {
    return {
      state: ref.archived ? 'archived' : 'active',
      recordId: ref.recordId,
      snapshotOnly: true,
    }
  }
  switch (live.status) {
    case 'loading':
      return { state: 'loading', recordId: ref.recordId, snapshotOnly: false }
    case 'found':
      return {
        state: live.archivedAt || ref.archived ? 'archived' : 'active',
        recordId: ref.recordId,
        snapshotOnly: false,
      }
    case 'not_found':
      return { state: 'missing', recordId: ref.recordId, snapshotOnly: false }
    case 'restricted':
      return {
        state: 'restricted',
        recordId: ref.recordId,
        snapshotOnly: false,
      }
    case 'error':
      return { state: 'error', recordId: ref.recordId, snapshotOnly: false }
  }
}

/**
 * Map a record query result to a live observation. A settled query with
 * `data: null` means the record did not resolve (deleted or filtered);
 * transport/permission failures surface as `error`. Callers that know a
 * failure is a 403/permission denial pass `restricted: true` explicitly.
 */
export function liveSampleObservationFromQuery(query: {
  data: { archivedAt: string | null } | null | undefined
  error: unknown
  isLoading: boolean
}): LiveSampleObservation {
  if (query.isLoading) return { status: 'loading' }
  if (query.error) {
    return isForbiddenError(query.error)
      ? { status: 'restricted' }
      : { status: 'error' }
  }
  if (!query.data) return { status: 'not_found' }
  return { status: 'found', archivedAt: query.data.archivedAt }
}

function isForbiddenError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const record = error as Record<string, unknown>
  if (record.status === 403 || record.statusCode === 403) return true
  const message =
    typeof record.message === 'string' ? record.message : String(error)
  return /403|forbidden|permission denied|not permitted|unauthorised|unauthorized/i.test(
    message,
  )
}

// ---------------------------------------------------------------------------
// Selection model
// ---------------------------------------------------------------------------

/**
 * Linked-record context for a selected well: the well's canonical code and
 * assignment plus the stable record identity when the well links a sample.
 * Clicking a well yields this context; renderers turn it into a record
 * summary with an open action built from the record ID (never the label).
 */
export interface WellSelectionContext {
  wellCode: string
  row: number
  col: number
  assigned: boolean
  well: WellAssignment | null
  sampleRef: SampleRef | null
  resolution: WellSampleResolution | null
}

/**
 * Build the selection context for a well code on a spec. Returns null when
 * the code is malformed or outside the spec dimensions.
 */
export function wellSelectionContext(
  spec: PlateMapSpec,
  code: string,
  live?: Map<string, LiveSampleObservation>,
): WellSelectionContext | null {
  if (!isValidWellCode(code, spec.rows, spec.cols)) return null
  const parsed = parseWellCode(code)
  if (!parsed) return null
  const well = spec.wells.find((w) => w.wellCode === code) ?? null
  const observation = well?.sampleRef
    ? live?.get(well.sampleRef.recordId)
    : undefined
  return {
    wellCode: code,
    row: parsed.row,
    col: parsed.col,
    assigned: well !== null,
    well,
    sampleRef: well?.sampleRef ?? null,
    resolution: well ? resolveWellSample(well, observation) : null,
  }
}
