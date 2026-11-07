/**
 * A Sanger trace: the four dye channels along the read, with the called bases
 * underneath and the quality of each as a bar. Scroll along the read, and jump
 * to a difference.
 */
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { Spinner } from '#/components/ui/spinner'
import { t } from '#/copy'
import { parseAbif } from '#/lib/molbio'
import type { Trace } from '#/lib/molbio'
import { cn } from '#/lib/utils'

export function useTraceFile(fileRecordId: string | undefined) {
  return useQuery({
    queryKey: ['ui-port', 'trace-file', fileRecordId],
    enabled: Boolean(fileRecordId),
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<Trace> => {
      const res = await fetch(`/api/files/${fileRecordId}/download`)
      if (!res.ok)
        throw new Error(`The trace could not be opened (${res.status}).`)
      return parseAbif(await res.arrayBuffer())
    },
  })
}

const COLOURS = {
  A: 'var(--trace-a)',
  C: 'var(--trace-c)',
  G: 'var(--trace-g)',
  T: 'var(--trace-t)',
} as const

const WINDOW = 60

export function Chromatogram({
  fileRecordId,
  /** Base to centre on (0-based index in the read as the instrument called it). */
  focus,
  /** The read was reverse-complemented to match the construct. */
  flipped,
  className,
}: {
  fileRecordId: string | undefined
  focus?: number | null
  flipped?: boolean
  className?: string
}) {
  const trace = useTraceFile(fileRecordId)
  if (!fileRecordId) return null
  if (trace.isPending)
    return (
      <p className="flex items-center gap-2 text-label text-fg-muted">
        <Spinner size={14} />
        {t('molbio.reads.loadingTrace')}
      </p>
    )
  if (trace.isError)
    return (
      <p role="alert" className="text-label text-danger">
        {trace.error.message}
      </p>
    )
  return (
    <TraceView
      trace={trace.data}
      focus={focus ?? null}
      flipped={flipped}
      className={className}
    />
  )
}

function TraceView({
  trace,
  focus,
  flipped,
  className,
}: {
  trace: Trace
  focus: number | null
  flipped?: boolean
  className?: string
}) {
  const n = trace.bases.length
  const [start, setStart] = useState(() =>
    Math.max(0, Math.min(n - WINDOW, (focus ?? 0) - WINDOW / 2)),
  )
  const from = Math.max(0, Math.min(Math.max(0, n - WINDOW), start))
  const to = Math.min(n, from + WINDOW)
  const x0 = trace.peaks[from] ?? 0
  const x1 = trace.peaks[to - 1] ?? x0 + 1
  const pad = 14
  const lo = Math.max(0, x0 - pad)
  const hi = x1 + pad
  const W = 1000
  const H = 190
  const top = 8
  const chartH = 120
  const max = useMemo(() => {
    let m = 1
    for (const k of ['A', 'C', 'G', 'T'] as const)
      for (let i = lo; i < Math.min(hi, trace.channels[k].length); i++)
        m = Math.max(m, trace.channels[k][i])
    return m
  }, [trace, lo, hi])
  const sx = (x: number) => ((x - lo) / (hi - lo)) * W
  const path = (k: 'A' | 'C' | 'G' | 'T') => {
    const data = trace.channels[k]
    let d = ''
    const step = Math.max(1, Math.floor((hi - lo) / 600))
    for (let i = lo; i < Math.min(hi, data.length); i += step)
      d += `${d ? 'L' : 'M'}${sx(i).toFixed(1)},${(top + chartH - (data[i] / max) * chartH).toFixed(1)}`
    return d
  }
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={t('molbio.reads.traceLabel', { name: trace.name })}
        className="block h-auto w-full rounded-md border border-border bg-surface"
      >
        {(['A', 'C', 'G', 'T'] as const).map((k) => (
          <path
            key={k}
            d={path(k)}
            fill="none"
            stroke={COLOURS[k]}
            strokeWidth={1.4}
          />
        ))}
        {Array.from({ length: to - from }, (_, j) => {
          const i = from + j
          const x = sx(trace.peaks[i] ?? 0)
          const q = trace.quality[i] ?? 0
          const letter = trace.bases[i] as 'A' | 'C' | 'G' | 'T'
          const isFocus = focus === i
          return (
            <g key={i}>
              {isFocus ? (
                <rect
                  x={x - 7}
                  y={top}
                  width={14}
                  height={H - top - 4}
                  fill="var(--warning-wash)"
                  opacity={0.7}
                />
              ) : null}
              <rect
                x={x - 3}
                y={top + chartH + 6 + (30 - Math.min(q, 60) / 2)}
                width={6}
                height={Math.min(q, 60) / 2}
                fill={
                  q >= 30 ? 'var(--muted-foreground)' : 'var(--destructive)'
                }
                opacity={0.55}
              />
              <text
                x={x}
                y={top + chartH + 56}
                textAnchor="middle"
                fill={
                  (COLOURS as Partial<Record<string, string>>)[letter] ??
                  'var(--foreground)'
                }
                className="text-[13px] font-medium"
              >
                {letter}
              </text>
              {(i + 1) % 10 === 0 ? (
                <text
                  x={x}
                  y={H - 2}
                  textAnchor="middle"
                  className="fill-fg-muted text-[9px]"
                >
                  {flipped ? n - i : i + 1}
                </text>
              ) : null}
            </g>
          )
        })}
      </svg>
      <input
        type="range"
        aria-label={t('molbio.reads.scrollTrace')}
        className="accent-[var(--primary)]"
        min={0}
        max={Math.max(0, n - WINDOW)}
        value={from}
        onChange={(e) => setStart(Number(e.target.value))}
      />
    </div>
  )
}
