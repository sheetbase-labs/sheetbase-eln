/**
 * The timer a background sweep runs on: one per process (even across a
 * dev-server module reload), an unref'd interval with a first run shortly
 * after boot, and never started under test runners unless
 * `SHEETBASE_SCHEDULER_ENABLED=true`. `false` always turns it off.
 */

const BOOT_DELAY_MS = 5_000

declare global {
  var __sheetbaseBackgroundSweepsStarted: Set<string> | undefined
}

/** The names of the sweeps already running in this process. */
function startedSweeps(): Set<string> {
  globalThis.__sheetbaseBackgroundSweepsStarted ??= new Set()

  return globalThis.__sheetbaseBackgroundSweepsStarted
}

/**
 * Off under test runners unless explicitly enabled with
 * `SHEETBASE_SCHEDULER_ENABLED=true`; always off when that flag is `false`.
 */
function sweepsDisabled(): boolean {
  if (process.env.SHEETBASE_SCHEDULER_ENABLED === 'false') return true

  const inTest =
    process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'

  return inTest && process.env.SHEETBASE_SCHEDULER_ENABLED !== 'true'
}

export interface BackgroundSweep {
  /** Starts the sweep unless it's off, already running, or in a browser. */
  start: (tick: () => Promise<void>, intervalMs: number) => void
  /** Clears both timers and the per-process marker (tests and shutdown). */
  stop: () => void
}

export function createBackgroundSweep(name: string): BackgroundSweep {
  let timer: ReturnType<typeof setInterval> | null = null
  let bootTimer: ReturnType<typeof setTimeout> | null = null

  return {
    start(tick, intervalMs) {
      if (typeof window !== 'undefined') return

      if (sweepsDisabled()) return

      if (startedSweeps().has(name)) return
      startedSweeps().add(name)

      bootTimer = setTimeout(() => void tick(), BOOT_DELAY_MS)
      bootTimer.unref()
      timer = setInterval(() => void tick(), intervalMs)
      timer.unref()
    },

    stop() {
      if (bootTimer) {
        clearTimeout(bootTimer)
        bootTimer = null
      }

      if (timer) {
        clearInterval(timer)
        timer = null
      }

      startedSweeps().delete(name)
    },
  }
}
