/**
 * OPS-006 — Amplification curves rendered through the shared ChartRenderer
 * (Recharts-based) instead of hand-rolled SVG. Maps qPCR telemetry
 * observations (RFU by cycle, one trace per well) into a MaterialisedChart
 * the renderer consumes.
 */
import { ChartRenderer } from '#/components/viz/chart-renderer'
import { CHART_PALETTE } from '#/lib/chart-spec'
import type { MaterialisedChart, MaterialisedSeries } from '#/lib/chart-spec'
import type { InstrumentObservation } from '#/lib/instrument-monitor'

export interface TelemetryChartProps {
  observations: InstrumentObservation[]
}

interface Point {
  cycle: number
  fluorescence: number
}

function tracesFrom(
  observations: InstrumentObservation[],
): Map<string, Point[]> {
  const traces = new Map<string, Point[]>()
  for (const observation of observations) {
    if (observation.observationType !== 'telemetry') continue
    const payload = observation.payload
    const cycle = Number(payload.cycle)
    if (!Number.isFinite(cycle)) continue
    const wells = payload.wells
    if (wells && typeof wells === 'object' && !Array.isArray(wells)) {
      for (const [well, value] of Object.entries(wells)) {
        const fluorescence =
          typeof value === 'number'
            ? value
            : value && typeof value === 'object'
              ? Number((value as Record<string, unknown>).fluorescence)
              : Number.NaN
        if (Number.isFinite(fluorescence))
          traces.set(well, [
            ...(traces.get(well) ?? []),
            { cycle, fluorescence },
          ])
      }
    }
    const readings = payload.readings
    if (Array.isArray(readings)) {
      for (const value of readings) {
        if (!value || typeof value !== 'object') continue
        const reading = value as Record<string, unknown>
        const well = String(reading.well ?? reading.wellCode ?? '')
        const fluorescence = Number(reading.fluorescence)
        if (well && Number.isFinite(fluorescence))
          traces.set(well, [
            ...(traces.get(well) ?? []),
            { cycle, fluorescence },
          ])
      }
    }
  }
  for (const points of traces.values()) points.sort((a, b) => a.cycle - b.cycle)
  return traces
}

function buildMaterialised(traces: Map<string, Point[]>): MaterialisedChart {
  const series: MaterialisedSeries[] = [...traces.entries()].map(
    ([well, points], index) => ({
      identifier: well,
      label: well,
      color: CHART_PALETTE[index % CHART_PALETTE.length],
      points: points.map((point) => ({
        x: point.cycle,
        y: point.fluorescence,
        yError: null,
        label: well,
      })),
    }),
  )
  return {
    state: { kind: 'ok' },
    columns: [],
    rows: [],
    series,
    xLabel: 'Cycle',
    yLabel: 'RFU',
    xUnit: undefined,
    yUnit: undefined,
  }
}

export function TelemetryChart({ observations }: TelemetryChartProps) {
  const traces = tracesFrom(observations)
  const materialised = buildMaterialised(traces)

  return (
    <ChartRenderer
      title="Amplification curves"
      subtitle="Fluorescence (RFU) by cycle, one trace per well"
      spec={null}
      materialised={materialised}
      frozen={null}
    />
  )
}
