'use client'

import * as React from 'react'
import { useRouter } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'

import { toast } from '#/components/v3/ui/sonner'
import {
  devFlags,
  setDevFlag,
  setDevFlagsActive,
  useDevFlagOverrides,
} from '#/lib/dev-flags'
import {
  clearDevRequests,
  isQuiet,
  setDevNetwork,
  setDevNetworkActive,
  summariseRequests,
  useDevNetworkSettings,
  useDevRequests,
} from '#/lib/dev-network'
import { cn } from '#/lib/utils'

import { devToolbarAvailable } from './dev-availability'
import { setDevSwitch, useDevSwitch } from './dev-switch'
import { grade, usePerf } from './perf'
import type { PerfReadout } from './perf'

// Developer tooling, kept out of the copy catalogue (docs/development/copy.md).
const text = {
  title: 'Dev tools',
  flags: 'Feature flags',
  flagsHint:
    'For this browser only. A flag can switch a feature off, never on.',
  reset: 'Reset',
  performance: 'Performance',
  requests: 'Recent requests',
  noRequests: 'No data requests yet',
  clearLog: 'Clear',
  network: 'Network',
  latency: 'Latency',
  failures: 'Failures',
  actions: 'Actions',
  hide: 'Hide',
  shortcut: 'Ctrl + Alt + D shows or hides this',
} as const

const latencies = [0, 300, 1000, 3000]
const failureRates = [0, 0.1, 0.5]

const gradeClass = {
  good: 'text-success',
  warn: 'text-warning',
  bad: 'text-destructive',
  none: 'text-muted-foreground',
} as const

/**
 * The toolbar that lives inside the app, after the internal one Linear
 * describes: switch feature flags, watch performance, slow or break the
 * network, and run developer actions. Shown in development builds, and in
 * production only to owners and admins who switch it on with Ctrl+Alt+D.
 * Everything it does is local to this browser.
 */
export function DevToolbar({
  role,
  queryClient,
}: {
  role: string | null | undefined
  queryClient: QueryClient
}) {
  const stored = useDevSwitch()
  const dev = import.meta.env.DEV
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])

  // Automated browsers keep clear of the bar unless it was switched on.
  const automated = mounted && navigator.webdriver === true
  const enabled = stored === '1' || (dev && stored === null && !automated)
  const available =
    mounted &&
    !import.meta.env.VITE_PARITY &&
    devToolbarAvailable({ dev, role, enabled })
  const canToggle = dev || devToolbarAvailable({ dev, role, enabled: true })

  React.useEffect(() => {
    setDevFlagsActive(available)
    setDevNetworkActive(available)
  }, [available])

  React.useEffect(() => {
    if (!canToggle) return
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.altKey && event.code === 'KeyD') {
        event.preventDefault()
        setDevSwitch(!enabled)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canToggle, enabled])

  if (!available) return null
  return <Bar role={role} queryClient={queryClient} />
}

function Bar({
  role,
  queryClient,
}: {
  role: string | null | undefined
  queryClient: QueryClient
}) {
  const overrides = useDevFlagOverrides()
  const network = useDevNetworkSettings()
  const perf = usePerf(true)
  const { inFlight } = useDevRequests()
  const flagsOff = Object.keys(overrides).length
  const simulating = !isQuiet(network)

  return (
    <section
      data-dev-toolbar
      aria-label={text.title}
      className="fixed inset-x-0 bottom-0 z-[60] flex h-9 items-center gap-3 overflow-x-auto border-t border-border bg-popover px-3 text-body text-popover-foreground shadow-overlay"
    >
      <span className="flex shrink-0 items-center gap-1.5 text-caption font-medium text-muted-foreground">
        <span
          aria-hidden
          className={cn(
            'size-1.5 rounded-full',
            flagsOff || simulating ? 'bg-warning' : 'bg-success',
          )}
        />
        {text.title}
      </span>
      <Divider />
      <BarPopover label={text.flags} badge={flagsOff || undefined}>
        <FlagsPanel overrides={overrides} />
      </BarPopover>
      <Divider />
      <BarPopover label={<Readout perf={perf} inFlight={inFlight} />}>
        <PerformancePanel perf={perf} queryClient={queryClient} />
      </BarPopover>
      <Divider />
      <NetworkControls />
      <Divider />
      <BarPopover label={text.actions}>
        <ActionsPanel role={role} queryClient={queryClient} />
      </BarPopover>
      <button
        type="button"
        title={text.shortcut}
        onClick={() => setDevSwitch(false)}
        className="ml-auto shrink-0 text-caption text-muted-foreground hover:text-foreground"
      >
        {text.hide}
      </button>
    </section>
  )
}

function Divider() {
  return <span aria-hidden className="h-4 w-px shrink-0 bg-border" />
}

/**
 * A bar button that opens a panel above it. The panel is fixed, not absolute:
 * the bar scrolls sideways on a narrow screen and would clip it.
 */
function BarPopover({
  label,
  badge,
  children,
}: {
  label: React.ReactNode
  badge?: number | undefined
  children: React.ReactNode
}) {
  const [left, setLeft] = React.useState<number | null>(null)
  const open = left !== null
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setLeft(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLeft(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="shrink-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={(event) =>
          setLeft(
            open ? null : event.currentTarget.getBoundingClientRect().left,
          )
        }
        className="flex items-center gap-1.5 whitespace-nowrap rounded-sm px-1.5 py-0.5 text-caption hover:bg-accent"
      >
        {label}
        {badge ? (
          <span className="rounded-full bg-warning px-1.5 text-caption text-warning-foreground">
            {badge}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          style={{ left: Math.max(8, left) }}
          className="fixed bottom-11 flex max-h-[70dvh] w-80 max-w-[calc(100vw-1rem)] flex-col gap-2 overflow-y-auto rounded-lg border border-border bg-popover p-3 shadow-dialog"
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}

function FlagsPanel({
  overrides,
}: {
  overrides: ReturnType<typeof useDevFlagOverrides>
}) {
  const changed = Object.keys(overrides).length > 0
  return (
    <>
      <p className="text-caption text-faint-foreground">{text.flagsHint}</p>
      <ul className="flex flex-col gap-2">
        {devFlags.map((flag) => {
          const on = overrides[flag.key] ?? true
          return (
            <li key={flag.key}>
              <label className="flex items-start gap-2 text-body">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(event) =>
                    setDevFlag(
                      flag.key,
                      event.target.checked ? undefined : false,
                    )
                  }
                  className="mt-0.5 size-3.5 accent-[var(--primary)]"
                />
                <span className="flex flex-col">
                  {flag.label}
                  <span className="text-caption text-muted-foreground">
                    {flag.hint}
                  </span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>
      <button
        type="button"
        disabled={!changed}
        onClick={() => devFlags.forEach((f) => setDevFlag(f.key, undefined))}
        className="self-start text-caption text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        {text.reset}
      </button>
    </>
  )
}

function Metric({
  label,
  value,
  tone = 'none',
}: {
  label: string
  value: string
  tone?: keyof typeof gradeClass
}) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('font-mono', gradeClass[tone])}>{value}</span>
    </span>
  )
}

const seconds = (ms: number | null) =>
  ms === null ? '–' : `${(ms / 1000).toFixed(1)} s`

/** The numbers that sit in the bar itself. */
function Readout({ perf, inFlight }: { perf: PerfReadout; inFlight: number }) {
  return (
    <span className="flex items-center gap-3">
      <Metric
        label="fps"
        value={perf.fps === null ? '–' : String(perf.fps)}
        tone={grade('fps', perf.fps)}
      />
      <Metric
        label="LCP"
        value={seconds(perf.lcp)}
        tone={grade('lcp', perf.lcp)}
      />
      <Metric
        label="CLS"
        value={perf.cls.toFixed(2)}
        tone={grade('cls', perf.cls)}
      />
      <Metric
        label="INP"
        value={perf.inp === null ? '–' : `${perf.inp} ms`}
        tone={grade('inp', perf.inp)}
      />
      {perf.heapMb !== null ? (
        <Metric label="heap" value={`${perf.heapMb} MB`} />
      ) : null}
      <Metric label="in flight" value={String(inFlight)} />
    </span>
  )
}

function PerformancePanel({
  perf,
  queryClient,
}: {
  perf: PerfReadout
  queryClient: QueryClient
}) {
  const { log } = useDevRequests()
  const summary = summariseRequests(log)
  return (
    <>
      <h3 className="text-caption font-medium text-muted-foreground">
        {text.performance}
      </h3>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-caption">
        <Metric
          label="Long tasks"
          value={`${perf.longTasks} (${perf.longTaskMs} ms)`}
          tone={perf.longTasks ? 'warn' : 'good'}
        />
        <Metric label="DOM nodes" value={String(perf.domNodes)} />
        <Metric
          label="Queries"
          value={`${queryClient.getQueryCache().getAll().length} cached`}
        />
        <Metric label="Fetching" value={String(queryClient.isFetching())} />
        <Metric label="Average" value={`${summary.averageMs} ms`} />
        <Metric label="Slowest" value={`${summary.slowestMs} ms`} />
      </div>
      <div className="flex items-center justify-between">
        <h3 className="text-caption font-medium text-muted-foreground">
          {text.requests}
          {summary.failed ? ` · ${summary.failed} failed` : ''}
        </h3>
        <button
          type="button"
          onClick={clearDevRequests}
          className="text-caption text-muted-foreground hover:text-foreground"
        >
          {text.clearLog}
        </button>
      </div>
      {log.length ? (
        <ul className="flex flex-col font-mono text-caption">
          {log.slice(0, 15).map((r) => (
            <li key={r.id} className="flex items-baseline gap-2 py-0.5">
              <span
                className={cn(
                  'w-8 shrink-0',
                  r.status === 0 || r.status >= 400
                    ? 'text-destructive'
                    : 'text-muted-foreground',
                )}
              >
                {r.status || 'err'}
              </span>
              <span className="min-w-0 flex-1 truncate" title={r.path}>
                {r.method} {r.path}
              </span>
              <span className="shrink-0 text-muted-foreground">{r.ms} ms</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-caption text-muted-foreground">{text.noRequests}</p>
      )}
    </>
  )
}

function NetworkControls() {
  const network = useDevNetworkSettings()
  const select =
    'h-6 rounded-sm border border-border bg-card px-1 text-caption outline-none focus-visible:ring-2 focus-visible:ring-ring'
  return (
    <div className="flex shrink-0 items-center gap-2 text-caption">
      <span className="text-muted-foreground">{text.network}</span>
      <select
        aria-label={text.latency}
        value={network.latencyMs}
        onChange={(e) => setDevNetwork({ latencyMs: Number(e.target.value) })}
        className={select}
      >
        {latencies.map((ms) => (
          <option key={ms} value={ms}>
            {ms ? `+${ms} ms` : 'No delay'}
          </option>
        ))}
      </select>
      <select
        aria-label={text.failures}
        value={network.offline ? 'offline' : String(network.failRate)}
        onChange={(e) =>
          e.target.value === 'offline'
            ? setDevNetwork({ offline: true, failRate: 0 })
            : setDevNetwork({
                offline: false,
                failRate: Number(e.target.value),
              })
        }
        className={select}
      >
        {failureRates.map((rate) => (
          <option key={rate} value={String(rate)}>
            {rate ? `${rate * 100}% fail` : 'No failures'}
          </option>
        ))}
        <option value="offline">Offline</option>
      </select>
    </div>
  )
}

function ActionsPanel({
  role,
  queryClient,
}: {
  role: string | null | undefined
  queryClient: QueryClient
}) {
  const router = useRouter()
  const overrides = useDevFlagOverrides()
  const network = useDevNetworkSettings()

  const run = (label: string, action: () => void | Promise<void>) => () => {
    void Promise.resolve(action()).then(() => toast(label))
  }

  const copyInfo = async () => {
    const info = {
      url: window.location.href,
      role: role ?? null,
      mode: import.meta.env.MODE,
      viewport: `${window.innerWidth}×${window.innerHeight}`,
      userAgent: navigator.userAgent,
      flagOverrides: overrides,
      networkSimulation: network,
    }
    await navigator.clipboard.writeText(JSON.stringify(info, null, 2))
  }

  const actions: Array<{
    label: string
    done: string
    run: () => void | Promise<void>
  }> = [
    {
      label: 'Refetch all data',
      done: 'Refetching data',
      run: async () => {
        await queryClient.invalidateQueries()
        await router.invalidate()
      },
    },
    {
      label: 'Clear data cache',
      done: 'Data cache cleared',
      run: async () => {
        queryClient.clear()
        await router.invalidate()
      },
    },
    {
      label: 'Reload page',
      done: 'Reloading',
      run: () => window.location.reload(),
    },
    {
      label: 'Reset local state and reload',
      done: 'Local state cleared',
      run: () => {
        try {
          const keep = localStorage.getItem('sb-devtools')
          localStorage.clear()
          sessionStorage.clear()
          if (keep) localStorage.setItem('sb-devtools', keep)
        } catch {
          /* blocked storage: nothing to clear */
        }
        window.location.reload()
      },
    },
    {
      label: 'Copy debug info',
      done: 'Debug info copied',
      run: copyInfo,
    },
    {
      label: 'Show a test notification',
      done: 'This is a test notification',
      run: () => undefined,
    },
  ]

  return (
    <ul className="flex flex-col">
      {actions.map((action) => (
        <li key={action.label}>
          <button
            type="button"
            onClick={run(action.done, action.run)}
            className="w-full rounded-sm px-2 py-1 text-left text-body hover:bg-accent"
          >
            {action.label}
          </button>
        </li>
      ))}
    </ul>
  )
}
