import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Icon } from '#/components/v3/icons'
import { LocationInput } from '#/components/v3/samples/location-field'
import { Button } from '#/components/v3/ui/button'
import { Notice } from '#/components/v3/ui/alert'
import { Input } from '#/components/v3/ui/input'
import { Skeleton } from '#/components/v3/ui/skeleton'
import { Tooltip } from '#/components/v3/ui/tooltip'
import { rich, t } from '#/copy'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  describePlace,
  fetchBoxChoices,
  fetchBoxPositions,
  firstFreePosition,
  positionKeys,
  rowLetter,
} from '#/lib/storage-positions'
import type {
  BoxChoice,
  PlaceChoice,
  PositionCell,
} from '#/lib/storage-positions'
import { cn } from '#/lib/utils'

/** Boxes grouped by the freezer (or shelf, or room) that holds them. */
function groupBoxes(boxes: readonly BoxChoice[]) {
  const groups = new Map<string, { heading: string; boxes: BoxChoice[] }>()
  for (const box of boxes) {
    const heading = box.above.slice(0, 3).join(' / ')
    const group = groups.get(heading) ?? { heading, boxes: [] }
    group.boxes.push(box)
    groups.set(heading, group)
  }
  return [...groups.values()]
}

/**
 * Pick the place a sample goes: find a box in the storage set up under
 * Settings, then click a free position in its grid. Occupied positions show
 * who is there and can't be chosen. A place that isn't in the storage setup
 * can still be typed in when `allowText` is set, so a sample on a bench or in
 * a shared instrument isn't blocked.
 */
export function PositionPicker({
  value,
  onChange,
  currentPositionId = null,
  currentBoxId = null,
  allowText = true,
  canManageStorage = false,
  textLocations,
}: {
  value: PlaceChoice | null
  onChange: (choice: PlaceChoice | null) => void
  /** The position the sample holds now; it shows as "here" and can't be chosen. */
  currentPositionId?: string | null
  /** The box that position is in; the picker opens on it. */
  currentBoxId?: string | null
  /** Offer typing a place that isn't in a box. */
  allowText?: boolean
  /** Show a link to set storage up when there are no boxes. */
  canManageStorage?: boolean
  textLocations?: readonly string[]
}) {
  const boxes = useQuery({
    queryKey: positionKeys.boxes,
    queryFn: () => fetchBoxChoices(notebookDataClient),
    staleTime: 15_000,
    retry: false,
  })
  const [query, setQuery] = useState('')
  const [boxId, setBoxId] = useState<string | null>(
    value?.kind === 'position' ? value.box.id : null,
  )
  const [typing, setTyping] = useState(value?.kind === 'text')

  const list = boxes.data ?? []
  const noBoxes = boxes.isSuccess && list.length === 0
  // Without any boxes (or without permission to read them) typing is the only way.
  const textOnly = noBoxes || boxes.isError
  const showText = allowText && (typing || textOnly)

  const needle = query.trim().toLowerCase()
  const shown = useMemo(
    () =>
      needle
        ? list.filter((box) =>
            `${box.path} ${box.code ?? ''}`.toLowerCase().includes(needle),
          )
        : list,
    [list, needle],
  )
  const box = list.find((candidate) => candidate.id === boxId) ?? null

  // Open on the box the sample is in, else the first box with room.
  const opening = useRef(true)
  useEffect(() => {
    if (boxId || !list.length || value) return
    setBoxId(
      list.find((b) => b.id === currentBoxId)?.id ??
        list.find((b) => b.free > 0)?.id ??
        list[0].id,
    )
  }, [boxId, currentBoxId, list, value])

  if (boxes.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {textOnly ? (
        <Notice icon="info">
          {canManageStorage
            ? rich('library.samples.positionPicker.noBoxesAdmin', {
                link: (text) => (
                  <Link to="/settings/storage" className="underline">
                    {text}
                  </Link>
                ),
              })
            : t('library.samples.positionPicker.noBoxes')}
        </Notice>
      ) : (
        <div className="grid min-h-0 gap-3 md:grid-cols-[minmax(0,13.5rem)_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col gap-2">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('library.samples.positionPicker.findABox')}
              aria-label={t('library.samples.positionPicker.findABox')}
              autoComplete="off"
            />
            <div
              role="listbox"
              aria-label={t('library.samples.positionPicker.boxes')}
              className="max-h-72 min-h-24 overflow-auto rounded-md border border-border md:max-h-[27rem]"
            >
              {shown.length === 0 ? (
                <p className="m-0 p-3 text-label text-fg-muted">
                  {t('library.samples.positionPicker.noBoxMatches')}
                </p>
              ) : (
                groupBoxes(shown).map((group) => (
                  <div key={group.heading} role="group">
                    <div
                      title={group.heading}
                      className="sticky top-0 truncate border-b border-border-subtle bg-surface-muted px-2.5 py-1 text-label font-medium text-fg-muted"
                    >
                      {group.heading}
                    </div>
                    {group.boxes.map((candidate) => (
                      <button
                        key={candidate.id}
                        type="button"
                        role="option"
                        aria-selected={candidate.id === boxId}
                        ref={(element) => {
                          // Bring the opening box into view once; after that
                          // the person is scrolling the list themselves.
                          if (
                            element &&
                            opening.current &&
                            candidate.id === boxId
                          ) {
                            opening.current = false
                            // jsdom has no scrollIntoView.
                            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                            element.scrollIntoView?.({ block: 'nearest' })
                          }
                        }}
                        onClick={() => {
                          opening.current = false
                          setBoxId(candidate.id)
                        }}
                        className={cn(
                          'flex w-full items-center gap-2 border-b border-border-subtle px-2.5 py-1.5 text-left hover:bg-surface-hover',
                          candidate.id === boxId &&
                            'bg-selection hover:bg-selection',
                        )}
                      >
                        <Icon
                          name="box"
                          size={14}
                          className="shrink-0 text-fg-muted"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body">
                            {candidate.name}
                          </span>
                          <span className="block truncate text-label text-fg-muted">
                            {candidate.above.slice(3).join(' · ') || ' '}
                          </span>
                        </span>
                        <span
                          className={cn(
                            'num shrink-0 text-label',
                            candidate.free === 0
                              ? 'text-warning-text'
                              : 'text-fg-muted',
                          )}
                        >
                          {candidate.free === 0
                            ? t('library.samples.positionPicker.full')
                            : t('library.samples.positionPicker.free', {
                                count: candidate.free,
                              })}
                        </span>
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
          <BoxGrid
            box={box}
            value={value?.kind === 'position' ? value.position.id : null}
            currentPositionId={currentPositionId}
            onPick={(position) => {
              if (!box) return
              setTyping(false)
              onChange({ kind: 'position', position, box })
            }}
          />
        </div>
      )}

      {value?.kind === 'position' && !typing ? (
        <p role="status" className="m-0 text-label text-fg-muted">
          {rich('library.samples.positionPicker.willGoTo', {
            place: <strong className="text-fg">{describePlace(value)}</strong>,
          })}
        </p>
      ) : null}

      {allowText && !textOnly ? (
        <button
          type="button"
          className="w-fit text-label text-link underline-offset-2 hover:underline"
          onClick={() => {
            const next = !typing
            setTyping(next)
            if (next) onChange({ kind: 'text', text: '' })
            else onChange(null)
          }}
        >
          {typing
            ? t('library.samples.positionPicker.useABox')
            : t('library.samples.positionPicker.notInABox')}
        </button>
      ) : null}

      {showText ? (
        <div className="flex flex-col gap-1 text-label">
          <span className="font-medium text-fg">
            {t('library.samples.positionPicker.typeAPlace')}
          </span>
          <LocationInput
            value={value?.kind === 'text' ? value.text : ''}
            onChange={(text) => onChange({ kind: 'text', text })}
            locations={textLocations}
            aria-label={t('library.samples.positionPicker.typeAPlace')}
          />
          <span className="text-fg-muted">
            {t('library.samples.positionPicker.typedPlaceHint')}
          </span>
        </div>
      ) : null}
    </div>
  )
}

/** The grid of one box: columns across, letters down. */
function BoxGrid({
  box,
  value,
  currentPositionId,
  onPick,
}: {
  box: BoxChoice | null
  value: string | null
  currentPositionId: string | null
  onPick: (position: PositionCell) => void
}) {
  const positions = useQuery({
    queryKey: positionKeys.box(box?.id ?? 'none'),
    queryFn: () => fetchBoxPositions(notebookDataClient, box!.id),
    enabled: Boolean(box),
    staleTime: 5_000,
  })
  const cells = positions.data ?? []
  const next = firstFreePosition(cells)

  if (!box) {
    return (
      <div className="flex min-h-24 items-center justify-center rounded-md border border-dashed border-border p-4 text-label text-fg-muted">
        {t('library.samples.positionPicker.pickABox')}
      </div>
    )
  }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-body font-medium">{box.name}</div>
          <div className="truncate text-label text-fg-muted">
            {box.above.join(' · ')}
          </div>
        </div>
        <Button size="sm" disabled={!next} onClick={() => next && onPick(next)}>
          {t('library.samples.positionPicker.firstFree')}
        </Button>
      </div>
      {positions.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : positions.isError ? (
        <Notice tone="bad">
          {t('library.samples.positionPicker.couldNotLoadBox')}
        </Notice>
      ) : (
        <div className="overflow-auto rounded-md border border-border p-2">
          <div
            role="grid"
            aria-label={t('library.samples.positionPicker.gridAria', {
              name: box.name,
            })}
            className="grid w-max gap-1"
            style={{
              gridTemplateColumns: `1.25rem repeat(${box.cols}, 1.75rem)`,
            }}
          >
            <span aria-hidden="true" />
            {Array.from({ length: box.cols }, (_, col) => (
              <span
                key={col}
                aria-hidden="true"
                className="num text-center text-label text-fg-muted"
              >
                {col + 1}
              </span>
            ))}
            {Array.from({ length: box.rows }, (_, row) => (
              <PositionRow
                key={row}
                row={row}
                cols={box.cols}
                cells={cells}
                value={value}
                currentPositionId={currentPositionId}
                onPick={onPick}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-label text-fg-muted">
            <Legend swatch="border border-border bg-surface">
              {t('library.samples.positionPicker.legendFree')}
            </Legend>
            <Legend swatch="bg-surface-disabled border border-border-strong">
              {t('library.samples.positionPicker.legendTaken')}
            </Legend>
            <Legend swatch="bg-primary">
              {t('library.samples.positionPicker.legendChosen')}
            </Legend>
          </div>
        </div>
      )}
    </div>
  )
}

function Legend({
  swatch,
  children,
}: {
  swatch: string
  children: React.ReactNode
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={cn('size-3 rounded-sm', swatch)} />
      {children}
    </span>
  )
}

function PositionRow({
  row,
  cols,
  cells,
  value,
  currentPositionId,
  onPick,
}: {
  row: number
  cols: number
  cells: readonly PositionCell[]
  value: string | null
  currentPositionId: string | null
  onPick: (position: PositionCell) => void
}) {
  return (
    <>
      <span
        aria-hidden="true"
        className="num flex items-center justify-center text-label text-fg-muted"
      >
        {rowLetter(row)}
      </span>
      {Array.from({ length: cols }, (_, col) => {
        const cell = cells.find((c) => c.rowIndex === row && c.colIndex === col)
        if (!cell) return <span key={col} />
        const here = cell.id === currentPositionId
        const chosen = cell.id === value
        const blocked = cell.status !== 'available'
        const reason = here
          ? t('library.samples.positionPicker.here')
          : cell.status === 'occupied'
            ? t('library.samples.positionPicker.heldBy', {
                identifier: cell.occupant?.identifier ?? '',
              })
            : cell.status === 'quarantined'
              ? t('library.samples.positionPicker.setAside')
              : cell.status === 'missing'
                ? t('library.samples.positionPicker.missing')
                : cell.label
        return (
          <Tooltip key={col} content={reason}>
            <button
              type="button"
              role="gridcell"
              aria-label={`${cell.label}: ${reason}`}
              aria-pressed={chosen}
              aria-disabled={blocked || undefined}
              onClick={() => {
                if (!blocked) onPick(cell)
              }}
              className={cn(
                'num flex size-7 items-center justify-center rounded-sm border text-[10px] leading-none',
                chosen
                  ? 'border-primary bg-primary text-primary-foreground'
                  : blocked
                    ? 'cursor-not-allowed border-border-strong bg-surface-disabled text-fg-faint'
                    : 'border-border bg-surface text-fg-muted hover:border-selection-border hover:bg-selection',
                here && 'ring-2 ring-selection-border',
                cell.status === 'quarantined' || cell.status === 'missing'
                  ? 'bg-[repeating-linear-gradient(135deg,transparent_0_3px,var(--hatch)_3px_4px)]'
                  : null,
              )}
            >
              {here ? '•' : cell.status === 'occupied' ? '●' : cell.label}
            </button>
          </Tooltip>
        )
      })}
    </>
  )
}
