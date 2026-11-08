import { cellDisplayModel } from '#/lib/extensions/cell-display'
import type { CellDisplaySpec } from '#/lib/extensions/cell-display'
import { sanitizeSvg } from '#/lib/extensions/screens'
import { cn } from '#/lib/utils'
import { TONE_CLASSES, TONE_FILL, TONE_STROKE } from './tone'

function Sparkline({
  values,
  tone,
}: {
  values: number[]
  tone: keyof typeof TONE_STROKE
}) {
  const min = Math.min(...values)
  const span = Math.max(...values) - min || 1
  const w = 64
  const h = 16
  const points = values
    .map(
      (v, i) =>
        `${((i / (values.length - 1)) * (w - 2) + 1).toFixed(1)},${(h - 1 - ((v - min) / span) * (h - 2)).toFixed(1)}`,
    )
    .join(' ')
  return (
    <svg
      role="img"
      aria-label={values.join(', ')}
      viewBox={`0 0 ${w} ${h}`}
      className="h-4 w-16 shrink-0"
    >
      <polyline
        points={points}
        fill="none"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        className={TONE_STROKE[tone]}
      />
    </svg>
  )
}

/**
 * Draws a declared cell display. A display is data from a plugin's manifest; this
 * is the only code that runs in a cell.
 */
export function CellDisplayView({
  spec,
  value,
}: {
  spec: CellDisplaySpec
  value: unknown
}) {
  const model = cellDisplayModel(spec, value)
  switch (model.kind) {
    case 'empty':
      return <span className="text-fg-faint">—</span>
    case 'text':
      return (
        <span className={cn('block truncate', model.mono && 'font-mono')}>
          {model.text}
        </span>
      )
    case 'badge':
      return (
        <span
          data-slot="plugin-badge"
          className={cn(
            'inline-flex items-center whitespace-nowrap rounded-sm px-1.5 py-px text-[11px] font-medium',
            TONE_CLASSES[model.tone],
          )}
        >
          {model.text}
        </span>
      )
    case 'bar':
      return (
        <span
          role="meter"
          aria-valuenow={Math.round(model.fraction * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={model.label ?? undefined}
          className="flex items-center gap-2"
        >
          <span className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-skeleton">
            <span
              className={cn('block h-full rounded-full', TONE_FILL[model.tone])}
              style={{ width: `${model.fraction * 100}%` }}
            />
          </span>
          {model.label ? (
            <span className="tabular-nums">{model.label}</span>
          ) : null}
        </span>
      )
    case 'sparkline':
      return <Sparkline values={model.values} tone={model.tone} />
    case 'svg': {
      const clean = sanitizeSvg(model.svg)
      return clean ? (
        <span
          className="inline-block h-5 [&>svg]:h-full [&>svg]:w-auto"
          dangerouslySetInnerHTML={{ __html: clean }}
        />
      ) : (
        <span className="text-fg-faint">—</span>
      )
    }
  }
}
