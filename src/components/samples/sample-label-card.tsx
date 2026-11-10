import type { ComponentProps } from 'react'

import {
  DEFAULT_LABEL_TEMPLATE,
  buildLabelLines,
  isPluginItem,
} from '#/lib/labels'
import type { LabelSource } from '#/lib/labels'
import { cn } from '#/lib/utils'
import { GhsPictogram } from '#/components/materials/ghs-pictogram'
import type { GhsPictogram as GhsCode } from '#/lib/material-safety'

import {
  labelCodeDrawing,
  labelDimensions,
  labelFacts,
} from './label-card-data'
import type { LabelLook, SampleLabelRecord } from './label-card-data'
import { usePluginLabel } from './plugin-label'
import type { PluginLabel } from './plugin-label'
import { t } from '#/copy'

export type { LabelLook, SampleLabelRecord } from './label-card-data'

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
function LabelCode({
  record,
  host,
  barcodeType,
  fromPlugin,
  codePx,
  barsPx,
}: {
  record: SampleLabelRecord
  host: string
  barcodeType: string
  fromPlugin: PluginLabel
  codePx: number
  barsPx: number
}) {
  const pluginCode = fromPlugin.code.data

  const { payload, pluginCodePending, isBarcode, code, bars } =
    labelCodeDrawing({
      host,
      identifier: record.identifier,
      barcodeType,
      pluginCode,
    })

  if (bars)
    return (
      <svg
        className="w-full"
        style={{ height: barsPx }}
        viewBox={`0 0 ${bars.modules} 1`}
        preserveAspectRatio="none"
        role="img"
        aria-label={t('library.samples.sampleLabelCard.ariaLabel', {
          identifier: record.identifier,
        })}
        // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- Native React SVG attribute preserves crisp barcode edges; it cannot be renamed.
        shapeRendering="crispEdges"
      >
        <path d={bars.d} fill="currentColor" />
      </svg>
    )

  if (isBarcode)
    return (
      <span
        className="flex items-center justify-center border border-dashed border-border-strong text-[9px] leading-3 text-fg-muted"
        role="status"
        style={{ height: barsPx }}
      >
        {t('library.samples.sampleLabelCard.noBarcode')}
      </span>
    )

  if (code && (payload || pluginCode))
    return (
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
        // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- Native React SVG attribute preserves crisp QR modules; it cannot be renamed.
        shapeRendering="crispEdges"
      >
        <path d={code.d} fill="currentColor" />
      </svg>
    )

  return (
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
  )
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

  const isBarcode =
    look.barcodeType === 'code128' || fromPlugin.code.data?.kind === 'bars'

  const { style, sized, pad, codePx, barsPx, pictogramPx } = labelDimensions(
    look,
    fit,
  )

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
      <LabelCode
        record={record}
        host={resolvedHost}
        barcodeType={look.barcodeType}
        fromPlugin={fromPlugin}
        codePx={codePx}
        barsPx={barsPx}
      />
      {lineBlock}
      {hazardBlock}
    </div>
  )
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
