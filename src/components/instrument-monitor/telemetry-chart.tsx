import type { InstrumentObservation } from '#/lib/instrument-monitor'

export interface TelemetryChartProps {
  observations: InstrumentObservation[]
}

interface Point {
  cycle: number
  fluorescence: number
}

const PALETTE = [
  '#2563eb',
  '#16a34a',
  '#dc2626',
  '#9333ea',
  '#ea580c',
  '#0891b2',
  '#db2777',
  '#65a30d',
]

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

export function TelemetryChart({ observations }: TelemetryChartProps) {
  const traces = tracesFrom(observations)
  if (traces.size === 0)
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        No telemetry data yet.
      </p>
    )

  const allPoints = [...traces.values()].flat()
  const minCycle = Math.min(...allPoints.map((point) => point.cycle))
  const maxCycle = Math.max(...allPoints.map((point) => point.cycle))
  const maxRfu = Math.max(1, ...allPoints.map((point) => point.fluorescence))
  const x = (cycle: number) =>
    45 + ((cycle - minCycle) / Math.max(1, maxCycle - minCycle)) * 325
  const y = (rfu: number) => 205 - (rfu / maxRfu) * 170

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox="0 0 400 250"
        role="img"
        aria-label="Amplification curves showing fluorescence by cycle"
        className="min-w-[400px] w-full"
      >
        <line
          x1="45"
          y1="205"
          x2="370"
          y2="205"
          stroke="currentColor"
          className="text-border"
        />
        <line
          x1="45"
          y1="35"
          x2="45"
          y2="205"
          stroke="currentColor"
          className="text-border"
        />
        <text
          x="207"
          y="238"
          textAnchor="middle"
          fontSize="11"
          fill="currentColor"
        >
          Cycle
        </text>
        <text
          x="14"
          y="120"
          textAnchor="middle"
          fontSize="11"
          fill="currentColor"
          transform="rotate(-90 14 120)"
        >
          RFU
        </text>
        <text
          x="42"
          y="220"
          textAnchor="middle"
          fontSize="9"
          fill="currentColor"
        >
          {minCycle}
        </text>
        <text
          x="370"
          y="220"
          textAnchor="middle"
          fontSize="9"
          fill="currentColor"
        >
          {maxCycle}
        </text>
        {[...traces].map(([well, points], index) => (
          <polyline
            key={well}
            points={points
              .map((point) => `${x(point.cycle)},${y(point.fluorescence)}`)
              .join(' ')}
            fill="none"
            stroke={PALETTE[index % PALETTE.length]}
            strokeWidth="2"
          />
        ))}
        {[...traces.keys()].map((well, index) => {
          const column = Math.floor(index / 8)
          const row = index % 8
          return (
            <g
              key={well}
              transform={`translate(${285 + column * 48} ${42 + row * 14})`}
            >
              <line
                x1="0"
                y1="0"
                x2="10"
                y2="0"
                stroke={PALETTE[index % PALETTE.length]}
                strokeWidth="2"
              />
              <text x="14" y="3" fontSize="8" fill="currentColor">
                {well}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
