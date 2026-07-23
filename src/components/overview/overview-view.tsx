import { Eye, EyeOff, Lock, History, Archive } from 'lucide-react'

import { cn } from '#/lib/utils'
import type { NotebookBlock } from '#/lib/notebook-data'
import { BlockPreview } from '#/components/notebook/block-preview'
import { canConfigureOverview, MODE_LABELS } from '#/lib/overview'
import type {
  OverviewMode,
  OverviewSection,
  OverviewRevision,
} from '#/lib/overview'

/**
 * Experiment overview view (SCI-007, decision 0032).
 *
 * Composes notebook blocks into read-oriented sections by type, preserving
 * notebook order within each section. Each block renders through its existing
 * `BlockPreview` component in read-only mode — the overview never
 * re-implements chart, plate, sheet, file or materials rendering.
 *
 * In `active` mode, each block has a visibility toggle that persists to
 * `records.properties.overview.excludedBlockIds`. In `locked`, `archived` and
 * `historical` modes, all edit affordances are hidden.
 */

export interface OverviewViewProps {
  sections: OverviewSection[]
  mode: OverviewMode
  /** The revision being viewed, if mode is 'historical'. */
  revision?: OverviewRevision | null
  /** Excluded block ids (for toggle state in active mode). */
  excludedBlockIds: readonly string[]
  /** Toggle a block's overview visibility. Omit for read-only modes. */
  onToggleBlock?: (blockId: string, exclude: boolean) => void
  className?: string
}

export function OverviewView({
  sections,
  mode,
  revision,
  excludedBlockIds,
  onToggleBlock,
  className,
}: OverviewViewProps) {
  const showToggles = canConfigureOverview(mode) && Boolean(onToggleBlock)
  const excluded = new Set(excludedBlockIds)

  if (sections.length === 0) {
    return <OverviewEmptyState mode={mode} />
  }

  return (
    <div className={cn('space-y-8', className)}>
      {mode === 'historical' && revision ? (
        <RevisionBanner revision={revision} />
      ) : null}
      {mode === 'archived' ? <ArchivedBanner /> : null}
      {mode === 'locked' ? <LockedBanner /> : null}
      {sections.map((section) => (
        <section
          key={section.id}
          aria-labelledby={`overview-section-${section.id}`}
          className="space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <h2
              id={`overview-section-${section.id}`}
              className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground"
            >
              {section.label}
            </h2>
            <span className="text-[11px] text-muted-foreground">
              {section.blocks.length}{' '}
              {section.blocks.length === 1 ? 'block' : 'blocks'}
            </span>
          </div>
          <div className="space-y-3">
            {section.blocks.map((block) => (
              <OverviewBlock
                key={block.id}
                block={block}
                excluded={excluded.has(block.id)}
                showToggle={showToggles}
                onToggle={onToggleBlock}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function OverviewBlock({
  block,
  excluded,
  showToggle,
  onToggle,
}: {
  block: NotebookBlock
  excluded: boolean
  showToggle: boolean
  onToggle?: (blockId: string, exclude: boolean) => void
}) {
  return (
    <div
      className={cn(
        'group relative rounded-lg border bg-card p-4',
        excluded && 'opacity-50',
      )}
    >
      {showToggle ? (
        <button
          type="button"
          className="absolute right-3 top-3 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100 focus-visible:opacity-100"
          aria-label={excluded ? 'Show in overview' : 'Hide from overview'}
          aria-pressed={excluded}
          title={excluded ? 'Show in overview' : 'Hide from overview'}
          onClick={() => onToggle?.(block.id, !excluded)}
        >
          {excluded ? (
            <EyeOff className="size-4" aria-hidden="true" />
          ) : (
            <Eye className="size-4" aria-hidden="true" />
          )}
        </button>
      ) : null}
      <BlockPreview block={block} />
    </div>
  )
}

function OverviewEmptyState({ mode }: { mode: OverviewMode }) {
  const message =
    mode === 'historical'
      ? 'This revision contains no blocks.'
      : 'This notebook has no blocks to show in the overview.'
  return (
    <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center">
      <h2 className="text-base font-semibold text-foreground">
        Overview is empty
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        {message}
      </p>
    </div>
  )
}

function RevisionBanner({ revision }: { revision: OverviewRevision }) {
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs"
    >
      <History className="size-3.5 text-primary" aria-hidden="true" />
      <span className="text-foreground">
        Viewing historical revision{' '}
        <span className="font-mono">{revision.id.slice(0, 8)}</span> —{' '}
        {revision.reason} on {new Date(revision.createdAt).toLocaleDateString()}
        {revision.superseded ? ' (superseded)' : ''}
      </span>
    </div>
  )
}

function ArchivedBanner() {
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs"
    >
      <Archive className="size-3.5 text-warning" aria-hidden="true" />
      <span className="text-foreground">
        This record is archived. The overview is read-only.
      </span>
    </div>
  )
}

function LockedBanner() {
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs"
    >
      <Lock className="size-3.5 text-primary" aria-hidden="true" />
      <span className="text-foreground">
        This record is locked. The overview is read-only.
      </span>
    </div>
  )
}

export { MODE_LABELS }
