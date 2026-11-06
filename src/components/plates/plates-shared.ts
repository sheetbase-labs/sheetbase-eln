/**
 * Small helpers shared by the Plates screens: how a verdict reads, how numbers
 * are shown, and how an analysed plate becomes a coloured plate map.
 */
import type {
  PlateMapBand,
  PlateMapRoleLegendEntry,
  PlateWell,
} from '#/components/viz/plate-map'
import type { Tone } from '#/components/ui/status'
import { t } from '#/copy'
import type {
  AssayWell,
  PlateAnalysis,
  PlateReadout,
  QcStatus,
} from '#/lib/plate-assay'
import { allWellCodes } from '#/lib/plate-assay'
import { FORMAT_DIMENSIONS, ROLE_STYLES, parseWellCode } from '#/lib/plate-map'
import type { AssignmentRole, PlateFormat } from '#/lib/plate-map'
import type { PlateRunRow } from '#/lib/plate-runs'

export type MapView = 'normalised' | 'raw' | 'hits' | 'roles'

export function qcTone(status: QcStatus | null): Tone {
  switch (status) {
    case 'pass':
      return 'ok'
    case 'warn':
      return 'warn'
    case 'fail':
      return 'bad'
    default:
      return 'draft'
  }
}

export function qualityLabel(run: Pick<PlateRunRow, 'status' | 'qc_status'>) {
  if (run.status === 'draft' || run.qc_status === null)
    return t('plates.quality.draft')
  return t(`plates.quality.${run.qc_status}`)
}

/** A number for a table: a few significant figures, never a long tail. */
export function fmt(value: number | null | undefined, digits = 3): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return ''
  if (value === 0) return '0'
  const abs = Math.abs(value)
  if (abs >= 1e5 || abs < 1e-3)
    return value.toExponential(Math.max(digits - 1, 1))
  return Number(value.toPrecision(digits)).toString()
}

export function runText(run: PlateRunRow): string {
  return `plr-${String(run.number).padStart(4, '0')} ${run.name}`.toLowerCase()
}

const CONTROL_FADED: Record<AssignmentRole, string> = {
  sample: 'bg-info/20',
  positive_control: 'bg-success/40',
  negative_control: 'bg-warning/40',
  blank: 'bg-muted',
  empty: 'bg-muted/60',
}

const HEAT: string[] = [
  'bg-info/10',
  'bg-info/25',
  'bg-info/40',
  'bg-info/60',
  'bg-info/80',
  'bg-primary',
]

/** Six bands across 0–1, which the map reads from values scaled to that range. */
export function heatBands(): PlateMapBand[] {
  return HEAT.map((className, i) => ({
    from: i / HEAT.length,
    to: (i + 1) / HEAT.length + (i === HEAT.length - 1 ? 0.0001 : 0),
    label: '',
    className,
  }))
}

export interface MapModel {
  wells: PlateWell[]
  rows: number
  cols: number
  bands: PlateMapBand[]
  legend: PlateMapRoleLegendEntry[]
  range: { min: number; max: number } | null
}

/**
 * Colour the plate by one of four views. Numeric views scale the values to
 * 0–1 across the plate so any readout fills the colour range; the hit view
 * and the layout view colour by meaning instead.
 */
export function mapModel(
  format: PlateFormat,
  wells: AssayWell[],
  readout: PlateReadout,
  analysis: PlateAnalysis | null,
  view: MapView,
): MapModel {
  const dims = FORMAT_DIMENSIONS[format]
  const byCode = new Map(wells.map((w) => [w.wellCode, w]))
  const results = new Map((analysis?.wells ?? []).map((w) => [w.wellCode, w]))
  const effective: MapView =
    view === 'normalised' && !analysis
      ? 'raw'
      : view === 'hits' && !analysis
        ? 'roles'
        : view
  const numeric = (code: string): number | null => {
    if (effective === 'normalised') return results.get(code)?.normalised ?? null
    return readout[code] ?? null
  }
  let min = Infinity
  let max = -Infinity
  if (effective === 'normalised' || effective === 'raw') {
    for (const code of allWellCodes(format)) {
      const v = numeric(code)
      if (v === null || !Number.isFinite(v)) continue
      min = Math.min(min, v)
      max = Math.max(max, v)
    }
  }
  const range = min <= max ? { min, max } : null
  const out: PlateWell[] = []
  for (const code of allWellCodes(format)) {
    const pos = parseWellCode(code)
    if (!pos) continue
    const well = byCode.get(code)
    const base: PlateWell = {
      row: pos.row,
      col: pos.col,
      wellCode: code,
      label: code,
    }
    if (effective === 'roles') {
      out.push({
        ...base,
        roleClass: well ? ROLE_STYLES[well.role].cellClass : 'bg-muted/60',
        label: well
          ? `${code} · ${ROLE_STYLES[well.role].label}${well.sampleLabel ? ` · ${well.sampleLabel}` : ''}`
          : code,
      })
    } else if (effective === 'hits') {
      const r = results.get(code)
      const sample = r?.role === 'sample'
      out.push({
        ...base,
        roleClass: !r
          ? 'bg-muted/60'
          : !sample
            ? CONTROL_FADED[r.role]
            : r.hit
              ? 'bg-danger'
              : 'bg-info/20',
        label: `${code}${r?.hit ? ` · ${t('plates.run.hit')}` : ''}`,
      })
    } else {
      const v = numeric(code)
      const scaled =
        v === null || !range
          ? null
          : range.max === range.min
            ? 0.5
            : (v - range.min) / (range.max - range.min)
      out.push({
        ...base,
        value: scaled,
        label:
          v === null
            ? code
            : t('plates.run.wellTitle', { well: code, value: fmt(v, 4) }),
      })
    }
  }
  return {
    wells: out,
    rows: dims.rows,
    cols: dims.cols,
    bands: heatBands(),
    legend:
      effective === 'roles'
        ? (Object.keys(ROLE_STYLES) as AssignmentRole[]).map((role) => ({
            label: ROLE_STYLES[role].label,
            className: ROLE_STYLES[role].cellClass,
          }))
        : effective === 'hits'
          ? [
              { label: t('plates.run.hit'), className: 'bg-danger' },
              { label: t('plates.run.notHit'), className: 'bg-info/20' },
            ]
          : [
              {
                label: `${t('plates.run.legendLow')}${range ? ` ${fmt(range.min, 3)}` : ''}`,
                className: HEAT[0],
              },
              {
                label: `${t('plates.run.legendHigh')}${range ? ` ${fmt(range.max, 3)}` : ''}`,
                className: HEAT[HEAT.length - 1],
              },
            ],
    range,
  }
}
