import * as React from 'react'
import { Link } from '@tanstack/react-router'

import { t } from '#/copy'
import { Icon } from '#/components/icons'
import { Button } from '#/components/ui/button'
import { Select } from '#/components/ui/select'
import { Sheet, SheetContent } from '#/components/ui/sheet'
import {
  openBesideOnAlt,
  useWorkspaceNavigation,
} from '#/components/workspace/workspace-navigation'
import {
  daysSinceStart,
  formatPartDate,
  partDate,
  partIsLate,
} from '#/lib/experiment-parts'
import type { PartProgress } from '#/lib/experiment-parts'
import { notebookOutline } from '#/lib/notebook-outline'
import { cn } from '#/lib/utils'

/** The URL of a part: `/experiments/<id>/notebook/<number>`. */
export function partHref(expId: string, number: number): string {
  return `/experiments/${expId}/notebook/${number}`
}

/** "Day 3 · Mon 2 Nov", or "Day 3 · Today" on the day itself. */
export function partDayLine(
  part: Pick<PartProgress, 'dayOffset'>,
  startedAt: string,
  now: Date = new Date(),
): string {
  const day = String(part.dayOffset)
  if (daysSinceStart(startedAt, now) === part.dayOffset) {
    return t('notebook.parts.dayToday', { day })
  }
  return t('notebook.parts.dayOn', {
    day,
    date: formatPartDate(partDate(startedAt, part.dayOffset)),
  })
}

/** A quiet "Late" beside the date of a part whose day has passed. */
function LateMark({
  part,
  startedAt,
}: {
  part: Pick<PartProgress, 'state' | 'dayOffset'>
  startedAt: string
}) {
  if (!partIsLate(part, startedAt)) return null
  return (
    <span title={t('notebook.parts.lateTitle')}>
      {' · '}
      {t('notebook.parts.late')}
    </span>
  )
}

function PartMark({
  state,
  signed = false,
  awaiting = false,
}: {
  state: PartProgress['state']
  signed?: boolean
  awaiting?: boolean
}) {
  if (signed) {
    return (
      <Icon
        name="lock"
        size={12}
        aria-hidden="true"
        className="text-success-text"
      />
    )
  }
  if (awaiting) {
    return (
      <Icon
        name="lock"
        size={12}
        aria-hidden="true"
        className="text-fg-muted"
      />
    )
  }
  if (state === 'done') {
    return (
      <Icon
        name="check"
        size={13}
        strokeWidth={2.5}
        aria-hidden="true"
        className="text-success-text"
      />
    )
  }
  if (state === 'now') {
    return (
      <span
        aria-hidden="true"
        className="inline-block size-2 shrink-0 rounded-full bg-primary"
      />
    )
  }
  return (
    <Icon name="clock" size={12} aria-hidden="true" className="text-fg-muted" />
  )
}

/** The state of a part in words, with its signature where it needs one. */
function partStateText(
  part: Pick<PartProgress, 'state' | 'signed' | 'awaitingSignOff'>,
): string {
  if (part.signed) return t('notebook.partSignoff.stateSigned')
  if (part.awaitingSignOff) return t('notebook.partSignoff.stateAwaiting')
  return stateText(part.state)
}

function stateText(state: PartProgress['state']): string {
  if (state === 'done') return t('notebook.parts.stateDone')
  if (state === 'now') return t('notebook.parts.stateNow')
  return t('notebook.parts.stateLater')
}

/**
 * The parts of an experiment, as a strip at the top of the notebook: number,
 * title, day and date, and whether each is done, the one to work on now, or up
 * next. On a phone it is a progress bar with a picker, so the page gains one
 * row, not a header.
 */
export function PartsStrip({
  expId,
  parts,
  shown,
  startedAt,
  actions,
}: {
  expId: string
  parts: readonly PartProgress[]
  shown: PartProgress
  startedAt: string
  /** The menu for adding and changing parts, when the person may. */
  actions?: React.ReactNode
}) {
  return (
    <div data-testid="parts-strip" className="my-3">
      <DesktopStrip
        expId={expId}
        parts={parts}
        shown={shown}
        startedAt={startedAt}
        actions={actions}
      />
      <PhonePicker
        expId={expId}
        parts={parts}
        shown={shown}
        startedAt={startedAt}
        actions={actions}
      />
    </div>
  )
}

function DesktopStrip({
  expId,
  parts,
  shown,
  startedAt,
  actions,
}: {
  expId: string
  parts: readonly PartProgress[]
  shown: PartProgress
  startedAt: string
  actions?: React.ReactNode
}) {
  const workspace = useWorkspaceNavigation()
  const selected = React.useRef<HTMLAnchorElement | null>(null)
  React.useEffect(() => {
    selected.current?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    })
  }, [shown.id])
  return (
    <div className="flex items-stretch gap-2 max-md:hidden">
      <nav
        aria-label={t('notebook.parts.label')}
        className="grid min-w-0 flex-1 auto-cols-[minmax(10rem,1fr)] grid-flow-col gap-1.5 overflow-x-auto"
      >
        {parts.map((part) => {
          const href = partHref(expId, part.number)
          const title = t('notebook.parts.partTitle', {
            number: String(part.number),
            title: part.title,
          })
          return (
            <Link
              key={part.id}
              ref={part.id === shown.id ? selected : undefined}
              to="/experiments/$expId/notebook/$part"
              params={{ expId, part: String(part.number) }}
              aria-current={part.id === shown.id ? 'page' : undefined}
              title={`${title}. ${t('notebook.parts.openBeside')}`}
              onClick={(event) =>
                openBesideOnAlt(workspace, href, event, title)
              }
              className={cn(
                'group flex min-w-0 flex-col gap-0.5 rounded-sm border-t-[3px] px-2.5 pb-1.5 pt-1.5 no-underline hover:bg-surface-hover',
                part.state === 'done' && 'border-success',
                part.state === 'now' && 'border-primary',
                part.state === 'later' && 'border-border-strong',
                part.id === shown.id && 'bg-accent',
              )}
            >
              <span className="flex min-w-0 items-center gap-1.5 text-body text-fg">
                <PartMark
                  state={part.state}
                  signed={part.signed}
                  awaiting={part.awaitingSignOff}
                />
                <span
                  className={cn(
                    'truncate',
                    part.state === 'now' && 'font-semibold',
                    part.state === 'later' && 'text-fg-muted',
                  )}
                >
                  {title}
                </span>
                <span className="sr-only">{partStateText(part)}</span>
              </span>
              <span className="truncate text-label text-fg-muted">
                {partDayLine(part, startedAt)}
                <LateMark part={part} startedAt={startedAt} />
              </span>
            </Link>
          )
        })}
      </nav>
      {actions ? <div className="shrink-0 self-center">{actions}</div> : null}
    </div>
  )
}

function PhonePicker({
  expId,
  parts,
  shown,
  startedAt,
  actions,
}: {
  expId: string
  parts: readonly PartProgress[]
  shown: PartProgress
  startedAt: string
  actions?: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const previous = parts.find((part) => part.number === shown.number - 1)
  const next = parts.find((part) => part.number === shown.number + 1)
  return (
    <div className="flex flex-col gap-2 md:hidden">
      <div aria-hidden="true" className="grid auto-cols-fr grid-flow-col gap-1">
        {parts.map((part) => (
          <span
            key={part.id}
            className={cn(
              'h-1 rounded-full',
              part.state === 'done' && 'bg-success',
              part.state === 'now' && 'bg-primary',
              part.state === 'later' && 'bg-border-strong',
            )}
          />
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <PartStepLink
          expId={expId}
          part={previous}
          label={t('notebook.parts.previousAria')}
          icon="chevronLeft"
        />
        <Button
          type="button"
          className="h-10 min-w-0 flex-1 justify-between px-3"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          <span className="truncate">
            {t('notebook.parts.pickerLabel', {
              number: String(shown.number),
              total: String(parts.length),
              title: shown.title,
            })}
          </span>
          <Icon name="chevronDown" size={14} aria-hidden="true" />
        </Button>
        <PartStepLink
          expId={expId}
          part={next}
          label={t('notebook.parts.nextAria')}
          icon="chevronRight"
        />
        {actions}
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" title={t('notebook.parts.listTitle')}>
          <ol className="m-0 list-none overflow-y-auto p-0">
            {parts.map((part) => (
              <li key={part.id} className="border-b border-border-subtle">
                <Link
                  to="/experiments/$expId/notebook/$part"
                  params={{ expId, part: String(part.number) }}
                  onClick={() => setOpen(false)}
                  aria-current={part.id === shown.id ? 'page' : undefined}
                  className={cn(
                    'flex items-start gap-3 px-4 py-3 no-underline',
                    part.id === shown.id && 'bg-accent',
                  )}
                >
                  <span className="mt-1 flex w-4 justify-center">
                    <PartMark
                      state={part.state}
                      signed={part.signed}
                      awaiting={part.awaitingSignOff}
                    />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span
                      className={cn(
                        'text-doc text-fg',
                        part.state === 'later' && 'text-fg-muted',
                      )}
                    >
                      {t('notebook.parts.partTitle', {
                        number: String(part.number),
                        title: part.title,
                      })}
                    </span>
                    <span className="text-label text-fg-muted">
                      {partDayLine(part, startedAt)}
                      <LateMark part={part} startedAt={startedAt} />
                      {part.stepCount > 0
                        ? ` · ${t('notebook.parts.stepsOf', {
                            done: String(part.stepsDone),
                            total: String(part.stepCount),
                          })}`
                        : ''}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function PartStepLink({
  expId,
  part,
  label,
  icon,
}: {
  expId: string
  part: PartProgress | undefined
  label: string
  icon: 'chevronLeft' | 'chevronRight'
}) {
  if (!part) {
    return (
      <Button
        type="button"
        disabled
        aria-label={label}
        className="size-10 shrink-0 p-0"
      >
        <Icon name={icon} size={16} aria-hidden="true" />
      </Button>
    )
  }
  return (
    <Button
      className="size-10 shrink-0 p-0"
      aria-label={label}
      render={
        <Link
          to="/experiments/$expId/notebook/$part"
          params={{ expId, part: String(part.number) }}
        />
      }
    >
      <Icon name={icon} size={16} aria-hidden="true" />
    </Button>
  )
}

/**
 * The cards at the foot of a part: where you came from and where you go next,
 * with who did the part before and when the next one falls.
 */
export function PartFooter({
  expId,
  parts,
  shown,
  startedAt,
  nameOf,
}: {
  expId: string
  parts: readonly PartProgress[]
  shown: PartProgress
  startedAt: string
  nameOf: (userId: string) => string
}) {
  const workspace = useWorkspaceNavigation()
  const previous = parts.find((part) => part.number === shown.number - 1)
  const next = parts.find((part) => part.number === shown.number + 1)
  if (!previous && !next) return null
  const card = (part: PartProgress, direction: 'previous' | 'next') => {
    const href = partHref(expId, part.number)
    const title = t('notebook.parts.partTitle', {
      number: String(part.number),
      title: part.title,
    })
    const when = t(
      direction === 'previous'
        ? 'notebook.parts.previousCard'
        : 'notebook.parts.nextCard',
      {
        day: String(part.dayOffset),
        date: formatPartDate(partDate(startedAt, part.dayOffset)),
      },
    )
    return (
      <Link
        to="/experiments/$expId/notebook/$part"
        params={{ expId, part: String(part.number) }}
        onClick={(event) => openBesideOnAlt(workspace, href, event, title)}
        data-testid={`part-${direction}`}
        className={cn(
          'flex min-w-0 flex-col gap-0.5 rounded-lg border border-border px-4 py-3 no-underline hover:bg-surface-hover',
          direction === 'next' && 'items-end text-right md:col-start-2',
        )}
      >
        <span className="flex items-center gap-1 text-label text-fg-muted">
          {direction === 'previous' ? (
            <Icon name="chevronLeft" size={12} aria-hidden="true" />
          ) : null}
          {when}
          {direction === 'next' ? (
            <Icon name="chevronRight" size={12} aria-hidden="true" />
          ) : null}
        </span>
        <span className="text-body font-semibold text-fg">{title}</span>
        <span className="flex items-center gap-1 text-label text-fg-muted">
          {part.state === 'done' && part.completedByUserId
            ? t('notebook.parts.doneBy', {
                name: nameOf(part.completedByUserId),
              })
            : partStateText(part)}
        </span>
      </Link>
    )
  }
  return (
    <nav
      aria-label={t('notebook.parts.label')}
      className="mt-6 grid gap-3 md:grid-cols-2"
    >
      {previous ? card(previous, 'previous') : null}
      {next ? card(next, 'next') : null}
    </nav>
  )
}

/** Above a part that is not the one to work on yet. */
export function UpNextBanner({
  expId,
  shown,
  current,
}: {
  expId: string
  shown: PartProgress
  current: PartProgress
}) {
  return (
    <section
      role="status"
      data-testid="part-up-next"
      className="my-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="m-0 text-body font-semibold text-fg">
          {t('notebook.parts.upNextTitle', { number: String(shown.number) })}
        </p>
        <p className="m-0 text-label text-fg-muted">
          {t(
            current.requiresSignOff && !current.signed
              ? 'notebook.partSignoff.upNextSigned'
              : 'notebook.parts.upNextBody',
            { previous: String(shown.number - 1 || current.number) },
          )}
        </p>
      </div>
      <Button
        render={
          <Link
            to="/experiments/$expId/notebook/$part"
            params={{ expId, part: String(current.number) }}
          />
        }
      >
        {t('notebook.parts.goToPart', { number: String(current.number) })}
      </Button>
    </section>
  )
}

/**
 * The Outline tab's list of parts with the sections inside each: a part opens
 * on a click and beside on Alt-click, and a section jumps to its heading.
 */
export function PartsOutline({
  expId,
  parts,
  shownPartId,
  blocks,
}: {
  expId: string
  parts: readonly PartProgress[]
  shownPartId: string
  blocks: ReadonlyArray<{
    id: string
    type: string
    order: number
    partId?: string | null
    payload: Record<string, unknown>
  }>
}) {
  const workspace = useWorkspaceNavigation()
  const sections = React.useMemo(() => {
    const byPart = new Map<string, { blockId: string; text: string }[]>()
    for (const entry of notebookOutline(blocks)) {
      if (entry.level !== 2) continue
      const part = blocks.find((block) => block.id === entry.blockId)?.partId
      if (!part) continue
      const list = byPart.get(part) ?? []
      if (!list.some((item) => item.blockId === entry.blockId)) {
        list.push({ blockId: entry.blockId, text: entry.text })
      }
      byPart.set(part, list)
    }
    return byPart
  }, [blocks])
  return (
    <nav
      aria-label={t('notebook.parts.outlineTitle')}
      data-testid="parts-outline"
      className="flex flex-col gap-1"
    >
      <p className="m-0 text-label font-semibold uppercase tracking-[0.06em] text-fg-muted">
        {t('notebook.parts.outlineTitle')}
      </p>
      <ol className="m-0 flex list-none flex-col p-0">
        {parts.map((part) => {
          const href = partHref(expId, part.number)
          const title = t('notebook.parts.partTitle', {
            number: String(part.number),
            title: part.title,
          })
          return (
            <li key={part.id} className="flex flex-col">
              <Link
                to="/experiments/$expId/notebook/$part"
                params={{ expId, part: String(part.number) }}
                aria-current={part.id === shownPartId ? 'page' : undefined}
                onClick={(event) =>
                  openBesideOnAlt(workspace, href, event, title)
                }
                className={cn(
                  'flex items-center gap-2 rounded-sm px-1.5 py-1 text-body no-underline hover:bg-surface-hover',
                  part.id === shownPartId ? 'font-semibold text-fg' : 'text-fg',
                  part.state === 'later' && 'text-fg-muted',
                )}
              >
                <span className="flex w-4 shrink-0 justify-center">
                  <PartMark
                    state={part.state}
                    signed={part.signed}
                    awaiting={part.awaitingSignOff}
                  />
                </span>
                <span className="min-w-0 flex-1 truncate">{title}</span>
                <span className="shrink-0 text-label text-fg-muted">
                  {t('notebook.parts.day', { day: String(part.dayOffset) })}
                </span>
              </Link>
              {(sections.get(part.id) ?? []).map((section) => (
                <Link
                  key={section.blockId}
                  to="/experiments/$expId/notebook/$part"
                  params={{ expId, part: String(part.number) }}
                  hash={`block-${section.blockId}`}
                  className="truncate rounded-sm py-0.5 pl-8 pr-1.5 text-label text-fg-muted no-underline hover:bg-surface-hover"
                >
                  {section.text}
                </Link>
              ))}
            </li>
          )
        })}
      </ol>
      <p className="m-0 mt-1 px-1.5 text-label text-fg-muted">
        {t('notebook.parts.openBeside')}
      </p>
    </nav>
  )
}

/** What an experiment's samples and data are shown for: every part, or one. */
export type PartFilterValue = 'all' | string

/**
 * The filter above the Samples and Data lists. Nothing shows for an experiment
 * without parts. An item that was not made in a part shows under every part.
 */
export function PartFilter({
  parts,
  value,
  onChange,
}: {
  parts: readonly Pick<PartProgress, 'id' | 'number' | 'title'>[]
  value: PartFilterValue
  onChange: (value: PartFilterValue) => void
}) {
  if (parts.length === 0) return null
  return (
    <label className="flex items-center gap-1.5">
      {t('notebook.parts.filterLabel')}
      <Select
        size="sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="all">{t('notebook.parts.filterAll')}</option>
        {parts.map((part) => (
          <option key={part.id} value={part.id}>
            {t('notebook.parts.partTitle', {
              number: String(part.number),
              title: part.title,
            })}
          </option>
        ))}
      </Select>
    </label>
  )
}

/** Whether an item made in `itemPartId` shows for the chosen filter. */
export function showsForPart(
  itemPartId: string | null | undefined,
  filter: PartFilterValue,
): boolean {
  return filter === 'all' || !itemPartId || itemPartId === filter
}
