import * as React from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Move,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { Badge, Button } from '#/components/ui'
import { diffRevisionEnvelopes } from '#/lib/revision-diff'
import type {
  CanonicalRevisionEnvelope,
  RevisionChange,
  RevisionChangeArea,
  RevisionChangeKind,
  RevisionDiffResult,
  RevisionTableDiffSummary,
} from '#/lib/revision-diff'
import { cn } from '#/lib/utils'

export interface RevisionDiffReviewProps {
  before: CanonicalRevisionEnvelope
  after: CanonicalRevisionEnvelope
  beforeLabel?: string
  afterLabel?: string
  className?: string
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
    label: string
    icon: LucideIcon
    variant: 'success' | 'danger' | 'warning' | 'info'
  }
> = {
  added: { label: 'Added', icon: Plus, variant: 'success' },
  removed: { label: 'Removed', icon: Trash2, variant: 'danger' },
  modified: { label: 'Modified', icon: RefreshCw, variant: 'warning' },
  moved: { label: 'Moved', icon: Move, variant: 'info' },
}

const AREA_LABELS: Record<RevisionChange['area'], string> = {
  metadata: 'Record metadata',
  blocks: 'Block structure',
  text: 'Text',
  checklists: 'Checklist',
  links: 'Linked records',
  tables: 'Scientific table',
  formulas: 'Formula',
  files: 'File',
}

type ReviewItem =
  | { id: string; order: number; type: 'change'; change: RevisionChange }
  | {
      id: string
      order: number
      type: 'table'
      summary: RevisionTableDiffSummary
      visibleChanges: RevisionChange[]
    }

function exactText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null) return 'null'
  if (value === undefined) return 'Not present'
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}

function focusChange(target: HTMLElement | undefined) {
  if (!target) return
  target.focus()
  const scrollIntoView: unknown = Reflect.get(target, 'scrollIntoView')
  if (typeof scrollIntoView === 'function') {
    scrollIntoView.call(target, { behavior: 'auto', block: 'nearest' })
  }
}

function KindBadge({ kind }: { kind: RevisionChangeKind }) {
  const meta = KIND_META[kind]
  const Icon = meta.icon
  return (
    <Badge variant={meta.variant}>
      <Icon className="size-3" aria-hidden="true" />
      {meta.label}
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
    <div className="min-w-0 rounded-md border bg-background px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-xs leading-5 text-foreground">
        {exactText(value)}
      </pre>
      {unit ? (
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
          {unit}
        </p>
      ) : null}
    </div>
  )
}

function ChangeBody({ change }: { change: RevisionChange }) {
  if (change.kind === 'moved') {
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        Position {(change.beforeOrder ?? 0) + 1} →{' '}
        {(change.afterOrder ?? 0) + 1}
      </p>
    )
  }
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <ChangeValue
        label="Before"
        value={change.before}
        unit={change.beforeUnit}
      />
      <ChangeValue label="After" value={change.after} unit={change.afterUnit} />
    </div>
  )
}

function ChangeCard({
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
        'rounded-lg border bg-card p-3 outline-none',
        active && 'ring-2 ring-primary/40',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {AREA_LABELS[change.area]}
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
        'rounded-lg border bg-card outline-none',
        activeDetailIndex >= 0 && 'ring-2 ring-primary/40',
      )}
    >
      <div className="flex flex-wrap items-center gap-3 p-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Scientific table
          </p>
          <h3 className="text-sm font-semibold">{summary.label}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {summary.addedRows} rows added · {summary.removedRows} rows removed
            {' · '}
            {summary.modifiedCells} cells changed · {summary.schemaChanges}{' '}
            schema changes
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Hide' : 'Show'} changes for ${summary.label}`}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? <ChevronUp /> : <ChevronDown />}
          {expanded ? 'Hide details' : `Show ${changes.length} changes`}
        </Button>
      </div>
      {expanded ? (
        <ol
          className="divide-y border-t"
          aria-label={`${summary.label} changes`}
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
            variant="outline"
            size="sm"
            onClick={() =>
              setVisibleLimit((current) =>
                Math.min(current + TABLE_DETAIL_BATCH, changes.length),
              )
            }
          >
            Show {Math.min(TABLE_DETAIL_BATCH, changes.length - visibleLimit)}{' '}
            more changes
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
  beforeLabel = 'Earlier revision',
  afterLabel = 'Later revision',
  className,
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

  function navigate(index: number) {
    if (visibleChanges.length === 0) return
    const next = Math.min(Math.max(index, 0), visibleChanges.length - 1)
    setActiveIndex(next)
  }

  return (
    <section
      ref={rootRef}
      aria-label="Revision comparison"
      className={cn('space-y-4', className)}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 rounded-lg border bg-card p-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Compare revisions
          </p>
          <div className="mt-1 flex items-center gap-2 text-sm font-semibold">
            <span>{beforeLabel}</span>
            <span aria-hidden="true" className="text-muted-foreground">
              →
            </span>
            <span>{afterLabel}</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {diff.changes.length}{' '}
          {diff.changes.length === 1 ? 'change' : 'changes'}
        </p>
      </header>

      {!diff.unchanged ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col gap-1">
            <div
              role="group"
              className="flex flex-wrap gap-1"
              aria-label="Change type filters"
            >
              {KINDS.map((kind) => {
                const enabled = enabledKinds.has(kind)
                const meta = KIND_META[kind]
                return (
                  <Button
                    key={kind}
                    variant={enabled ? 'secondary' : 'outline'}
                    size="sm"
                    aria-pressed={enabled}
                    aria-label={`${enabled ? 'Hide' : 'Show'} ${kind} changes`}
                    onClick={() => toggleKind(kind)}
                  >
                    {meta.label} ({diff.counts[kind]})
                  </Button>
                )
              })}
            </div>
            {areasInDiff.length > 1 ? (
              <div
                role="group"
                className="flex flex-wrap gap-1"
                aria-label="Change area filters"
              >
                {areasInDiff.map((area) => {
                  const enabled = enabledAreas.has(area)
                  const areaCount = diff.changes.filter(
                    (change) => change.area === area,
                  ).length
                  return (
                    <Button
                      key={area}
                      variant={enabled ? 'secondary' : 'outline'}
                      size="sm"
                      aria-pressed={enabled}
                      aria-label={`${enabled ? 'Hide' : 'Show'} ${AREA_LABELS[area]} changes`}
                      onClick={() => toggleArea(area)}
                    >
                      {AREA_LABELS[area]} ({areaCount})
                    </Button>
                  )
                })}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground" aria-live="polite">
              {visibleChanges.length > 0
                ? `Change ${activeIndex + 1} of ${visibleChanges.length}`
                : 'No changes match the filters'}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Previous change"
              disabled={activeIndex === 0 || visibleChanges.length === 0}
              onClick={() => navigate(activeIndex - 1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Next change"
              disabled={
                activeIndex >= visibleChanges.length - 1 ||
                visibleChanges.length === 0
              }
              onClick={() => navigate(activeIndex + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      ) : null}

      {diff.unchanged ? (
        <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center">
          <h2 className="text-sm font-semibold">No meaningful changes</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            The submitted scientific content is unchanged between these
            revisions.
          </p>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No changes match the selected change types.
        </div>
      ) : (
        <ol className="space-y-3" aria-label="Revision changes">
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
