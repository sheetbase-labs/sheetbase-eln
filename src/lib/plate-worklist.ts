/**
 * Liquid-handler worklists: turn a plate layout into a list of transfers,
 * write that list in the formats the common robots read (Opentrons, Tecan
 * GWL, Hamilton, Echo, plain CSV), and read the robot's log back to see what
 * was actually moved.
 *
 * Pure and deterministic. A worklist that cannot be built safely (a source
 * well asked for more than it holds, more samples than source wells) says so
 * in `issues` rather than being trimmed quietly.
 */

import { FORMAT_DIMENSIONS, parseWellCode, wellCode } from './plate-map'
import type { PlateFormat } from './plate-map'

export const WORKLIST_FORMATS = [
  'csv',
  'echo',
  'tecan_gwl',
  'hamilton',
  'opentrons',
] as const
export type WorklistFormat = (typeof WORKLIST_FORMATS)[number]

export const WORKLIST_MODES = ['stamp', 'cherry_pick'] as const
export type WorklistMode = (typeof WORKLIST_MODES)[number]

/** One destination well to be filled. */
export interface DestinationWell {
  wellCode: string
  /** What goes in: a sample record id, or null for a named reagent. */
  sampleId?: string | null
  /** Name of what goes in (sample identifier, or e.g. "DMSO"). */
  label: string
  /** Volume to transfer into this well, in µL. */
  volumeUl: number | null
}

export interface Transfer {
  sourcePlate: string
  sourceWell: string
  destPlate: string
  destWell: string
  volumeUl: number
  label: string
  sampleId: string | null
}

export interface WorklistIssue {
  code:
    | 'no_volume'
    | 'source_overdraw'
    | 'source_plate_full'
    | 'bad_well'
    | 'volume_too_small'
    | 'volume_too_large'
  wellCode?: string
  message: string
}

export interface WorklistPlan {
  transfers: Transfer[]
  /** Source well → the thing it must hold and how much is drawn from it. */
  sources: Array<{
    well: string
    label: string
    sampleId: string | null
    totalUl: number
    transfers: number
  }>
  issues: WorklistIssue[]
}

export interface BuildOptions {
  mode: WorklistMode
  sourcePlate: string
  sourceFormat: PlateFormat
  /** Destination plate format; defaults to the source format. */
  destFormat?: PlateFormat
  destPlate: string
  /** Used for destination wells that have no volume of their own. */
  defaultVolumeUl?: number
  /** Working volume of one source well; a warning is raised past it. */
  sourceWellVolumeUl?: number
  /** Smallest and largest volume the instrument can move. */
  minVolumeUl?: number
  maxVolumeUl?: number
  /** Order transfers by source well (default) or destination well. */
  order?: 'source' | 'destination'
}

function columnMajorIndex(code: string, rows: number): number {
  const p = parseWellCode(code)
  return p ? p.col * rows + p.row : Number.MAX_SAFE_INTEGER
}

/** Plan the transfers for a set of destination wells. */
export function buildWorklist(
  destinations: DestinationWell[],
  options: BuildOptions,
): WorklistPlan {
  const issues: WorklistIssue[] = []
  const { rows, cols } = FORMAT_DIMENSIONS[options.sourceFormat]
  const capacity = rows * cols
  const sourceByKey = new Map<string, string>()
  let nextSource = 0
  const transfers: Transfer[] = []
  const sourceInfo = new Map<
    string,
    {
      label: string
      sampleId: string | null
      totalUl: number
      transfers: number
    }
  >()

  const destRows =
    FORMAT_DIMENSIONS[options.destFormat ?? options.sourceFormat].rows
  const ordered = [...destinations].sort(
    (a, b) =>
      columnMajorIndex(a.wellCode, destRows) -
      columnMajorIndex(b.wellCode, destRows),
  )

  for (const d of ordered) {
    if (!parseWellCode(d.wellCode)) {
      issues.push({
        code: 'bad_well',
        wellCode: d.wellCode,
        message: d.wellCode,
      })
      continue
    }
    const volume = d.volumeUl ?? options.defaultVolumeUl ?? null
    if (volume === null || !(volume > 0)) {
      issues.push({
        code: 'no_volume',
        wellCode: d.wellCode,
        message: d.wellCode,
      })
      continue
    }
    if (options.minVolumeUl !== undefined && volume < options.minVolumeUl)
      issues.push({
        code: 'volume_too_small',
        wellCode: d.wellCode,
        message: d.wellCode,
      })
    if (options.maxVolumeUl !== undefined && volume > options.maxVolumeUl)
      issues.push({
        code: 'volume_too_large',
        wellCode: d.wellCode,
        message: d.wellCode,
      })

    let source: string
    if (options.mode === 'stamp') {
      source = d.wellCode
      const p = parseWellCode(source)
      if (!p || p.row >= rows || p.col >= cols) {
        issues.push({
          code: 'bad_well',
          wellCode: d.wellCode,
          message: d.wellCode,
        })
        continue
      }
    } else {
      const key = d.sampleId ?? `label:${d.label}`
      const existing = sourceByKey.get(key)
      if (existing) source = existing
      else {
        if (nextSource >= capacity) {
          issues.push({
            code: 'source_plate_full',
            wellCode: d.wellCode,
            message: d.label,
          })
          continue
        }
        const row = nextSource % rows
        const col = Math.floor(nextSource / rows)
        source = wellCode(row, col)
        nextSource++
        sourceByKey.set(key, source)
      }
    }

    transfers.push({
      sourcePlate: options.sourcePlate,
      sourceWell: source,
      destPlate: options.destPlate,
      destWell: d.wellCode,
      volumeUl: volume,
      label: d.label,
      sampleId: d.sampleId ?? null,
    })
    const info = sourceInfo.get(source) ?? {
      label: d.label,
      sampleId: d.sampleId ?? null,
      totalUl: 0,
      transfers: 0,
    }
    info.totalUl += volume
    info.transfers += 1
    sourceInfo.set(source, info)
  }

  if (options.order === 'destination') {
    transfers.sort(
      (a, b) =>
        columnMajorIndex(a.destWell, destRows) -
        columnMajorIndex(b.destWell, destRows),
    )
  } else {
    transfers.sort(
      (a, b) =>
        columnMajorIndex(a.sourceWell, rows) -
          columnMajorIndex(b.sourceWell, rows) ||
        columnMajorIndex(a.destWell, rows) - columnMajorIndex(b.destWell, rows),
    )
  }

  const sources = [...sourceInfo.entries()]
    .map(([well, info]) => ({ well, ...info }))
    .sort(
      (a, b) => columnMajorIndex(a.well, rows) - columnMajorIndex(b.well, rows),
    )
  if (options.sourceWellVolumeUl !== undefined) {
    for (const s of sources)
      if (s.totalUl > options.sourceWellVolumeUl)
        issues.push({
          code: 'source_overdraw',
          wellCode: s.well,
          message: `${s.well}: ${round(s.totalUl)} µL asked, ${options.sourceWellVolumeUl} µL held`,
        })
  }
  return { transfers, sources, issues }
}

function round(v: number, places = 3): number {
  const f = 10 ** places
  return Math.round(v * f) / f
}

/** Well position counted down columns (Tecan, Hamilton), starting at 1. */
export function wellPosition(code: string, rows: number): number {
  const p = parseWellCode(code)
  return p ? p.col * rows + p.row + 1 : 0
}

// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------

export interface WriteOptions {
  sourceFormat: PlateFormat
  destFormat: PlateFormat
  /** Tecan: liquid class and labware type names. */
  liquidClass?: string
  tecanSourceType?: string
  tecanDestType?: string
  /** Echo: plate type name, e.g. "384PP_AQ_BP". */
  echoSourceType?: string
  /** Opentrons: labware load names and pipette. */
  opentronsSourceLabware?: string
  opentronsDestLabware?: string
  opentronsPipette?: string
  opentronsTiprack?: string
  opentronsMount?: 'left' | 'right'
}

function csvCell(value: string | number): string {
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function csvLine(cells: Array<string | number>): string {
  return cells.map(csvCell).join(',')
}

export function toCsv(transfers: Transfer[]): string {
  return [
    csvLine([
      'source_plate',
      'source_well',
      'dest_plate',
      'dest_well',
      'volume_ul',
      'sample',
    ]),
    ...transfers.map((t) =>
      csvLine([
        t.sourcePlate,
        t.sourceWell,
        t.destPlate,
        t.destWell,
        round(t.volumeUl),
        t.label,
      ]),
    ),
  ].join('\n')
}

/** Echo cherry-pick list; volumes are in nL. */
export function toEchoCsv(
  transfers: Transfer[],
  options: WriteOptions,
): string {
  const type = options.echoSourceType ?? '384PP_AQ_BP'
  return [
    csvLine([
      'Source Plate Name',
      'Source Plate Barcode',
      'Source Plate Type',
      'Source Well',
      'Destination Plate Name',
      'Destination Plate Barcode',
      'Destination Well',
      'Transfer Volume',
    ]),
    ...transfers.map((t) =>
      csvLine([
        t.sourcePlate,
        t.sourcePlate,
        type,
        t.sourceWell,
        t.destPlate,
        t.destPlate,
        t.destWell,
        round(t.volumeUl * 1000, 1),
      ]),
    ),
  ].join('\n')
}

/**
 * Tecan Gemini worklist (.gwl): an aspirate (A) and dispense (D) per
 * transfer, with a tip wash (W) after each. Volumes in µL.
 */
export function toTecanGwl(
  transfers: Transfer[],
  options: WriteOptions,
): string {
  const sRows = FORMAT_DIMENSIONS[options.sourceFormat].rows
  const dRows = FORMAT_DIMENSIONS[options.destFormat].rows
  const liquid = options.liquidClass ?? 'Water'
  const sType = options.tecanSourceType ?? ''
  const dType = options.tecanDestType ?? ''
  const lines: string[] = []
  for (const t of transfers) {
    const v = round(t.volumeUl, 2)
    lines.push(
      `A;${t.sourcePlate};;${sType};${wellPosition(t.sourceWell, sRows)};;${v};${liquid};;;`,
    )
    lines.push(
      `D;${t.destPlate};;${dType};${wellPosition(t.destWell, dRows)};;${v};${liquid};;;`,
    )
    lines.push('W;')
  }
  return lines.join('\n')
}

/** Hamilton transfer list: one row per transfer, positions counted down columns. */
export function toHamiltonCsv(
  transfers: Transfer[],
  options: WriteOptions,
): string {
  const sRows = FORMAT_DIMENSIONS[options.sourceFormat].rows
  const dRows = FORMAT_DIMENSIONS[options.destFormat].rows
  return [
    csvLine([
      'SourceLabware',
      'SourceWell',
      'SourcePosition',
      'DestinationLabware',
      'DestinationWell',
      'DestinationPosition',
      'Volume',
    ]),
    ...transfers.map((t) =>
      csvLine([
        t.sourcePlate,
        t.sourceWell,
        wellPosition(t.sourceWell, sRows),
        t.destPlate,
        t.destWell,
        wellPosition(t.destWell, dRows),
        round(t.volumeUl, 2),
      ]),
    ),
  ].join('\n')
}

/** An OT-2 Python protocol (API 2.15) that runs the transfer list. */
export function toOpentronsProtocol(
  transfers: Transfer[],
  options: WriteOptions & { title?: string },
): string {
  const src = options.opentronsSourceLabware ?? 'nest_96_wellplate_200ul_flat'
  const dst = options.opentronsDestLabware ?? 'corning_384_wellplate_112ul_flat'
  const pipette = options.opentronsPipette ?? 'p300_single_gen2'
  const tips = options.opentronsTiprack ?? 'opentrons_96_tiprack_300ul'
  const mount = options.opentronsMount ?? 'left'
  const rows = transfers
    .map(
      (t) =>
        `    (${JSON.stringify(t.sourceWell)}, ${JSON.stringify(t.destWell)}, ${round(t.volumeUl, 2)}),`,
    )
    .join('\n')
  const title = (options.title ?? 'Sheetbase worklist').replace(/["\\\n]/g, ' ')
  return `from opentrons import protocol_api

metadata = {"protocolName": "${title}", "apiLevel": "2.15"}

# source well, destination well, volume in µL
TRANSFERS = [
${rows}
]


def run(protocol: protocol_api.ProtocolContext):
    source = protocol.load_labware("${src}", 1)
    dest = protocol.load_labware("${dst}", 2)
    tips = [protocol.load_labware("${tips}", 3)]
    pipette = protocol.load_instrument("${pipette}", "${mount}", tip_racks=tips)
    for source_well, dest_well, volume in TRANSFERS:
        pipette.transfer(volume, source[source_well], dest[dest_well], new_tip="always")
`
}

export const WORKLIST_FILE_EXTENSION: Record<WorklistFormat, string> = {
  csv: 'csv',
  echo: 'csv',
  tecan_gwl: 'gwl',
  hamilton: 'csv',
  opentrons: 'py',
}

/** Write a plan in one of the supported formats. */
export function writeWorklist(
  format: WorklistFormat,
  transfers: Transfer[],
  options: WriteOptions & { title?: string },
): string {
  switch (format) {
    case 'csv':
      return toCsv(transfers)
    case 'echo':
      return toEchoCsv(transfers, options)
    case 'tecan_gwl':
      return toTecanGwl(transfers, options)
    case 'hamilton':
      return toHamiltonCsv(transfers, options)
    case 'opentrons':
      return toOpentronsProtocol(transfers, options)
  }
}

// ---------------------------------------------------------------------------
// Reading the robot's log back
// ---------------------------------------------------------------------------

export type TransferStatus = 'done' | 'short' | 'failed' | 'skipped' | 'missing'

export interface LogEntry {
  sourceWell: string
  destWell: string
  /** Volume actually moved, in µL; null when the log does not say. */
  actualUl: number | null
  status: 'ok' | 'failed' | 'skipped'
}

export interface ReconciledTransfer extends Transfer {
  status: TransferStatus
  /** What was really moved, in µL. */
  movedUl: number
}

function cells(line: string, delimiter: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"'
        i++
      } else quoted = !quoted
    } else if (ch === delimiter && !quoted) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  out.push(cur.trim())
  return out
}

function wellOf(cell: string | undefined): string | null {
  if (!cell) return null
  const m = /^([A-Za-z]+)\s*0*([1-9][0-9]*)$/.exec(cell.trim())
  return m ? `${m[1].toUpperCase()}${m[2]}` : null
}

export interface ParsedRunLog {
  entries: LogEntry[]
  /** Unit the volumes were in; converted to µL on the way in. */
  warnings: string[]
}

/**
 * Read a transfer log. Understands the headings the worklist CSV, an Echo
 * transfer report and most robots' exports use: source and destination well,
 * an actual/transferred volume, and a status or exception column. `unit`
 * says what the volume column is in; Echo reports are in nL.
 */
export function parseRunLog(
  text: string,
  options: { volumeUnit?: 'ul' | 'nl' | 'ml' } = {},
): ParsedRunLog {
  const warnings: string[] = []
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length === 0) return { entries: [], warnings: ['empty'] }
  const delimiter = lines[0].includes('\t') ? '\t' : ','
  const head = cells(lines[0], delimiter).map((h) =>
    h.toLowerCase().replace(/[\s_-]+/g, ''),
  )
  const find = (...names: string[]) => head.findIndex((h) => names.includes(h))
  const srcCol = find('sourcewell', 'source', 'srcwell', 'from')
  const dstCol = find(
    'destinationwell',
    'destwell',
    'dest',
    'destination',
    'dstwell',
    'to',
  )
  const volCol = find(
    'actualvolume',
    'transferredvolume',
    'volumetransferred',
    'actualul',
    'volume',
    'transfervolume',
    'volumeul',
  )
  const statCol = find(
    'status',
    'transferstatus',
    'result',
    'exception',
    'outcome',
  )
  if (srcCol < 0 || dstCol < 0)
    return { entries: [], warnings: ['no_well_columns'] }
  const factor =
    options.volumeUnit === 'nl' ? 0.001 : options.volumeUnit === 'ml' ? 1000 : 1
  const entries: LogEntry[] = []
  for (const line of lines.slice(1)) {
    const c = cells(line, delimiter)
    const sourceWell = wellOf(c[srcCol])
    const destWell = wellOf(c[dstCol])
    if (!sourceWell || !destWell) {
      warnings.push(`bad_row:${line.slice(0, 40)}`)
      continue
    }
    const raw = volCol >= 0 ? Number(c[volCol]) : Number.NaN
    const status = statCol >= 0 ? (c[statCol] ?? '').toLowerCase() : ''
    let s: LogEntry['status'] = 'ok'
    if (/fail|error|abort|miss|not\s*transferred|^x$/.test(status)) s = 'failed'
    else if (/skip|omit|cancel/.test(status)) s = 'skipped'
    entries.push({
      sourceWell,
      destWell,
      actualUl: Number.isFinite(raw) ? raw * factor : null,
      status: s,
    })
  }
  return { entries, warnings }
}

/**
 * Match a log to the planned transfers by source and destination well. A
 * transfer with no log line is "missing"; one that moved under 95% of what
 * was asked is "short".
 */
export function reconcileRunLog(
  planned: Transfer[],
  entries: LogEntry[],
): ReconciledTransfer[] {
  const pool = new Map<string, LogEntry[]>()
  for (const e of entries) {
    const key = `${e.sourceWell}>${e.destWell}`
    pool.set(key, [...(pool.get(key) ?? []), e])
  }
  return planned.map((t) => {
    const list = pool.get(`${t.sourceWell}>${t.destWell}`)
    const entry = list?.shift()
    if (!entry) return { ...t, status: 'missing' as const, movedUl: 0 }
    if (entry.status === 'failed')
      return { ...t, status: 'failed' as const, movedUl: 0 }
    if (entry.status === 'skipped')
      return { ...t, status: 'skipped' as const, movedUl: 0 }
    const moved = entry.actualUl ?? t.volumeUl
    return {
      ...t,
      status:
        moved < t.volumeUl * 0.95 ? ('short' as const) : ('done' as const),
      movedUl: moved,
    }
  })
}

/** Total moved out of each source sample, for recording withdrawals. */
export function withdrawalsFrom(
  reconciled: ReconciledTransfer[],
): Array<{ sampleId: string; label: string; totalUl: number }> {
  const totals = new Map<string, { label: string; totalUl: number }>()
  for (const t of reconciled) {
    if (!t.sampleId || t.movedUl <= 0) continue
    const cur = totals.get(t.sampleId) ?? { label: t.label, totalUl: 0 }
    cur.totalUl += t.movedUl
    totals.set(t.sampleId, cur)
  }
  return [...totals.entries()].map(([sampleId, v]) => ({
    sampleId,
    label: v.label,
    totalUl: round(v.totalUl),
  }))
}
