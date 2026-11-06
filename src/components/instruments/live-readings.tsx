/**
 * Live readings on an instrument's page: what it is measuring right now, as a
 * table of measurements with a chart of the one you pick. Values arrive from the
 * agent beside the instrument and the page asks again every few seconds.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { clockOption } from '#/lib/display-clock'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/ui/confirm-dialog'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Field, Input } from '#/components/ui/input'
import { Muted, Section } from '#/components/ui/layout'
import { Select } from '#/components/ui/select'
import { Status } from '#/components/ui/status'
import { toast } from '#/components/ui/sonner'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import type { InstrumentRow } from '#/components/instruments/instruments-data'
import {
  LIVE_WINDOWS,
  feedIsLive,
  formatAgo,
  formatReadingValue,
  layoutSeries,
  liveFeedQueryKeys,
  outOfRangeQueryKey,
  removeFeed,
  seriesCsv,
  setFeedLimits,
  useFeedSeries,
  useInstrumentFeeds,
} from '#/components/instruments/live-feeds-data'
import type {
  FeedRow,
  LiveWindowId,
  SeriesPoint,
} from '#/components/instruments/live-feeds-data'
import { AGENT_SYSTEMS } from '#/lib/connectors/agent-package'
import type {
  AgentSystem,
  LiveSourceInput,
} from '#/lib/connectors/agent-package'
import {
  agentQueryKeys,
  downloadLiveAgent,
  fetchLiveAgentStatus,
} from '#/lib/connectors/agent-client'
import { formatRelativeTime } from '#/lib/notebook-data'
import { t } from '#/copy'

const NOW_TICK_MS = 1000

/** The time, ticking each second, so "5 s ago" and "Live" stay honest between fetches. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), NOW_TICK_MS)
    return () => clearInterval(id)
  }, [])
  return now
}

export function unitSuffix(feed: Pick<FeedRow, 'unit'>): string {
  return feed.unit ? ` ${feed.unit}` : ''
}

export function limitsLabel(feed: FeedRow): string {
  const { lowLimit: low, highLimit: high } = feed
  const unit = unitSuffix(feed)
  if (low !== null && high !== null) {
    return t('library.instruments.live.limitRange', {
      low: formatReadingValue(low),
      high: `${formatReadingValue(high)}${unit}`,
    })
  }
  if (low !== null) {
    return t('library.instruments.live.limitLowOnly', {
      low: `${formatReadingValue(low)}${unit}`,
    })
  }
  if (high !== null) {
    return t('library.instruments.live.limitHighOnly', {
      high: `${formatReadingValue(high)}${unit}`,
    })
  }
  return t('library.instruments.live.noLimits')
}

export function FeedState({ feed, now }: { feed: FeedRow; now: number }) {
  if (feed.limitState === 'low') {
    return <Status tone="bad">{t('library.instruments.live.stateLow')}</Status>
  }
  if (feed.limitState === 'high') {
    return <Status tone="bad">{t('library.instruments.live.stateHigh')}</Status>
  }
  return feedIsLive(feed, now) ? (
    <Status tone="ok">{t('library.instruments.live.stateLive')}</Status>
  ) : (
    <Status tone="none">{t('library.instruments.live.stateQuiet')}</Status>
  )
}

const CHART = { width: 720, height: 200 }

/** A line for the average, a band for the spread, dashed lines for limits. */
export function LiveChart({
  feed,
  windowId,
}: {
  feed: FeedRow
  windowId: LiveWindowId
}) {
  const series = useFeedSeries(feed.id, windowId)
  const [hover, setHover] = useState<SeriesPoint | null>(null)
  const frame = useRef<HTMLDivElement>(null)
  const data = series.data
  const geometry = useMemo(
    () =>
      data && data.points.length
        ? layoutSeries(data.points, data, CHART, {
            low: feed.lowLimit,
            high: feed.highLimit,
          })
        : null,
    [data, feed.lowLimit, feed.highLimit],
  )
  const windowName = t(`library.instruments.live.window${windowId}`)
  if (!data || !geometry) {
    return (
      <div className="flex h-[200px] items-center justify-center rounded-md border border-border text-body text-fg-muted">
        {series.isLoading ? '' : t('library.instruments.live.noPoints')}
      </div>
    )
  }
  const pick = (clientX: number) => {
    const box = frame.current?.getBoundingClientRect()
    if (!box || box.width === 0) return
    const at =
      data.since +
      ((clientX - box.left) / box.width) * (data.until - data.since)
    let best = data.points[0]
    for (const p of data.points) {
      if (Math.abs(p.at - at) < Math.abs(best.at - at)) best = p
    }
    setHover(best)
  }
  const shown = hover && data.points.includes(hover) ? hover : null
  const marker = shown ?? data.points.at(-1)!
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline gap-x-3 text-label text-fg-muted">
        <span className="num text-body font-semibold text-fg">
          {shown
            ? t('library.instruments.live.hoverReading', {
                value: `${formatReadingValue(shown.avg)}${unitSuffix(feed)}`,
                time: new Date(shown.at).toLocaleTimeString('en-GB', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                  ...clockOption(),
                }),
              })
            : `${formatReadingValue(feed.lastValue)}${unitSuffix(feed)}`}
        </span>
        <span>{t('library.instruments.live.spread')}</span>
        <span className="num ml-auto">
          {t('library.instruments.live.readingsInWindow', {
            count: data.points
              .reduce((n, p) => n + p.readings, 0)
              .toLocaleString('en-GB'),
          })}
        </span>
      </div>
      <div
        ref={frame}
        className="relative rounded-md border border-border"
        onPointerMove={(e) => pick(e.clientX)}
        onPointerLeave={() => setHover(null)}
      >
        <svg
          role="img"
          aria-label={t('library.instruments.live.chartLabel', {
            name: feed.name,
            window: windowName,
          })}
          viewBox={`0 0 ${CHART.width} ${CHART.height}`}
          preserveAspectRatio="none"
          className="block h-[200px] w-full"
        >
          {[0.25, 0.5, 0.75].map((f) => (
            <line
              key={f}
              x1={0}
              x2={CHART.width}
              y1={CHART.height * f}
              y2={CHART.height * f}
              className="stroke-border"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {[feed.lowLimit, feed.highLimit].map((limit, i) =>
            limit === null ? null : (
              <line
                key={i}
                x1={0}
                x2={CHART.width}
                y1={geometry.y(limit)}
                y2={geometry.y(limit)}
                className="stroke-danger"
                strokeWidth={1}
                strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke"
              />
            ),
          )}
          {geometry.band ? (
            <path d={geometry.band} className="fill-link opacity-15" />
          ) : null}
          <path
            d={geometry.line}
            fill="none"
            className="stroke-link"
            strokeWidth={1.75}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {shown ? (
            <line
              x1={geometry.x(shown.at)}
              x2={geometry.x(shown.at)}
              y1={0}
              y2={CHART.height}
              className="stroke-border-strong"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </svg>
        {/* The point marker is HTML so it stays round while the chart stretches. */}
        <span
          aria-hidden="true"
          className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-link"
          style={{
            left: `${(geometry.x(marker.at) / CHART.width) * 100}%`,
            top: `${(geometry.y(marker.avg) / CHART.height) * 100}%`,
          }}
        />
        <span className="num pointer-events-none absolute right-2 bottom-1 text-label text-fg-muted">
          {t('library.instruments.live.now')}
        </span>
        <span className="num pointer-events-none absolute top-1 left-2 text-label text-fg-muted">
          {formatReadingValue(geometry.yMax)}
        </span>
        <span className="num pointer-events-none absolute bottom-1 left-2 text-label text-fg-muted">
          {formatReadingValue(geometry.yMin)}
        </span>
        <span className="num pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2 text-label text-fg-muted">
          {new Date(data.since).toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            ...clockOption(),
          })}
          {' – '}
          {new Date(data.until).toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            ...clockOption(),
          })}
        </span>
      </div>
    </div>
  )
}

export function LimitsDialog({
  feed,
  open,
  onOpenChange,
}: {
  feed: FeedRow
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [low, setLow] = useState(feed.lowLimit?.toString() ?? '')
  const [high, setHigh] = useState(feed.highLimit?.toString() ?? '')
  const [unit, setUnit] = useState(feed.unit ?? '')
  const lowNumber = low.trim() === '' ? null : Number(low)
  const highNumber = high.trim() === '' ? null : Number(high)
  const invalid =
    (lowNumber !== null && !Number.isFinite(lowNumber)) ||
    (highNumber !== null && !Number.isFinite(highNumber))
  const backwards =
    lowNumber !== null && highNumber !== null && lowNumber > highNumber
  const mutation = useMutation({
    mutationFn: () =>
      setFeedLimits({
        feedId: feed.id,
        low: lowNumber,
        high: highNumber,
        unit: unit.trim() || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: liveFeedQueryKeys.feeds(feed.ownerId),
      })
      void queryClient.invalidateQueries({ queryKey: outOfRangeQueryKey })
      onOpenChange(false)
      toast(t('library.instruments.live.limitsSaved'))
    },
    onError: (error: unknown) => {
      toast(t('library.instruments.live.couldNotSaveLimits'), {
        description: error instanceof Error ? error.message : undefined,
      })
    },
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <DialogHeader
          title={t('library.instruments.live.limitsTitle', { name: feed.name })}
          description={t('library.instruments.live.limitsDescription')}
        />
        <DialogBody>
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('library.instruments.live.lowLimit')}>
                <Input
                  inputMode="decimal"
                  value={low}
                  onChange={(e) => setLow(e.target.value)}
                />
              </Field>
              <Field label={t('library.instruments.live.highLimit')}>
                <Input
                  inputMode="decimal"
                  value={high}
                  onChange={(e) => setHigh(e.target.value)}
                />
              </Field>
            </div>
            <Muted>
              {backwards
                ? t('library.instruments.live.limitsOrder')
                : t('library.instruments.live.limitsHint')}
            </Muted>
            <Field label={t('library.instruments.live.unit')}>
              <Input
                value={unit}
                maxLength={20}
                onChange={(e) => setUnit(e.target.value)}
              />
            </Field>
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={invalid || backwards || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending
              ? t('library.instruments.live.savingLimits')
              : t('library.instruments.live.saveLimits')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Choose where readings come from and download the agent that carries them. */
export function LiveSetupDialog({
  instrument,
  open,
  onOpenChange,
}: {
  instrument: InstrumentRow
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [system, setSystem] = useState<AgentSystem>('windows')
  const [kind, setKind] = useState<'file' | 'network'>('file')
  const [path, setPath] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('')
  const [feed, setFeed] = useState('')
  const [unit, setUnit] = useState('')
  const portNumber = Number(port)
  const ready =
    kind === 'file'
      ? path.trim().length > 0
      : host.trim().length > 0 &&
        Number.isInteger(portNumber) &&
        portNumber >= 1 &&
        portNumber <= 65535
  const mutation = useMutation({
    mutationFn: () => {
      const extra = {
        ...(feed.trim() ? { feed: feed.trim() } : {}),
        ...(unit.trim() ? { unit: unit.trim() } : {}),
      }
      const source: LiveSourceInput =
        kind === 'file'
          ? { kind: 'file', path: path.trim(), ...extra }
          : { kind: 'network', host: host.trim(), port: portNumber, ...extra }
      return downloadLiveAgent({
        instrumentId: instrument.id,
        system,
        live: [source],
      })
    },
    onSuccess: (fileName) => {
      void queryClient.invalidateQueries({
        queryKey: agentQueryKeys.liveStatus(instrument.id),
      })
      onOpenChange(false)
      toast(t('library.instruments.live.downloaded', { file: fileName }))
    },
    onError: (error: unknown) => {
      toast(t('library.instruments.live.couldNotDownload'), {
        description: error instanceof Error ? error.message : undefined,
      })
    },
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader
          title={t('library.instruments.live.dialogTitle', {
            name: instrument.name,
          })}
          description={t('library.instruments.live.dialogDescription')}
        />
        <DialogBody>
          <div className="flex flex-col gap-3">
            <Field label={t('library.instruments.live.system')}>
              <Select
                value={system}
                onChange={(e) => setSystem(e.target.value as AgentSystem)}
              >
                {AGENT_SYSTEMS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {t(
                      s.value === 'windows'
                        ? 'library.instruments.live.systemWindows'
                        : s.value === 'mac'
                          ? 'library.instruments.live.systemMac'
                          : 'library.instruments.live.systemLinux',
                    )}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('library.instruments.live.source')}>
              <Select
                value={kind}
                onChange={(e) => setKind(e.target.value as 'file' | 'network')}
              >
                <option value="file">
                  {t('library.instruments.live.sourceFile')}
                </option>
                <option value="network">
                  {t('library.instruments.live.sourceNetwork')}
                </option>
              </Select>
            </Field>
            {kind === 'file' ? (
              <Field
                label={t('library.instruments.live.filePath')}
                hint={t('library.instruments.live.filePathHint')}
                required
              >
                <Input
                  value={path}
                  placeholder={t(
                    'library.instruments.live.filePathPlaceholder',
                  )}
                  onChange={(e) => setPath(e.target.value)}
                />
              </Field>
            ) : (
              <div className="grid grid-cols-[1fr_120px] gap-3">
                <Field label={t('library.instruments.live.host')} required>
                  <Input
                    value={host}
                    placeholder={t('library.instruments.live.hostPlaceholder')}
                    onChange={(e) => setHost(e.target.value)}
                  />
                </Field>
                <Field label={t('library.instruments.live.port')} required>
                  <Input
                    inputMode="numeric"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                  />
                </Field>
              </div>
            )}
            <div className="grid grid-cols-[1fr_120px] gap-3">
              <Field
                label={t('library.instruments.live.measurementName')}
                hint={t('library.instruments.live.measurementNameHint')}
              >
                <Input
                  value={feed}
                  maxLength={80}
                  placeholder={t(
                    'library.instruments.live.measurementNamePlaceholder',
                  )}
                  onChange={(e) => setFeed(e.target.value)}
                />
              </Field>
              <Field label={t('library.instruments.live.measurementUnit')}>
                <Input
                  value={unit}
                  maxLength={20}
                  placeholder={t(
                    'library.instruments.live.measurementUnitPlaceholder',
                  )}
                  onChange={(e) => setUnit(e.target.value)}
                />
              </Field>
            </div>
            <Muted>{t('library.instruments.live.replacesEarlier')}</Muted>
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={!ready || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending
              ? t('library.instruments.live.downloading')
              : t('library.instruments.live.download')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AgentLine({ instrumentId }: { instrumentId: string }) {
  const status = useQuery({
    queryKey: agentQueryKeys.liveStatus(instrumentId),
    queryFn: () => fetchLiveAgentStatus(instrumentId),
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: false,
  })
  if (!status.data) return null
  const { downloaded, running, lastSeenAt } = status.data
  if (!downloaded) {
    return (
      <Status tone="none">
        {t('library.instruments.live.agentNotDownloaded')}
      </Status>
    )
  }
  return running ? (
    <Status tone="ok">
      {t('library.instruments.live.agentRunning', {
        when: lastSeenAt ? formatRelativeTime(lastSeenAt) : '—',
      })}
    </Status>
  ) : (
    <Status tone="warn">{t('library.instruments.live.agentNotRunning')}</Status>
  )
}

function download(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function LiveReadingsSection({
  instrument,
  canSetUp,
  canSetLimits,
}: {
  instrument: InstrumentRow
  /** Can download the agent (manages Integrations). */
  canSetUp: boolean
  /** Can set limits and stop keeping a measurement (runs the instrument). */
  canSetLimits: boolean
}) {
  const feeds = useInstrumentFeeds(instrument.id)
  const [setupOpen, setSetupOpen] = useState(false)
  const rows = feeds.data ?? []
  return (
    <>
      <ReadingsSection
        ownerId={instrument.id}
        fileLabel={instrument.displayId ?? 'instrument'}
        feeds={rows}
        loaded={feeds.isSuccess}
        canSetLimits={canSetLimits}
        // Nothing has come in and this person can't set it up: nothing to show.
        hideWhenEmpty={!canSetUp}
        title={t('library.instruments.live.title')}
        empty={t('library.instruments.live.empty')}
        action={
          <>
            <AgentLine instrumentId={instrument.id} />
            {canSetUp && !instrument.retiredAt ? (
              <Button size="sm" onClick={() => setSetupOpen(true)}>
                {rows.length
                  ? t('library.instruments.live.changeSetUp')
                  : t('library.instruments.live.setUp')}
              </Button>
            ) : null}
          </>
        }
      />
      <LiveSetupDialog
        instrument={instrument}
        open={setupOpen}
        onOpenChange={setSetupOpen}
      />
    </>
  )
}

/**
 * The measurements kept for one place or instrument: a table of them with a
 * chart of the one picked, limits, a CSV and removal. Shared by instruments and
 * by freezers and rooms.
 */
export function ReadingsSection({
  ownerId,
  fileLabel,
  feeds: rows,
  loaded,
  canSetLimits,
  hideWhenEmpty,
  title,
  empty,
  action,
  defaultWindow = '1h',
  className = 'border-t border-border pt-4',
}: {
  ownerId: string
  fileLabel: string
  feeds: FeedRow[]
  loaded: boolean
  canSetLimits: boolean
  hideWhenEmpty: boolean
  title: string
  empty: string
  action?: ReactNode
  /** How far back the chart starts out. */
  defaultWindow?: LiveWindowId
  className?: string
}) {
  const queryClient = useQueryClient()
  const now = useNow()
  const [selected, setSelected] = useState<string | null>(null)
  const [windowId, setWindowId] = useState<LiveWindowId>(defaultWindow)
  const [limitsOpen, setLimitsOpen] = useState(false)
  const [removing, setRemoving] = useState(false)
  const feed = rows.find((row) => row.id === selected) ?? rows.at(0) ?? null
  const series = useFeedSeries(feed?.id ?? null, windowId)
  const remove = useMutation({
    mutationFn: (target: FeedRow) => removeFeed(target.id),
    onSuccess: (_data, target) => {
      void queryClient.invalidateQueries({
        queryKey: liveFeedQueryKeys.feeds(ownerId),
      })
      void queryClient.invalidateQueries({ queryKey: outOfRangeQueryKey })
      setSelected(null)
      setRemoving(false)
      toast(t('library.instruments.live.removed', { name: target.name }))
    },
    onError: (error: unknown) => {
      toast(t('library.instruments.live.couldNotRemove'), {
        description: error instanceof Error ? error.message : undefined,
      })
    },
  })
  const columns: RegistryColumn<FeedRow>[] = [
    {
      id: 'name',
      header: t('library.instruments.live.measurement'),
      cell: ({ row }) => (
        <button
          type="button"
          className={
            row.original.id === feed?.id
              ? 'text-left font-medium underline underline-offset-4'
              : 'text-left font-medium hover:underline'
          }
          aria-pressed={row.original.id === feed?.id}
          onClick={() => setSelected(row.original.id)}
        >
          {row.original.name}
        </button>
      ),
    },
    {
      id: 'latest',
      header: t('library.instruments.live.latest'),
      cell: ({ row }) => (
        <span className="num font-semibold">
          {formatReadingValue(row.original.lastValue)}
          <span className="font-normal text-fg-muted">
            {unitSuffix(row.original)}
          </span>
        </span>
      ),
    },
    {
      id: 'limits',
      header: t('library.instruments.live.limits'),
      cell: ({ row }) => limitsLabel(row.original),
      meta: { cellClassName: 'text-fg-muted' },
    },
    {
      id: 'lastReading',
      header: t('library.instruments.live.lastReading'),
      cell: ({ row }) => formatAgo(row.original.lastAt, now),
      meta: { cellClassName: 'text-fg-muted' },
    },
    {
      id: 'state',
      header: t('library.instruments.live.state'),
      cell: ({ row }) => <FeedState feed={row.original} now={now} />,
    },
  ]

  if (loaded && rows.length === 0 && hideWhenEmpty) return null

  return (
    <Section className={className} title={title} action={action}>
      {rows.length === 0 ? (
        <Muted>{empty}</Muted>
      ) : (
        <div className="grid grid-cols-1 gap-4 @5xl/record:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <TableBox className="self-start">
            <RegistryGrid
              label={t('library.instruments.live.tableLabel')}
              rows={rows}
              columns={columns}
              getRowId={(r) => r.id}
              selectable={false}
            />
          </TableBox>
          {feed ? (
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-body font-semibold">{feed.name}</h3>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <Select
                    aria-label={t('library.instruments.live.windowLabel')}
                    value={windowId}
                    onChange={(e) =>
                      setWindowId(e.target.value as LiveWindowId)
                    }
                  >
                    {LIVE_WINDOWS.map((w) => (
                      <option key={w.id} value={w.id}>
                        {t(`library.instruments.live.window${w.id}`)}
                      </option>
                    ))}
                  </Select>
                  {canSetLimits ? (
                    <Button size="sm" onClick={() => setLimitsOpen(true)}>
                      {t('library.instruments.live.setLimits')}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    disabled={!series.data?.points.length}
                    onClick={() =>
                      download(
                        `${fileLabel}-${feed.name}.csv`.replace(
                          /[^\w.-]+/g,
                          '-',
                        ),
                        seriesCsv(feed, series.data?.points ?? []),
                      )
                    }
                  >
                    {t('library.instruments.live.downloadCsv')}
                  </Button>
                  {canSetLimits ? (
                    <Button size="sm" onClick={() => setRemoving(true)}>
                      {t('library.instruments.live.remove')}
                    </Button>
                  ) : null}
                </div>
              </div>
              <LiveChart feed={feed} windowId={windowId} />
            </div>
          ) : null}
        </div>
      )}
      {feed ? (
        <LimitsDialog
          key={`${feed.id}:${feed.lowLimit}:${feed.highLimit}:${feed.unit}`}
          feed={feed}
          open={limitsOpen}
          onOpenChange={setLimitsOpen}
        />
      ) : null}
      {feed ? (
        <ConfirmDialog open={removing} onOpenChange={setRemoving}>
          <ConfirmDialogContent>
            <ConfirmDialogHeader>
              <ConfirmDialogTitle>
                {t('library.instruments.live.removeTitle', { name: feed.name })}
              </ConfirmDialogTitle>
              <ConfirmDialogDescription>
                {t('library.instruments.live.removeBody')}
              </ConfirmDialogDescription>
            </ConfirmDialogHeader>
            <ConfirmDialogFooter>
              <ConfirmDialogCancel>
                {t('common.actions.cancel')}
              </ConfirmDialogCancel>
              <ConfirmDialogAction
                disabled={remove.isPending}
                onClick={() => remove.mutate(feed)}
              >
                {t('library.instruments.live.removeConfirm')}
              </ConfirmDialogAction>
            </ConfirmDialogFooter>
          </ConfirmDialogContent>
        </ConfirmDialog>
      ) : null}
    </Section>
  )
}
