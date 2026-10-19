import { InspectorSection } from '#/components/record'
import { Checkbox } from '#/components/v3/ui/checkbox'
import { Input } from '#/components/v3/ui/input'
import { Select } from '#/components/v3/ui/select'
import { Textarea } from '#/components/v3/inventory/list'
import { LEGEND_POSITIONS } from '#/lib/chart-spec'
import type { ChartSpec, LegendPosition } from '#/lib/chart-spec'
import {
  axisRangeProblem,
  legendShown,
  setAxisBound,
  setAxisTitle,
  setAxisUnit,
  setCaption,
  setLegendPosition,
  setLegendVisible,
} from '#/lib/figure-display'
import type { FigureAxis } from '#/lib/figure-display'

const LEGEND_LABELS: Record<LegendPosition, string> = {
  right: 'Right',
  bottom: 'Bottom',
  top: 'Top',
  hidden: 'Hidden',
}

/**
 * Publication figure controls for the chart inspector: the axis title, unit
 * and range, the legend and the caption. Blank fields fall back to the
 * defaults the chart already uses (the field's own label and unit, an
 * automatic range), so nothing here has to be filled in to get a figure.
 */
export function FigureControls({
  spec,
  onSpecChange,
}: {
  spec: ChartSpec
  onSpecChange: (spec: ChartSpec) => void
}) {
  return (
    <InspectorSection title="Publication figure">
      <div className="flex flex-col gap-3">
        {(['x', 'y'] as FigureAxis[]).map((axis) => {
          const problem = axisRangeProblem(spec, axis)
          const display = spec.display.axes[axis]
          const name = axis.toUpperCase()
          return (
            <fieldset
              key={axis}
              className="m-0 flex flex-col gap-1.5 border-0 p-0"
            >
              <legend className="pb-1 text-label font-medium">
                {name} axis
              </legend>
              <label className="flex flex-col gap-0.5 text-label text-fg-muted">
                {name}-axis title
                <Input
                  value={display.label ?? ''}
                  onChange={(e) =>
                    onSpecChange(setAxisTitle(spec, axis, e.target.value))
                  }
                />
              </label>
              <label className="flex flex-col gap-0.5 text-label text-fg-muted">
                {name}-axis unit
                <Input
                  value={display.unit ?? ''}
                  placeholder="e.g. mg/mL"
                  onChange={(e) =>
                    onSpecChange(setAxisUnit(spec, axis, e.target.value))
                  }
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-0.5 text-label text-fg-muted">
                  {name} minimum
                  <Input
                    inputMode="decimal"
                    value={display.min ?? ''}
                    placeholder="Auto"
                    aria-invalid={problem ? true : undefined}
                    onChange={(e) =>
                      onSpecChange(
                        setAxisBound(spec, axis, 'min', e.target.value),
                      )
                    }
                  />
                </label>
                <label className="flex flex-col gap-0.5 text-label text-fg-muted">
                  {name} maximum
                  <Input
                    inputMode="decimal"
                    value={display.max ?? ''}
                    placeholder="Auto"
                    aria-invalid={problem ? true : undefined}
                    onChange={(e) =>
                      onSpecChange(
                        setAxisBound(spec, axis, 'max', e.target.value),
                      )
                    }
                  />
                </label>
              </div>
              {problem ? (
                <p role="alert" className="m-0 text-label text-danger-text">
                  {problem}
                </p>
              ) : null}
            </fieldset>
          )
        })}
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend className="pb-1 text-label font-medium">Legend</legend>
          <label className="flex items-center gap-2 text-label">
            <Checkbox
              checked={legendShown(spec)}
              onCheckedChange={(on) => onSpecChange(setLegendVisible(spec, on))}
            />
            Show legend
          </label>
          <label className="flex flex-col gap-0.5 text-label text-fg-muted">
            Legend position
            <Select
              value={spec.display.legend?.position ?? 'right'}
              onChange={(e) =>
                onSpecChange(
                  setLegendPosition(spec, e.target.value as LegendPosition),
                )
              }
            >
              {LEGEND_POSITIONS.map((position) => (
                <option key={position} value={position}>
                  {LEGEND_LABELS[position]}
                </option>
              ))}
            </Select>
          </label>
        </fieldset>
        <label className="flex flex-col gap-0.5 text-label text-fg-muted">
          Caption
          <Textarea
            rows={3}
            value={spec.display.caption ?? ''}
            placeholder="Figure caption, shown under the chart"
            onChange={(e) => onSpecChange(setCaption(spec, e.target.value))}
          />
        </label>
      </div>
    </InspectorSection>
  )
}
