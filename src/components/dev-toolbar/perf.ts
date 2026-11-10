import * as React from 'react'

export interface PerfReadout {
  fps: number | null
  /** Largest contentful paint, ms. */
  lcp: number | null
  /** Cumulative layout shift. */
  cls: number
  /** Slowest interaction so far, ms. */
  inp: number | null
  longTasks: number
  longTaskMs: number
  /** Used JS heap in MB (Chromium only). */
  heapMb: number | null
  domNodes: number
}

interface LayoutShiftEntry extends PerformanceEntry {
  readonly value: number
  readonly hadRecentInput: boolean
}

/** The DOM types do not declare the layout-shift fields on `PerformanceEntry`. */
function isLayoutShiftEntry(
  entry: PerformanceEntry,
): entry is LayoutShiftEntry {
  return 'value' in entry && 'hadRecentInput' in entry
}

/** Chromium reports used JS heap size on `performance`; no standard type declares it. */
interface ChromiumPerformance extends Performance {
  readonly memory?: { readonly usedJSHeapSize: number }
}

/** The metrics gathered between two readouts. */
interface PerfSamples {
  lcp: number | null
  cls: number
  inp: number | null
  longTasks: number
  longTaskMs: number
}

const empty: PerfReadout = {
  fps: null,
  lcp: null,
  cls: 0,
  inp: null,
  longTasks: 0,
  longTaskMs: 0,
  heapMb: null,
  domNodes: 0,
}

/** `PerformanceObserverInit` plus the Event Timing spec's `durationThreshold`. */
interface PerfObserverInit extends PerformanceObserverInit {
  durationThreshold?: number
}

function observe(
  type: string,
  handle: (entries: PerformanceEntry[]) => void,
  options: PerfObserverInit = {},
): PerformanceObserver | null {
  try {
    const observer = new PerformanceObserver((list) =>
      handle(list.getEntries()),
    )

    observer.observe({ type, buffered: true, ...options })

    return observer
  } catch {
    // The browser does not report this metric.
    return null
  }
}

/**
 * Live performance numbers for the toolbar: frame rate, the Web Vitals this
 * page has seen so far, long tasks, memory and DOM size. Sampled once a second,
 * and only while `enabled`.
 */
export function usePerf(enabled: boolean): PerfReadout {
  const [readout, setReadout] = React.useState<PerfReadout>(empty)

  React.useEffect(() => {
    if (!enabled) return

    const state: PerfSamples = {
      lcp: null,
      cls: 0,
      inp: null,
      longTasks: 0,
      longTaskMs: 0,
    }

    const observers = [
      observe('largest-contentful-paint', (entries) => {
        const last = entries.at(-1)

        if (last) state.lcp = Math.round(last.startTime)
      }),
      observe('layout-shift', (entries) => {
        for (const entry of entries) {
          if (isLayoutShiftEntry(entry) && !entry.hadRecentInput) {
            state.cls += entry.value
          }
        }
      }),
      observe(
        'event',
        (entries) => {
          for (const entry of entries) {
            state.inp = Math.max(state.inp ?? 0, Math.round(entry.duration))
          }
        },
        { durationThreshold: 40 },
      ),
      observe('longtask', (entries) => {
        for (const entry of entries) {
          state.longTasks += 1
          state.longTaskMs += Math.round(entry.duration)
        }
      }),
    ]

    let frames = 0
    let last = performance.now()
    let raf = 0

    const tick = (now: number) => {
      frames += 1

      if (now - last >= 1000) {
        // SAFETY: `memory` is Chromium's non-standard `Performance` member, absent elsewhere; the readout stays null when it is.
        const memory = (performance as ChromiumPerformance).memory

        setReadout({
          fps: Math.round((frames * 1000) / (now - last)),
          lcp: state.lcp,
          cls: Math.round(state.cls * 1000) / 1000,
          inp: state.inp,
          longTasks: state.longTasks,
          longTaskMs: state.longTaskMs,
          heapMb: memory ? Math.round(memory.usedJSHeapSize / 1048576) : null,
          domNodes: document.getElementsByTagName('*').length,
        })
        frames = 0
        last = now
      }

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      observers.forEach((o) => o?.disconnect())
    }
  }, [enabled])

  return readout
}

/** Good, needs work, poor: the Web Vitals thresholds, for colouring a number. */
export function grade(
  metric: 'lcp' | 'cls' | 'inp' | 'fps',
  value: number | null,
): 'good' | 'warn' | 'bad' | 'none' {
  if (value === null) return 'none'

  const bands = {
    lcp: [2500, 4000],
    cls: [0.1, 0.25],
    inp: [200, 500],
  } as const

  if (metric === 'fps')
    return value >= 50 ? 'good' : value >= 30 ? 'warn' : 'bad'
  const [good, poor] = bands[metric]

  return value <= good ? 'good' : value <= poor ? 'warn' : 'bad'
}
