import * as React from 'react'

import { FrozenSheetEvidencePanel } from '#/components/notebook/notebook-sheet-block'
import type { SheetCommentAnchor } from '#/lib/sheet-comment-anchor'
import { Badge } from '#/components/v3/ui/badge'
import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Icon } from '#/components/v3/icons'
import type { IconName } from '#/components/v3/icons'
import { diffRevisionEnvelopes } from '#/lib/revision-diff'
import type {
  CanonicalRevisionEnvelope,
  RevisionChange,
  RevisionChangeArea,
  RevisionChangeKind,
  RevisionDiffResult,
  RevisionTableDiffSummary,
} from '#/lib/revision-diff'
import { useRegisterShortcuts } from '#/components/shortcuts/shortcut-provider'
import { reviewShortcuts } from '#/lib/shortcut-scopes'
import { cn } from '#/lib/utils'
import { t } from '#/copy'

export interface RevisionDiffReviewProps {
  before: CanonicalRevisionEnvelope
  after: CanonicalRevisionEnvelope
  beforeLabel?: string
  afterLabel?: string
  className?: string
  onCommentTarget?: (anchor: SheetCommentAnchor) => void
}

const KINDS: RevisionChangeKind[] = ['added', 'removed', 'modified', 'moved']

// Display order matches the diff engine's internal area ordering so filtered
// controls follow the same sequence reviewers see changes in.
const AREA_ORDER: RevisionChangeArea[] = [
  'metadata',
  'blocks',
  'text',
  'checklists',
  'links',
  'tables',
  'formulas',
  'files',
]

const TABLE_DETAIL_BATCH = 100

const KIND_META: Record<
  RevisionChangeKind,
  {
    icon: IconName
    variant: 'add' | 'del' | 'chg' | 'kind'
  }
> = {
  added: { icon: 'plus', variant: 'add' },
  removed: { icon: 'x', variant: 'del' },
  modified: { icon: 'edit', variant: 'chg' },
  moved: { icon: 'move', variant: 'chg' },
}

export const areaLabel = (area: RevisionChange['area']) =>
  t(`projects.diffReview.areas.${area}`)

type ReviewItem =
  | { id: string; order: number; type: 'change'; change: RevisionChange }
  | {
      id: string
      order: number
      type: 'table'
      summary: RevisionTableDiffSummary
      visibleChanges: RevisionChange[]
    }

export function exactText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null) return 'null'
  if (value === undefined) return t('projects.diffReview.notPresent')
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}

export function focusChange(target: HTMLElement | undefined) {
  if (!target) return
  target.focus()
  const scrollIntoView: unknown = Reflect.get(target, 'scrollIntoView')
  if (typeof scrollIntoView === 'function') {
    scrollIntoView.call(target, { behavior: 'auto', block: 'nearest' })
  }
}

export function KindBadge({ kind }: { kind: RevisionChangeKind }) {
  const meta = KIND_META[kind]
  return (
    <Badge variant={meta.variant}>
      <Icon name={meta.icon} size={12} aria-hidden="true" />
      {t(`projects.diffReview.kinds.${kind}`)}
    </Badge>
  )
}

function ChangeValue({
  label,
  value,
  unit,
}: {
  label: string
  value: unknown
  unit?: string
}) {
  return (
    <div className="min-w-0 rounded-md border bg-surface px-3 py-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
        {label}
      </p>
      <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-xs leading-5 text-fg">
        {exactText(value)}
      </pre>
      {unit ? (
        <p className="mt-1 font-mono text-xs text-fg-muted">{unit}</p>
      ) : null}
    </div>
  )
}

export function ChangeBody({ change }: { change: RevisionChange }) {
  if (change.kind === 'moved') {
    return (
      <p className="mt-3 text-xs text-fg-muted">
        {t('projects.diffReview.position', {
          from: (change.beforeOrder ?? 0) + 1,
          to: (change.afterOrder ?? 0) + 1,
        })}
      </p>
    )
  }
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <ChangeValue
        label={t('projects.diffReview.before')}
        value={change.before}
        unit={change.beforeUnit}
      />
      <ChangeValue
        label={t('projects.diffReview.after')}
        value={change.after}
        unit={change.afterUnit}
      />
    </div>
  )
}

export function ChangeCard({
  change,
  active,
}: {
  change: RevisionChange
  active: boolean
}) {
  return (
    <article
      data-revision-change-id={change.id}
      tabIndex={-1}
      aria-current={active ? 'step' : undefined}
      className={cn(
        'rounded-lg border bg-surface p-3 outline-none',
        active && 'ring-2 ring-primary/40',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
            {areaLabel(change.area)}
          </p>
          <h3 className="break-words text-sm font-semibold">{change.label}</h3>
        </div>
        <KindBadge kind={change.kind} />
      </div>
      <ChangeBody change={change} />
    </article>
  )
}

function TableDiffCard({
  summary,
  changes,
  activeChangeId,
}: {
  summary: RevisionTableDiffSummary
  changes: RevisionChange[]
  activeChangeId?: string
}) {
  const [expanded, setExpanded] = React.useState(false)
  const [visibleLimit, setVisibleLimit] = React.useState(TABLE_DETAIL_BATCH)
  const rootRef = React.useRef<HTMLElement>(null)
  const activeDetailIndex = changes.findIndex(
    (change) => change.id === activeChangeId,
  )
  const visibleChanges = changes.slice(0, visibleLimit)

  React.useLayoutEffect(() => {
    if (activeDetailIndex < 0) return
    setExpanded(true)
    setVisibleLimit((current) => Math.max(current, activeDetailIndex + 1))
  }, [activeDetailIndex])

  React.useEffect(() => {
    if (!expanded || activeDetailIndex < 0 || !activeChangeId) return
    const target = Array.from(
      rootRef.current?.querySelectorAll<HTMLElement>(
        '[data-revision-change-id]',
      ) ?? [],
    ).find((element) => element.dataset.revisionChangeId === activeChangeId)
    focusChange(target)
  }, [activeChangeId, activeDetailIndex, expanded, visibleLimit])

  return (
    <section
      ref={rootRef}
      className={cn(
        'rounded-lg border bg-surface outline-none',
        activeDetailIndex >= 0 && 'ring-2 ring-primary/40',
      )}
    >
      <div className="flex flex-wrap items-center gap-3 p-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
            {t('projects.diffReview.areas.tables')}
          </p>
          <h3 className="text-sm font-semibold">{summary.label}</h3>
          <p className="mt-1 text-xs text-fg-muted">
            {t('projects.diffReview.table.rowsAdded', {
              count: summary.addedRows,
            })}{' '}
            ·{' '}
            {t('projects.diffReview.table.rowsRemoved', {
              count: summary.removedRows,
            })}
            {' · '}
            {t('projects.diffReview.table.cellsChanged', {
              count: summary.modifiedCells,
            })}{' '}
            ·{' '}
            {t('projects.diffReview.table.schemaChanges', {
              count: summary.schemaChanges,
            })}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          aria-expanded={expanded}
          aria-label={
            expanded
              ? t('projects.diffReview.table.hideFor', { label: summary.label })
              : t('projects.diffReview.table.showFor', { label: summary.label })
          }
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? (
            <Icon name="chevronDown" size={14} className="rotate-180" />
          ) : (
            <Icon name="chevronDown" size={14} />
          )}
          {expanded
            ? t('projects.diffReview.table.hideDetails')
            : t('projects.diffReview.table.showChanges', {
                count: changes.length,
              })}
        </Button>
      </div>
      {expanded ? (
        <ol
          className="divide-y border-t"
          aria-label={t('projects.diffReview.table.changesOf', {
            label: summary.label,
          })}
        >
          {visibleChanges.map((change) => (
            <li
              key={change.id}
              data-revision-change-id={change.id}
              tabIndex={-1}
              aria-current={change.id === activeChangeId ? 'step' : undefined}
              className="p-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-xs font-medium">{change.label}</p>
                <KindBadge kind={change.kind} />
              </div>
              <ChangeBody change={change} />
            </li>
          ))}
        </ol>
      ) : null}
      {expanded && visibleLimit < changes.length ? (
        <div className="border-t p-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              setVisibleLimit((current) =>
                Math.min(current + TABLE_DETAIL_BATCH, changes.length),
              )
            }
          >
            {t('projects.diffReview.table.showMore', {
              count: Math.min(
                TABLE_DETAIL_BATCH,
                changes.length - visibleLimit,
              ),
            })}
          </Button>
        </div>
      ) : null}
    </section>
  )
}

function changeMatchesFilters(
  change: RevisionChange,
  enabledKinds: Set<RevisionChangeKind>,
  enabledAreas: Set<RevisionChangeArea>,
): boolean {
  return enabledKinds.has(change.kind) && enabledAreas.has(change.area)
}

function buildReviewItems(
  diff: RevisionDiffResult,
  enabledKinds: Set<RevisionChangeKind>,
  enabledAreas: Set<RevisionChangeArea>,
): ReviewItem[] {
  const items: ReviewItem[] = diff.changes
    .filter(
      (change) =>
        !change.tableId &&
        changeMatchesFilters(change, enabledKinds, enabledAreas),
    )
    .map((change) => ({
      id: change.id,
      order: diff.changes.indexOf(change),
      type: 'change' as const,
      change,
    }))

  for (const summary of diff.tableSummaries) {
    const visibleChanges = summary.changes.filter((change) =>
      changeMatchesFilters(change, enabledKinds, enabledAreas),
    )
    if (visibleChanges.length === 0) continue
    items.push({
      id: `table-summary:${summary.tableId}`,
      order: diff.changes.indexOf(summary.changes[0]),
      type: 'table',
      summary,
      visibleChanges,
    })
  }
  return items.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

export function RevisionDiffReview({
  before,
  after,
  beforeLabel = t('projects.diffReview.earlier'),
  afterLabel = t('projects.diffReview.later'),
  className,
  onCommentTarget,
}: RevisionDiffReviewProps) {
  const diff = React.useMemo(
    () => diffRevisionEnvelopes(before, after),
    [after, before],
  )
  const [enabledKinds, setEnabledKinds] = React.useState(
    () => new Set<RevisionChangeKind>(KINDS),
  )
  const [enabledAreas, setEnabledAreas] = React.useState(
    () => new Set<RevisionChangeArea>(AREA_ORDER),
  )
  const [activeIndex, setActiveIndex] = React.useState(0)
  const rootRef = React.useRef<HTMLElement>(null)
  const areasInDiff = React.useMemo(
    () =>
      AREA_ORDER.filter((area) =>
        diff.changes.some((change) => change.area === area),
      ),
    [diff.changes],
  )
  const items = React.useMemo(
    () => buildReviewItems(diff, enabledKinds, enabledAreas),
    [diff, enabledKinds, enabledAreas],
  )
  const visibleChanges = React.useMemo(
    () =>
      diff.changes.filter((change) =>
        changeMatchesFilters(change, enabledKinds, enabledAreas),
      ),
    [diff.changes, enabledKinds, enabledAreas],
  )
  const activeChange: RevisionChange | undefined =
    visibleChanges.at(activeIndex)

  React.useEffect(() => {
    setActiveIndex((current) =>
      Math.min(current, Math.max(visibleChanges.length - 1, 0)),
    )
  }, [visibleChanges.length])

  React.useEffect(() => {
    if (!activeChange || activeChange.tableId) return
    const target = Array.from(
      rootRef.current?.querySelectorAll<HTMLElement>(
        '[data-revision-change-id]',
      ) ?? [],
    ).find((element) => element.dataset.revisionChangeId === activeChange.id)
    focusChange(target)
  }, [activeChange])

  function toggleKind(kind: RevisionChangeKind) {
    setEnabledKinds((current) => {
      const next = new Set(current)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  function toggleArea(area: RevisionChangeArea) {
    setEnabledAreas((current) => {
      const next = new Set(current)
      if (next.has(area)) next.delete(area)
      else next.add(area)
      return next
    })
  }

  function clearFilters() {
    setEnabledKinds(new Set(KINDS))
    setEnabledAreas(new Set(AREA_ORDER))
    setActiveIndex(0)
  }

  function navigate(index: number) {
    if (visibleChanges.length === 0) return
    const next = Math.min(Math.max(index, 0), visibleChanges.length - 1)
    setActiveIndex(next)
  }

  // SHELL-03.3 — the Review scope's "Next and previous change" (N/P). The
  // handlers step the diff's own selection; they only fire while the review
  // workspace has set the `review` scope, so the same component used in a
  // record history tab does not react to stray N/P keystrokes.
  useRegisterShortcuts(
    React.useMemo(
      () =>
        reviewShortcuts({
          nextChange: () =>
            setActiveIndex((i) => Math.min(i + 1, visibleChanges.length - 1)),
          previousChange: () => setActiveIndex((i) => Math.max(i - 1, 0)),
        }),
      [visibleChanges.length],
    ),
  )

  return (
    <section
      ref={rootRef}
      aria-label={t('projects.diffReview.label')}
      className={cn('space-y-4', className)}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 rounded-lg border bg-surface p-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
            {t('projects.diffReview.compare')}
          </p>
          <div className="mt-1 flex items-center gap-2 text-sm font-semibold">
            <span>{beforeLabel}</span>
            <span aria-hidden="true" className="text-fg-muted">
              →
            </span>
            <span>{afterLabel}</span>
          </div>
        </div>
        <p className="text-xs text-fg-muted" aria-live="polite">
          {diff.unavailableSheetComparisons.length > 0 ? (
            t('projects.diffReview.partial')
          ) : (
            <>
              {t('projects.diffReview.changes', { count: diff.changes.length })}
            </>
          )}
        </p>
      </header>

      {after.sheetEvidence?.map((evidence) => (
        <FrozenSheetEvidencePanel
          key={evidence.blockId}
          evidence={evidence}
          onCommentTarget={onCommentTarget}
        />
      ))}

      {diff.unavailableSheetComparisons.length > 0 ? (
        <div
          role="status"
          className="rounded-lg border bg-surface-muted p-3 text-sm"
        >
          <p className="font-semibold">
            {t('projects.diffReview.unavailable.title')}
          </p>
          <p className="mt-1 text-xs text-fg-muted">
            {t('projects.diffReview.unavailable.body')}
          </p>
        </div>
      ) : null}

      {diff.changes.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col gap-1">
            <div
              role="group"
              className="flex flex-wrap gap-1"
              aria-label={t('projects.diffReview.filters.type')}
            >
              {KINDS.map((kind) => {
                const enabled = enabledKinds.has(kind)
                return (
                  <Button
                    key={kind}
                    variant={enabled ? 'primary' : 'secondary'}
                    size="sm"
                    aria-pressed={enabled}
                    aria-label={
                      enabled
                        ? t('projects.diffReview.filters.hideKind', {
                            kind: t(`projects.diffReview.kindNames.${kind}`),
                          })
                        : t('projects.diffReview.filters.showKind', {
                            kind: t(`projects.diffReview.kindNames.${kind}`),
                          })
                    }
                    onClick={() => toggleKind(kind)}
                  >
                    {t(`projects.diffReview.kinds.${kind}`)} (
                    {diff.counts[kind]})
                  </Button>
                )
              })}
            </div>
            {areasInDiff.length > 1 ? (
              <div
                role="group"
                className="flex flex-wrap gap-1"
                aria-label={t('projects.diffReview.filters.area')}
              >
                {areasInDiff.map((area) => {
                  const enabled = enabledAreas.has(area)
                  const areaCount = diff.changes.filter(
                    (change) => change.area === area,
                  ).length
                  return (
                    <Button
                      key={area}
                      variant={enabled ? 'primary' : 'secondary'}
                      size="sm"
                      aria-pressed={enabled}
                      aria-label={
                        enabled
                          ? t('projects.diffReview.filters.hideKind', {
                              kind: areaLabel(area),
                            })
                          : t('projects.diffReview.filters.showKind', {
                              kind: areaLabel(area),
                            })
                      }
                      onClick={() => toggleArea(area)}
                    >
                      {areaLabel(area)} ({areaCount})
                    </Button>
                  )
                })}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-fg-muted" aria-live="polite">
              {visibleChanges.length > 0
                ? t('projects.diffReview.position2', {
                    index: activeIndex + 1,
                    total: visibleChanges.length,
                  })
                : t('projects.diffReview.noMatch')}
            </span>
            <Button
              variant="secondary"
              size="icon"
              aria-label={t('projects.diffReview.previous')}
              disabled={activeIndex === 0 || visibleChanges.length === 0}
              onClick={() => navigate(activeIndex - 1)}
            >
              <Icon name="chevronRight" size={14} className="rotate-180" />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              aria-label={t('projects.diffReview.next')}
              disabled={
                activeIndex >= visibleChanges.length - 1 ||
                visibleChanges.length === 0
              }
              onClick={() => navigate(activeIndex + 1)}
            >
              <Icon name="chevronRight" size={14} />
            </Button>
          </div>
        </div>
      ) : null}

      {diff.unchanged ? (
        <EmptyState
          icon="check"
          title={t('projects.diffReview.unchanged.title')}
          description={t('projects.diffReview.unchanged.body')}
        />
      ) : items.length === 0 &&
        diff.unavailableSheetComparisons.length > 0 ? null : items.length ===
        0 ? (
        <EmptyState
          icon="filter"
          title={t('projects.diffReview.filtered.title')}
          description={t('projects.diffReview.filtered.body')}
          action={
            <Button variant="secondary" onClick={clearFilters}>
              {t('projects.diffReview.filtered.clear')}
            </Button>
          }
        />
      ) : (
        <ol
          className="space-y-3"
          aria-label={t('projects.diffReview.changesLabel')}
        >
          {items.map((item) => (
            <li key={item.id}>
              {item.type === 'change' ? (
                <ChangeCard
                  change={item.change}
                  active={item.change.id === activeChange?.id}
                />
              ) : (
                <TableDiffCard
                  summary={item.summary}
                  changes={item.visibleChanges}
                  activeChangeId={activeChange?.id}
                />
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
