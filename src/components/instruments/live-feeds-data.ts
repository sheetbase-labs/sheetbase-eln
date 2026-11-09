import { useQuery } from '@tanstack/react-query'
import { formatDate } from '#/lib/format-date'

import type { DataClient } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'

/**
 * Live readings an instrument reports as it runs (migration 0068): the feeds it
 * has, each feed's latest value and limits, and a feed's readings over a window.
 * The agent beside the instrument writes them; the page only reads, and asks
 * again every few seconds while it is open.
 */
export type LimitState = 'ok' | 'low' | 'high'

export interface FeedRow {
  id: string
  /** The instrument, storage unit or room the feed belongs to. */
  ownerId: string
  instrumentId: string | null
  storageUnitId: string | null
  storageRoomId: string | null
  name: string
  unit: string | null
  lowLimit: number | null
  highLimit: number | null
  limitState: LimitState
  lastValue: number | null
  lastAt: string | null
  readingCount: number
  outOfRangeSince: string | null
}

interface FeedWire {
  id: string
  instrument_id: string | null
  storage_unit_id: string | null
  storage_room_id: string | null
  out_of_range_since: string | null
  name: string
  unit: string | null
  low_limit: number | null
  high_limit: number | null
  limit_state: LimitState
  last_value: number | null
  last_at: string | null
  reading_count: number | string
}

export interface SeriesPoint {
  at: number
  min: number
  avg: number
  max: number
  readings: number
}

interface SeriesWire {
  bucket_at: string
  min_value: number
  avg_value: number
  max_value: number
  readings: number | string
}

export const LIVE_WINDOWS = [
  { id: '15m', minutes: 15 },
  { id: '1h', minutes: 60 },
  { id: '6h', minutes: 360 },
  { id: '24h', minutes: 1440 },
  { id: '7d', minutes: 10_080 },
] as const

export type LiveWindowId = (typeof LIVE_WINDOWS)[number]['id']

/** A feed that has not reported for this long is no longer coming in live. */
export const FEED_QUIET_SECONDS = 120

export const liveFeedQueryKeys = {
  feeds: (instrumentId: string) =>
    ['ui-port', 'instruments', 'feeds', instrumentId] as const,
  series: (feedId: string, windowId: string) =>
    ['ui-port', 'instruments', 'feed-series', feedId, windowId] as const,
}

const FEED_FIELDS =
  'id,instrument_id,storage_unit_id,storage_room_id,name,unit,low_limit,high_limit,limit_state,last_value,last_at,reading_count,out_of_range_since'

function toFeed(row: FeedWire): FeedRow {
  return {
    id: row.id,
    ownerId: (row.instrument_id ?? row.storage_unit_id ?? row.storage_room_id)!,
    instrumentId: row.instrument_id,
    storageUnitId: row.storage_unit_id,
    storageRoomId: row.storage_room_id,
    outOfRangeSince: row.out_of_range_since,
    name: row.name,
    unit: row.unit,
    lowLimit: row.low_limit,
    highLimit: row.high_limit,
    limitState: row.limit_state,
    lastValue: row.last_value,
    lastAt: row.last_at,
    readingCount: Number(row.reading_count),
  }
}

export function useInstrumentFeeds(
  instrumentId: string,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: liveFeedQueryKeys.feeds(instrumentId),
    enabled: instrumentId.length > 0,
    queryFn: () =>
      client
        .list<FeedWire>(
          'instrument_feeds',
          `?select=${FEED_FIELDS}&instrument_id=eq.${encodeURIComponent(instrumentId)}&order=name.asc&limit=100`,
        )
        .then((rows) => rows.map(toFeed)),
    // Live: ask again every few seconds while the page is open and visible.
    refetchInterval: 3000,
    staleTime: 1000,
  })
}

export type StoragePlaceKind = 'unit' | 'room'

/** The measurements kept for a freezer, other storage unit or room (migration 0090). */
export function useStorageFeeds(
  kind: StoragePlaceKind,
  placeId: string,
  client: DataClient = notebookDataClient,
) {
  const column = kind === 'unit' ? 'storage_unit_id' : 'storage_room_id'

  return useQuery({
    queryKey: liveFeedQueryKeys.feeds(placeId),
    enabled: placeId.length > 0,
    queryFn: () =>
      client
        .list<FeedWire>(
          'instrument_feeds',
          `?select=${FEED_FIELDS}&${column}=eq.${encodeURIComponent(placeId)}&order=name.asc&limit=100`,
        )
        .then((rows) => rows.map(toFeed)),
    refetchInterval: 10_000,
    staleTime: 1000,
  })
}

/** Every freezer and room measurement that is outside its limits right now. */
export const outOfRangeQueryKey = [
  'ui-port',
  'storage',
  'out-of-range-feeds',
] as const

export function useOutOfRangeStorageFeeds(
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: outOfRangeQueryKey,
    queryFn: () =>
      client
        .list<FeedWire>(
          'instrument_feeds',
          `?select=${FEED_FIELDS}&limit_state=neq.ok&or=(storage_unit_id.not.is.null,storage_room_id.not.is.null)&order=out_of_range_since.asc&limit=200`,
        )
        .then((rows) => rows.map(toFeed)),
    refetchInterval: 30_000,
    staleTime: 5000,
  })
}

/** Log a reading by hand, for example a daily temperature check. */
export async function logStorageReading(
  input: {
    kind: StoragePlaceKind
    placeId: string
    feed: string
    value: number
    unit?: string | null
    at?: string | null
  },
  client: DataClient = notebookDataClient,
): Promise<{ stored: number; feeds: number }> {
  return client.rpc('record_storage_readings', {
    p_unit_id: input.kind === 'unit' ? input.placeId : null,
    p_room_id: input.kind === 'room' ? input.placeId : null,
    p_readings: [
      {
        feed: input.feed.trim(),
        value: input.value,
        ...(input.unit?.trim() ? { unit: input.unit.trim() } : {}),
        ...(input.at ? { at: input.at } : {}),
      },
    ],
  })
}

export function windowStart(windowId: LiveWindowId, now: number): number {
  const minutes = LIVE_WINDOWS.find((w) => w.id === windowId)?.minutes ?? 60

  return now - minutes * 60_000
}

export function useFeedSeries(
  feedId: string | null,
  windowId: LiveWindowId,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: liveFeedQueryKeys.series(feedId ?? '', windowId),
    enabled: Boolean(feedId),
    queryFn: async () => {
      const until = Date.now()

      const rows = await client.rpc<SeriesWire[]>(
        'list_instrument_feed_series',
        {
          p_feed_id: feedId,
          p_since: new Date(windowStart(windowId, until)).toISOString(),
          p_until: new Date(until).toISOString(),
          p_buckets: 240,
        },
      )

      return {
        since: windowStart(windowId, until),
        until,
        points: rows.map((row): SeriesPoint => ({
          at: Date.parse(row.bucket_at),
          min: row.min_value,
          avg: row.avg_value,
          max: row.max_value,
          readings: Number(row.readings),
        })),
      }
    },
    refetchInterval: 3000,
    staleTime: 1000,
  })
}

export async function setFeedLimits(
  input: {
    feedId: string
    low: number | null
    high: number | null
    unit?: string | null
  },
  client: DataClient = notebookDataClient,
): Promise<FeedRow> {
  return toFeed(
    await client.rpc<FeedWire>('set_instrument_feed_limits', {
      p_feed_id: input.feedId,
      p_low: input.low,
      p_high: input.high,
      p_unit: input.unit ?? null,
    }),
  )
}

export async function removeFeed(
  feedId: string,
  client: DataClient = notebookDataClient,
): Promise<void> {
  await client.rpc('remove_instrument_feed', { p_feed_id: feedId })
}

/** Whether a feed is still coming in: reported within the last couple of minutes. */
export function feedIsLive(
  feed: Pick<FeedRow, 'lastAt'>,
  now: number,
): boolean {
  return (
    feed.lastAt !== null &&
    now - Date.parse(feed.lastAt) <= FEED_QUIET_SECONDS * 1000
  )
}

/** A reading for display: enough digits to be useful, no trailing noise. */
export function formatReadingValue(value: number | null): string {
  if (value === null) return '—'
  const abs = Math.abs(value)
  const digits = abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 10 ? 2 : 3

  return Number(value.toFixed(digits)).toLocaleString('en-GB', {
    maximumFractionDigits: digits,
  })
}

/** "5 s ago", "3 min ago", "2 h ago", or the date for anything older. */
export function formatAgo(iso: string | null, now: number): string {
  if (!iso) return '—'
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))

  if (seconds < 60) return `${seconds} s ago`

  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`

  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`

  return formatDate(iso)
}

export interface ChartGeometry {
  line: string
  band: string
  yMin: number
  yMax: number
  x: (at: number) => number
  y: (value: number) => number
}

/**
 * Lays a series out in a width by height box: the average as a line, and the
 * min to max spread as a band behind it. Limits stretch the vertical range so a
 * line that crosses one is seen to.
 */
export function layoutSeries(
  points: SeriesPoint[],
  window: { since: number; until: number },
  box: { width: number; height: number },
  limits: { low: number | null; high: number | null } = {
    low: null,
    high: null,
  },
): ChartGeometry {
  const values = points.flatMap((p) => [p.min, p.max])

  if (limits.low !== null) values.push(limits.low)

  if (limits.high !== null) values.push(limits.high)
  let yMin = values.length ? Math.min(...values) : 0
  let yMax = values.length ? Math.max(...values) : 1

  if (yMax === yMin) {
    yMax += 1
    yMin -= 1
  }

  const pad = (yMax - yMin) * 0.08
  yMin -= pad
  yMax += pad
  const span = Math.max(1, window.until - window.since)
  const x = (at: number) => ((at - window.since) / span) * box.width

  const y = (value: number) =>
    box.height - ((value - yMin) / (yMax - yMin)) * box.height

  const f = (n: number) => n.toFixed(1)

  const line = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${f(x(p.at))},${f(y(p.avg))}`)
    .join(' ')

  const top = points.map((p) => `${f(x(p.at))},${f(y(p.max))}`)

  const bottom = points
    .slice()
    .reverse()
    .map((p) => `${f(x(p.at))},${f(y(p.min))}`)

  const band =
    points.length > 1 ? `M${top.join(' L')} L${bottom.join(' L')} Z` : ''

  return { line, band, yMin, yMax, x, y }
}

/** The window's readings as a CSV a spreadsheet opens. */
export function seriesCsv(feed: FeedRow, points: SeriesPoint[]): string {
  const unit = feed.unit ? ` (${feed.unit})` : ''
  const label = `${feed.name}${unit}`.replace(/"/g, '""')
  const lines = [`Time,"${label} average",minimum,maximum,readings`]
  const clean = (value: number) => Number(value.toPrecision(10))

  for (const p of points) {
    lines.push(
      [
        new Date(p.at).toISOString(),
        clean(p.avg),
        clean(p.min),
        clean(p.max),
        p.readings,
      ].join(','),
    )
  }

  return `${lines.join('\n')}\n`
}
