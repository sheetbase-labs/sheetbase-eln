import QRCode from 'qrcode'
import type { ComponentProps } from 'react'

import { encodeCode128, isCode128Text } from '#/lib/barcode128'
import {
  DEFAULT_LABEL_TEMPLATE,
  buildLabelLines,
  isPluginItem,
  labelQrPayload,
} from '#/lib/labels'
import type { LabelSource, LabelTemplate } from '#/lib/labels'
import { cn } from '#/lib/utils'
import { GhsPictogram } from '#/components/materials/ghs-pictogram'
import type { GhsPictogram as GhsCode } from '#/lib/material-safety'

import { computeSampleHold, formatHoldDateShort } from './sample-hold-meter'
import { usePluginLabel } from './plugin-label'
import type { PluginLabel } from './plugin-label'
import { t } from '#/copy'

/**
 * LAB-05.1 — the sample inspector's label preview (SampleDetail / SampleLineage /
 * SampleUsage).
 *
 * The code is a real, scannable QR of the DEC-10 payload
 * `https://<host>/r/<identifier>`, so a printed label resolves through the resolver
 * route. It replaced a fixed decorative pattern that could not be scanned.
 *
 * The lines are the identifier, the lot (`batch` custom field) and the storage
 * condition with the hold use-by date (LAB-02). A line is omitted when the sample does
 * not carry the fact rather than being fabricated. Without a host there is no honest
 * payload to encode, so the card says so instead of drawing a code that would resolve
 * nowhere.
 */
export interface SampleLabelRecord {
  identifier: string
  title?: string | null
  sampleType?: string | null
  barcode?: string | null
  createdAt?: string
  properties?: Record<string, unknown> | null
  customFields?: Record<string, unknown> | null
}

function batchOf(record: SampleLabelRecord): string | null {
  const batch = record.customFields?.batch

  return typeof batch === 'string' && batch.trim() !== '' ? batch : null
}

/** The QR modules as one SVG path; synchronous, so the card needs no effect. */
function qrPath(payload: string): { d: string; size: number } {
  const qr = QRCode.create(payload, { errorCorrectionLevel: 'M' })
  const size = qr.modules.size
  const data = qr.modules.data
  let d = ''

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (data[y * size + x]) d += `M${x} ${y}h1v1h-1z`
    }
  }

  return { d, size }
}

/** CSS pixels in a millimetre: what a label measures on a 96 dpi screen. */
const PX_PER_MM = 96 / 25.4

/** The parts of a label template that decide how a label looks. */
export type LabelLook = Partial<
  Pick<
    LabelTemplate,
    | 'showCondition'
    | 'showUseBy'
    | 'showLot'
    | 'showSampleType'
    | 'widthMm'
    | 'heightMm'
    | 'barcodeType'
    | 'layout'
  >
>

/** A plugin's bars (a string of 1s and 0s) as one SVG path. */
function modulesPath(bits: string): { d: string; modules: number } {
  let d = ''

  for (let i = 0; i < bits.length; i += 1) {
    if (bits[i] === '1') d += `M${i} 0h1v1h-1z`
  }

  return { d, modules: bits.length }
}

/** A plugin's grid (rows of 1s and 0s) as one SVG path. */
function gridPath(rows: readonly string[]): { d: string; size: number } {
  let d = ''
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] === '1') d += `M${x} ${y}h1v1h-1z`
    }
  })

  return { d, size: Math.max(rows.length, rows[0]?.length ?? 0) }
}

/** The Code 128 bars as one SVG path, one module wide each. */
function barcodePath(text: string): { d: string; modules: number } | null {
  if (!isCode128Text(text)) return null
  const bits = encodeCode128(text)
  let d = ''

  for (let i = 0; i < bits.length; i += 1) {
    if (bits[i] === '1') d += `M${i} 0h1v1h-1z`
  }

  return { d, modules: bits.length }
}

function LabelCardView({
  record,
  host,
  template,
  fit = 'natural',
  hazards,
  facts,
  fromPlugin,
}: {
  facts: LabelSource
  fromPlugin: PluginLabel
  record: SampleLabelRecord
  /**
   * The facts the label states, for a record that is not a sample (a material
   * lot). Without it the lines come from the sample's custom fields and hold.
   */
  source?: Omit<LabelSource, 'identifier'>
  /** Hazard pictograms the label carries (a chemical's GHS pictograms). */
  hazards?: readonly GhsCode[]
  /** The host a scanned code resolves against; defaults to the current origin. */
  host?: string
  /** What the label carries and how it is sized; the default template when omitted. */
  template?: LabelLook
  /**
   * `natural` sizes the card to its content, `mm` to the template's real size
   * (for printing), and a number draws it at that many pixels per millimetre.
   */
  fit?: 'natural' | 'mm' | number
}) {
  const look = { ...DEFAULT_LABEL_TEMPLATE, ...template }

  const resolvedHost =
    host ?? (typeof window !== 'undefined' ? window.location.host : '')

  const lines: Array<{ kind: string; text: string; bold?: boolean }> =
    fromPlugin.lines.data
      ? fromPlugin.lines.data.map((line, index) => ({
          kind: `plugin-${index}`,
          text: line.text,
          bold: line.bold,
        }))
      : buildLabelLines(facts, look)

  const payload = resolvedHost
    ? labelQrPayload(resolvedHost, record.identifier)
    : null

  const pluginCode = fromPlugin.code.data
  const pluginCodePending = isPluginItem(look.barcodeType) && !pluginCode

  const isBarcode =
    look.barcodeType === 'code128' || pluginCode?.kind === 'bars'

  const plain = !isPluginItem(look.barcodeType)

  const code =
    plain && !isBarcode && payload
      ? qrPath(payload)
      : pluginCode?.kind === 'grid'
        ? gridPath(pluginCode.rows)
        : null

  const bars =
    pluginCode?.kind === 'bars'
      ? modulesPath(pluginCode.modules)
      : plain && isBarcode
        ? barcodePath(record.identifier.trim())
        : null

  // Pixels per millimetre when the card is drawn to a real or scaled size.
  const ppm = fit === 'mm' ? PX_PER_MM : typeof fit === 'number' ? fit : null

  const style =
    fit === 'mm'
      ? { width: `${look.widthMm}mm`, height: `${look.heightMm}mm` }
      : ppm
        ? { width: look.widthMm * ppm, height: look.heightMm * ppm }
        : undefined

  const sized = ppm !== null
  const pad = sized ? 5 : 10

  // A small label shrinks its code to fit rather than clipping it.
  const codePx = ppm
    ? Math.max(16, Math.min(56, Math.round(look.heightMm * ppm - 2 * pad)))
    : 56

  const barsPx = ppm
    ? Math.max(12, Math.min(40, Math.round(look.heightMm * ppm * 0.36)))
    : 36

  const lineBlock = (
    <div
      className={cn(
        'mono min-w-0',
        sized ? 'text-[10px] leading-[13px]' : 'text-[11px] leading-4',
      )}
    >
      {lines.map((line) => (
        <div
          key={line.kind}
          className={cn(
            sized && 'truncate',
            (line.kind === 'signal' || line.bold) && 'font-bold',
          )}
        >
          {line.text}
        </div>
      ))}
      {fromPlugin.lines.problem ? (
        <div role="status" className="text-fg-muted">
          {fromPlugin.lines.problem}
        </div>
      ) : null}
    </div>
  )

  // Pictograms stack beside the lines on a roomy label and sit in a row under the
  // bars on a barcode label; they shrink with a small label rather than clip.
  const pictogramPx = ppm
    ? Math.max(
        12,
        Math.min(28, Math.round((look.heightMm * ppm - 2 * pad) / 2)),
      )
    : 28

  const hazardBlock =
    hazards && hazards.length > 0 ? (
      <div
        data-slot="label-hazards"
        className="flex shrink-0 flex-wrap content-center items-center justify-end gap-0.5"
        style={isBarcode ? undefined : { width: pictogramPx * 2 + 2 }}
      >
        {hazards.map((pictogram) => (
          <GhsPictogram key={pictogram} code={pictogram} size={pictogramPx} />
        ))}
      </div>
    ) : null

  return (
    <div
      data-slot="sample-label"
      role="group"
      aria-label={t('library.samples.sampleLabelCard.printableLabelFor', {
        identifier: record.identifier,
      })}
      style={{ ...style, padding: pad }}
      className={
        isBarcode
          ? 'box-border flex flex-col justify-center gap-1 overflow-hidden rounded-sm border border-border'
          : hazardBlock
            ? 'box-border grid grid-cols-[auto_1fr_auto] items-center gap-2.5 overflow-hidden rounded-sm border border-border'
            : 'box-border grid grid-cols-[auto_1fr] items-center gap-2.5 overflow-hidden rounded-sm border border-border'
      }
    >
      {bars ? (
        <svg
          className="w-full"
          style={{ height: barsPx }}
          viewBox={`0 0 ${bars.modules} 1`}
          preserveAspectRatio="none"
          role="img"
          aria-label={t('library.samples.sampleLabelCard.ariaLabel', {
            identifier: record.identifier,
          })}
          shapeRendering="crispEdges"
        >
          <path d={bars.d} fill="currentColor" />
        </svg>
      ) : isBarcode ? (
        <span
          className="flex items-center justify-center border border-dashed border-border-strong text-[9px] leading-3 text-fg-muted"
          role="status"
          style={{ height: barsPx }}
        >
          {t('library.samples.sampleLabelCard.noBarcode')}
        </span>
      ) : code && (payload || pluginCode) ? (
        <svg
          className="shrink-0"
          width={codePx}
          height={codePx}
          viewBox={`0 0 ${code.size} ${code.size}`}
          role="img"
          aria-label={
            pluginCode
              ? t('library.samples.sampleLabelCard.ariaLabel', {
                  identifier: record.identifier,
                })
              : t('library.samples.sampleLabelCard.labelCodeResolvingTo', {
                  payload: payload ?? '',
                })
          }
          shapeRendering="crispEdges"
        >
          <path d={code.d} fill="currentColor" />
        </svg>
      ) : (
        <span
          className="flex shrink-0 items-center justify-center border border-dashed border-border-strong text-[9px] leading-3 text-fg-muted"
          role="status"
          style={{ width: codePx, height: codePx }}
          title={fromPlugin.code.problem}
        >
          {pluginCodePending
            ? fromPlugin.code.problem
              ? t('plugins.labels.codeUnavailable', {
                  reason: fromPlugin.code.problem,
                })
              : '…'
            : t('library.samples.sampleLabelCard.noCode')}
        </span>
      )}
      {lineBlock}
      {hazardBlock}
    </div>
  )
}

/** What a label states about a record, when the caller hasn't said (a sample's lot and hold). */
function labelFacts(
  record: SampleLabelRecord,
  source: Omit<LabelSource, 'identifier'> | undefined,
): LabelSource {
  if (source) return { identifier: record.identifier, ...source }

  const hold = computeSampleHold({
    createdAt: record.createdAt ?? new Date().toISOString(),
    properties: record.properties,
    customFields: record.customFields,
  })

  return {
    identifier: record.identifier,
    sampleType: record.sampleType,
    lot: batchOf(record),
    condition: hold?.condition ?? null,
    useBy: hold ? formatHoldDateShort(hold.expiry) : null,
  }
}

type CardProps = Omit<
  ComponentProps<typeof LabelCardView>,
  'facts' | 'fromPlugin'
>

const NO_PLUGIN: PluginLabel = {
  lines: { loading: false },
  code: { loading: false },
}

/** Asks the plugins for a layout and a code; only mounted when the template names one. */
function PluginLabelCard(props: CardProps & { facts: LabelSource }) {
  const look = { ...DEFAULT_LABEL_TEMPLATE, ...props.template }

  const fromPlugin = usePluginLabel({
    layout: look.layout,
    barcodeType: look.barcodeType,
    recordKind: props.source ? 'material' : 'sample',
    identifier: props.record.identifier.trim(),
    record: { ...props.record, facts: props.facts },
    widthMm: look.widthMm,
    heightMm: look.heightMm,
  })

  return <LabelCardView {...props} fromPlugin={fromPlugin} />
}

export function SampleLabelCard(props: CardProps) {
  const facts = labelFacts(props.record, props.source)

  // A plugin may lay the label out and draw its code; both arrive as data. Most
  // labels use neither, and those never wait on (or need) the plugin lookup.
  if (
    isPluginItem(props.template?.layout) ||
    isPluginItem(props.template?.barcodeType)
  )
    return <PluginLabelCard {...props} facts={facts} />

  return <LabelCardView {...props} facts={facts} fromPlugin={NO_PLUGIN} />
}
