/**
 * OPS-003 — Plate Designer domain model and persistence boundary.
 *
 * Provides deterministic layout generation, validation, CSV preview helpers,
 * undo history, wire mappers, and typed wrappers around the plate RPCs.
 */

import type { DataClient } from './data-client'
import { DataClientError } from './data-client'
import {
  ASSIGNMENT_ROLES,
  FORMAT_DIMENSIONS,
  PLATE_MAP_SPEC_VERSION,
  isValidWellCode,
  parseWellCode,
  validatePlateMapSpec,
  wellCode,
} from './plate-map'
import type {
  AssignmentRole,
  PlateFormat,
  PlateMapSpec,
  PlateValidationConfig,
  SampleRef,
  Volume,
  WellAssignment,
} from './plate-map'

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface PlateDesignDoc {
  id: string | null
  workspaceId: string
  projectId: string | null
  name: string
  format: PlateFormat
  rows: number
  cols: number
  wells: PlateWellAssignment[]
  validation: PlateValidationConfig
  status: 'draft' | 'finalized' | 'archived'
  metadataVersion: number
  createdAt: string
  updatedAt: string
}

export interface PlateWellAssignment extends WellAssignment {
  concentrationValue?: number
  concentrationUnit?: string
  sampleRecordId?: string
}

export type FillDirection =
  'row' | 'column' | 'serpentine' | 'column_serpentine'

export interface AutoFillOptions {
  samples: SampleRef[]
  replicates: number
  fillDirection: FillDirection
  startWell: string
  controls: ControlPlacement[]
  randomize: boolean
  seed: number
  volume?: Volume
  concentration?: { value: number; unit: string }
}

export interface ControlPlacement {
  role: AssignmentRole
  wellCode: string
  volume?: Volume
}

// ---------------------------------------------------------------------------
// Deterministic automatic filling
// ---------------------------------------------------------------------------

/** Mulberry32's compact, deterministic 32-bit pseudo-random generator. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function shuffleWithSeed<T>(arr: T[], seed: number): T[] {
  const result = [...arr]
  const random = mulberry32(seed)
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export function generateWellOrder(
  rows: number,
  cols: number,
  direction: FillDirection,
  startWell: string,
): Array<{ row: number; col: number; wellCode: string }> {
  const order: Array<{ row: number; col: number; wellCode: string }> = []
  if (!isValidWellCode(startWell, rows, cols)) return order
  if (direction === 'row' || direction === 'serpentine') {
    for (let row = 0; row < rows; row += 1) {
      for (let step = 0; step < cols; step += 1) {
        const col =
          direction === 'serpentine' && row % 2 === 1 ? cols - step - 1 : step
        order.push({ row, col, wellCode: wellCode(row, col) })
      }
    }
  } else {
    for (let col = 0; col < cols; col += 1) {
      for (let step = 0; step < rows; step += 1) {
        const row =
          direction === 'column_serpentine' && col % 2 === 1
            ? rows - step - 1
            : step
        order.push({ row, col, wellCode: wellCode(row, col) })
      }
    }
  }
  const start = order.findIndex((well) => well.wellCode === startWell)
  return start < 0 ? [] : order.slice(start)
}

export function autoFillPlate(
  rows: number,
  cols: number,
  options: AutoFillOptions,
): PlateWellAssignment[] {
  const assignments: PlateWellAssignment[] = []
  const occupied = new Set<string>()
  for (const control of options.controls) {
    const position = parseWellCode(control.wellCode)
    if (
      !position ||
      !isValidWellCode(control.wellCode, rows, cols) ||
      occupied.has(control.wellCode)
    )
      continue
    occupied.add(control.wellCode)
    assignments.push({
      ...position,
      wellCode: control.wellCode,
      role: control.role,
      ...(control.volume ? { volume: { ...control.volume } } : {}),
    })
  }

  if (!Number.isInteger(options.replicates) || options.replicates < 1)
    return assignments
  const available = generateWellOrder(
    rows,
    cols,
    options.fillDirection,
    options.startWell,
  ).filter((well) => !occupied.has(well.wellCode))
  const samples = options.randomize
    ? shuffleWithSeed(options.samples, options.seed)
    : [...options.samples]
  let index = 0
  for (const sample of samples) {
    for (let replicate = 1; replicate <= options.replicates; replicate += 1) {
      if (index >= available.length) return assignments
      const position = available[index++]
      assignments.push({
        ...position,
        role: 'sample',
        sampleRef: { ...sample },
        sampleRecordId: sample.recordId,
        replicate,
        ...(options.volume ? { volume: { ...options.volume } } : {}),
        ...(options.concentration
          ? {
              concentrationValue: options.concentration.value,
              concentrationUnit: options.concentration.unit,
            }
          : {}),
      })
    }
  }
  return assignments
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface PlateDesignValidationError {
  code: string
  field?: string
  message: string
  wellCode?: string
}

export function validatePlateDesign(
  doc: PlateDesignDoc,
): PlateDesignValidationError[] {
  const base: PlateDesignValidationError[] = validatePlateMapSpec({
    specVersion: PLATE_MAP_SPEC_VERSION,
    format: doc.format,
    rows: doc.rows,
    cols: doc.cols,
    wells: doc.wells,
    validation: doc.validation,
  }).map((error) => ({ ...error }))

  doc.wells.forEach((well, index) => {
    const field = `wells[${index}]`
    if (well.role === 'sample' && !well.sampleRef) {
      base.push({
        code: 'missing_sample_ref',
        field: `${field}.sampleRef`,
        wellCode: well.wellCode,
        message: 'Sample wells must reference a sample record.',
      })
    }
    if (
      well.concentrationValue !== undefined &&
      (!Number.isFinite(well.concentrationValue) || well.concentrationValue < 0)
    ) {
      base.push({
        code: 'invalid_concentration',
        field: `${field}.concentrationValue`,
        wellCode: well.wellCode,
        message: 'Concentration must be a non-negative finite number.',
      })
    }
  })
  return base
}

// ---------------------------------------------------------------------------
// Undo history
// ---------------------------------------------------------------------------

export class UndoStack<T> {
  private history: T[] = []
  private state: T

  constructor(initial: T) {
    this.state = initial
  }

  push(state: T): void {
    this.history.push(this.state)
    this.state = state
  }

  undo(): T | null {
    const previous = this.history.pop()
    if (previous === undefined) return null
    this.state = previous
    return previous
  }

  canUndo(): boolean {
    return this.history.length > 0
  }

  reset(state: T): void {
    this.history = []
    this.state = state
  }

  get current(): T {
    return this.state
  }
}

// ---------------------------------------------------------------------------
// CSV import and preview
// ---------------------------------------------------------------------------

export interface CsvImportRow {
  wellCode: string
  role: string
  sampleIdentifier: string
  replicate: string
  volumeValue: string
  volumeUnit: string
  concentrationValue: string
  concentrationUnit: string
  notes: string
}

export interface CsvImportMapping {
  wellCode: string
  role: string
  sampleIdentifier: string
  replicate: string
  volumeValue: string
  volumeUnit: string
  concentrationValue: string
  concentrationUnit: string
  notes: string
}

export interface CsvImportPreview {
  rows: CsvImportRow[]
  errors: PlateDesignValidationError[]
  mapping: CsvImportMapping
  detectedColumns: string[]
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"'
        i += 1
      } else if (char === '"') quoted = false
      else field += char
    } else if (char === '"' && field.length === 0) quoted = true
    else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += char
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

const CSV_ALIASES: Record<keyof CsvImportMapping, string[]> = {
  wellCode: ['well', 'wellcode'],
  role: ['role'],
  sampleIdentifier: ['sample', 'identifier', 'sampleidentifier'],
  replicate: ['rep', 'replicate'],
  volumeValue: ['volume', 'vol', 'volumevalue'],
  volumeUnit: ['unit', 'volunit', 'volumeunit'],
  concentrationValue: ['conc', 'concentration', 'concentrationvalue'],
  concentrationUnit: ['concunit', 'concentrationunit'],
  notes: ['notes'],
}

export function previewCsvImport(
  text: string,
  rows: number,
  cols: number,
): CsvImportPreview {
  const parsed = parseCsv(text)
  const detectedColumns = parsed[0]?.map((header) => header.trim()) ?? []
  const mapping = {} as CsvImportMapping
  for (const key of Object.keys(CSV_ALIASES) as Array<keyof CsvImportMapping>) {
    const index = detectedColumns.findIndex((header) =>
      CSV_ALIASES[key].includes(header.toLowerCase().replace(/[\s_-]/g, '')),
    )
    mapping[key] = index >= 0 ? detectedColumns[index] : ''
  }
  const columnIndex = (key: keyof CsvImportMapping) =>
    mapping[key] ? detectedColumns.indexOf(mapping[key]) : -1
  const imported = parsed
    .slice(1)
    .filter((values) => values.some((value) => value.trim()))
    .map((values) => {
      const value = (key: keyof CsvImportMapping) =>
        values[columnIndex(key)]?.trim() ?? ''
      return {
        wellCode: value('wellCode').toUpperCase(),
        role: value('role').toLowerCase(),
        sampleIdentifier: value('sampleIdentifier'),
        replicate: value('replicate'),
        volumeValue: value('volumeValue'),
        volumeUnit: value('volumeUnit'),
        concentrationValue: value('concentrationValue'),
        concentrationUnit: value('concentrationUnit'),
        notes: value('notes'),
      }
    })
  const errors: PlateDesignValidationError[] = []
  imported.forEach((row, index) => {
    const field = `rows[${index}]`
    if (!isValidWellCode(row.wellCode, rows, cols))
      errors.push({
        code: 'invalid_well_code',
        field: `${field}.wellCode`,
        wellCode: row.wellCode,
        message: `Invalid or out-of-bounds well code "${row.wellCode}".`,
      })
    if (!ASSIGNMENT_ROLES.includes(row.role as AssignmentRole))
      errors.push({
        code: 'unsupported_role',
        field: `${field}.role`,
        wellCode: row.wellCode,
        message: `Invalid role "${row.role}".`,
      })
    if (
      row.replicate &&
      (!Number.isInteger(Number(row.replicate)) || Number(row.replicate) < 1)
    )
      errors.push({
        code: 'invalid_replicate',
        field: `${field}.replicate`,
        wellCode: row.wellCode,
        message: 'Replicate must be a positive integer.',
      })
    for (const key of ['volumeValue', 'concentrationValue'] as const) {
      if (row[key] && !Number.isFinite(Number(row[key])))
        errors.push({
          code: `invalid_${key === 'volumeValue' ? 'volume' : 'concentration'}`,
          field: `${field}.${key}`,
          wellCode: row.wellCode,
          message: `${key === 'volumeValue' ? 'Volume' : 'Concentration'} must be numeric.`,
        })
    }
  })
  return { rows: imported, errors, mapping, detectedColumns }
}

// ---------------------------------------------------------------------------
// PostgREST wire shapes and persistence
// ---------------------------------------------------------------------------

export interface PlateDesignWire {
  id: string
  workspace_id: string
  project_id: string | null
  name: string
  format: PlateFormat
  rows: number
  cols: number
  validation: PlateValidationConfig | null
  status: 'draft' | 'finalized' | 'archived'
  metadata_version: number
  created_by_user_id: string
  updated_by_user_id: string
  created_at: string
  updated_at: string
}

export interface PlateWellWire {
  id: string
  workspace_id: string
  design_id: string
  well_code: string
  row_index: number
  col_index: number
  role: AssignmentRole
  sample_record_id: string | null
  sample_identifier: string | null
  sample_title: string | null
  replicate: number | null
  volume_value: number | null
  volume_unit: string | null
  concentration_value: number | null
  concentration_unit: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface PlateLayoutTemplateWire {
  id: string
  workspace_id: string
  name: string
  description: string | null
  format: PlateFormat
  rows: number
  cols: number
  layout: Record<string, unknown>
  status: 'active' | 'archived'
  created_by_user_id: string
  created_at: string
  updated_at: string
}

export function toPlateWellAssignment(
  well: PlateWellWire,
): PlateWellAssignment {
  const sampleRef = well.sample_record_id
    ? {
        recordId: well.sample_record_id,
        identifier: well.sample_identifier ?? '',
        title: well.sample_title ?? '',
      }
    : undefined
  return {
    wellCode: well.well_code,
    row: well.row_index,
    col: well.col_index,
    role: well.role,
    ...(sampleRef ? { sampleRef, sampleRecordId: well.sample_record_id! } : {}),
    ...(well.replicate != null ? { replicate: well.replicate } : {}),
    ...(well.volume_value != null && well.volume_unit != null
      ? { volume: { value: well.volume_value, unit: well.volume_unit } }
      : {}),
    ...(well.concentration_value != null
      ? { concentrationValue: well.concentration_value }
      : {}),
    ...(well.concentration_unit != null
      ? { concentrationUnit: well.concentration_unit }
      : {}),
    ...(well.notes != null ? { notes: well.notes } : {}),
  }
}

export function toPlateDesignDoc(
  design: PlateDesignWire,
  wells: PlateWellWire[],
): PlateDesignDoc {
  return {
    id: design.id,
    workspaceId: design.workspace_id,
    projectId: design.project_id,
    name: design.name,
    format: design.format,
    rows: design.rows,
    cols: design.cols,
    wells: wells.map(toPlateWellAssignment),
    validation: design.validation ?? {},
    status: design.status,
    metadataVersion: design.metadata_version,
    createdAt: design.created_at,
    updatedAt: design.updated_at,
  }
}

export const plateDesignerQueryKeys = {
  list: (workspaceId: string) =>
    ['ops-003', 'plate-designs', 'list', workspaceId] as const,
  detail: (designId: string) =>
    ['ops-003', 'plate-designs', 'detail', designId] as const,
  wells: (designId: string) => ['ops-003', 'plate-wells', designId] as const,
  templates: (workspaceId: string) =>
    ['ops-003', 'templates', workspaceId] as const,
}

export async function fetchPlateDesigns(
  client: DataClient,
  workspaceId: string,
): Promise<PlateDesignDoc[]> {
  const designs = await client.list<PlateDesignWire>(
    'plate_designs',
    `?workspace_id=eq.${encodeURIComponent(workspaceId)}&order=updated_at.desc`,
  )
  return Promise.all(
    designs.map(async (design) =>
      toPlateDesignDoc(
        design,
        await client.list<PlateWellWire>(
          'plate_wells',
          `?design_id=eq.${encodeURIComponent(design.id)}&order=row_index,col_index`,
        ),
      ),
    ),
  )
}

export async function fetchPlateDesign(
  client: DataClient,
  designId: string,
): Promise<PlateDesignDoc | null> {
  const designs = await client.list<PlateDesignWire>(
    'plate_designs',
    `?id=eq.${encodeURIComponent(designId)}&limit=1`,
  )
  if (!designs[0]) return null
  const wells = await client.list<PlateWellWire>(
    'plate_wells',
    `?design_id=eq.${encodeURIComponent(designId)}&order=row_index,col_index`,
  )
  return toPlateDesignDoc(designs[0], wells)
}

export async function fetchPlateWells(
  client: DataClient,
  designId: string,
): Promise<PlateWellAssignment[]> {
  const wells = await client.list<PlateWellWire>(
    'plate_wells',
    `?design_id=eq.${encodeURIComponent(designId)}&order=row_index,col_index`,
  )
  return wells.map(toPlateWellAssignment)
}

export async function fetchPlateLayoutTemplates(
  client: DataClient,
  workspaceId: string,
): Promise<PlateLayoutTemplateWire[]> {
  return client.list(
    'plate_layout_templates',
    `?workspace_id=eq.${encodeURIComponent(workspaceId)}&order=name`,
  )
}

export interface CreatePlateDesignInput {
  workspaceId: string
  name: string
  projectId?: string
  format?: PlateFormat
  rows?: number
  cols?: number
  validation?: PlateValidationConfig
}

export async function createPlateDesign(
  client: DataClient,
  input: CreatePlateDesignInput,
): Promise<PlateDesignWire> {
  const format = input.format ?? '96_well'
  const dimensions = FORMAT_DIMENSIONS[format]
  return client.rpc('create_plate_design', {
    p_workspace_id: input.workspaceId,
    p_name: input.name,
    p_project_id: input.projectId ?? null,
    p_format: format,
    p_rows: input.rows ?? dimensions.rows,
    p_cols: input.cols ?? dimensions.cols,
    p_validation: input.validation ?? {},
  })
}

export async function savePlateDesign(
  client: DataClient,
  input: {
    designId: string
    wells: PlateWellAssignment[]
    validation?: PlateValidationConfig
    expectedMetadataVersion: number
  },
): Promise<PlateDesignWire> {
  const serializedWells = input.wells.map((well) => ({
    wellCode: well.wellCode,
    row: well.row,
    col: well.col,
    role: well.role,
    sampleRecordId: well.sampleRecordId ?? well.sampleRef?.recordId ?? null,
    sampleIdentifier: well.sampleRef?.identifier ?? null,
    sampleTitle: well.sampleRef?.title ?? null,
    replicate: well.replicate ?? null,
    volumeValue: well.volume?.value ?? null,
    volumeUnit: well.volume?.unit ?? null,
    concentrationValue: well.concentrationValue ?? null,
    concentrationUnit: well.concentrationUnit ?? null,
    notes: well.notes ?? null,
  }))
  return client.rpc('save_plate_design', {
    p_design_id: input.designId,
    p_wells: serializedWells,
    p_validation: input.validation ?? null,
    p_expected_metadata_version: input.expectedMetadataVersion,
  })
}

export async function archivePlateDesign(
  client: DataClient,
  input: { designId: string; expectedMetadataVersion: number },
): Promise<PlateDesignWire> {
  return client.rpc('archive_plate_design', {
    p_design_id: input.designId,
    p_expected_metadata_version: input.expectedMetadataVersion,
  })
}

export async function savePlateLayoutTemplate(
  client: DataClient,
  input: {
    workspaceId: string
    name: string
    description?: string
    format?: PlateFormat
    rows?: number
    cols?: number
    layout?: Record<string, unknown>
    templateId?: string
  },
): Promise<PlateLayoutTemplateWire> {
  const format = input.format ?? '96_well'
  const dimensions = FORMAT_DIMENSIONS[format]
  return client.rpc('save_plate_layout_template', {
    p_workspace_id: input.workspaceId,
    p_name: input.name,
    p_description: input.description ?? null,
    p_format: format,
    p_rows: input.rows ?? dimensions.rows,
    p_cols: input.cols ?? dimensions.cols,
    p_layout: input.layout ?? {},
    p_template_id: input.templateId ?? null,
  })
}

export function describePlateDesignerError(error: unknown): string {
  if (!(error instanceof DataClientError))
    return 'Could not complete the plate designer operation. Try again.'
  const messages: Record<string, string> = {
    SB001:
      'This plate design was edited by someone else. Refresh and try again.',
    SB015: 'The plate design was not found.',
    SB016: 'The selected item belongs to a different workspace.',
    SB017: 'A well is outside the plate bounds.',
    SB018: 'The layout contains a duplicate well.',
    SB019: 'The layout contains an invalid well role.',
    SB009: 'The linked record is not a sample.',
    SB004: 'Archived plate designs cannot be changed.',
    SB005: 'The plate design input is invalid.',
    '42501': 'You do not have access to this plate design.',
  }
  return messages[error.code] ?? error.message
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export function defaultPlateDesignDoc(workspaceId: string): PlateDesignDoc {
  const now = new Date().toISOString()
  const dimensions = FORMAT_DIMENSIONS['96_well']
  return {
    id: null,
    workspaceId,
    projectId: null,
    name: '',
    format: '96_well',
    rows: dimensions.rows,
    cols: dimensions.cols,
    wells: [],
    validation: {},
    status: 'draft',
    metadataVersion: 1,
    createdAt: now,
    updatedAt: now,
  }
}

// ---------------------------------------------------------------------------
// Canonical PlateMapSpec bridge (VIEW-02)
// ---------------------------------------------------------------------------

/**
 * Presentation-only well annotation: a visual flag on the designer surface
 * that is never written back as scientific state. Annotations live on the
 * view state below, never on `PlateDesignDoc` or `PlateMapSpec`.
 */
export interface PlateWellAnnotation {
  wellCode: string
  kind: 'flag' | 'note' | 'highlight'
  text?: string
}

/**
 * Designer view state: the canonical draft plus presentation-only surface
 * state (annotations, selection). Only `doc` serialises — `annotations` and
 * `selectedWellCode` never reach the spec, the database, or evidence.
 */
export interface PlateDesignerViewState {
  doc: PlateDesignDoc
  annotations: PlateWellAnnotation[]
  selectedWellCode: string | null
}

export function emptyDesignerViewState(
  doc: PlateDesignDoc,
): PlateDesignerViewState {
  return { doc, annotations: [], selectedWellCode: null }
}

/**
 * Strip designer-local well fields to the canonical `WellAssignment`. The
 * designer tracks `concentrationValue`/`concentrationUnit` (planning aid with
 * no canonical home on the spec) and a redundant `sampleRecordId` mirror of
 * `sampleRef.recordId`; neither is scientific state on the plate map and both
 * are excluded so the result validates via the canonical validators.
 */
export function designerWellToWellAssignment(
  well: PlateWellAssignment,
): WellAssignment {
  const assignment: WellAssignment = {
    wellCode: well.wellCode,
    row: well.row,
    col: well.col,
    role: well.role,
  }
  if (well.sampleRef) assignment.sampleRef = { ...well.sampleRef }
  if (well.replicate !== undefined) assignment.replicate = well.replicate
  if (well.volume) assignment.volume = { ...well.volume }
  if (well.notes !== undefined) assignment.notes = well.notes
  return assignment
}

/**
 * Serialise a designer draft to the canonical `PlateMapSpec`. The designer
 * operates on this spec shape: round-tripping through
 * `validatePlateMapSpec` must yield no errors for a valid draft.
 * Presentation-only view state (annotations, selection) never serialises —
 * use this function, not a manual pick, so exclusions stay in one place.
 */
export function plateDesignDocToSpec(doc: PlateDesignDoc): PlateMapSpec {
  return {
    specVersion: PLATE_MAP_SPEC_VERSION,
    format: doc.format,
    rows: doc.rows,
    cols: doc.cols,
    wells: doc.wells.map(designerWellToWellAssignment),
    validation: { ...doc.validation },
  }
}

/**
 * Serialise designer view state to the canonical spec. Identical to
 * `plateDesignDocToSpec(state.doc)` — annotations and selection are
 * presentation-only and never written back as scientific state.
 */
export function designerViewStateToSpec(
  state: PlateDesignerViewState,
): PlateMapSpec {
  return plateDesignDocToSpec(state.doc)
}
