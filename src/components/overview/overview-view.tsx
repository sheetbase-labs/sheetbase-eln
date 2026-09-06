import { Link } from '@tanstack/react-router'
import {
  Archive,
  ArrowRight,
  BarChart3,
  CheckSquare,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Hash,
  History,
  Link as LinkIcon,
  ListChecks,
  Lock,
  Maximize,
  Package,
  Paperclip,
  Table as TableIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import * as React from 'react'

import { cn } from '#/lib/utils'
import type { NotebookBlock } from '#/lib/notebook-data'
import { BlockPreview } from '#/components/notebook/block-preview'
import { canConfigureOverview, MODE_LABELS } from '#/lib/overview'
import type {
  OverviewMode,
  OverviewSection,
  OverviewRevision,
  SectionId,
} from '#/lib/overview'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui'

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
  /** Stable record id for the notebook links on each block. */
  recordId?: string
  className?: string
}

/**
 * Icon for each overview section header (decision 0032 §3, overview mockup).
 * `other` has no dedicated icon and renders a neutral fallback.
 */
export const SECTION_ICONS: Partial<Record<SectionId, LucideIcon>> = {
  notes: FileText,
  materials: Package,
  procedures: ListChecks,
  tables: TableIcon,
  visualizations: BarChart3,
  metrics: Hash,
  files: Paperclip,
  links: LinkIcon,
  tasks: CheckSquare,
}

/** Block types that show an "Open full table" affordance in the overview. */
const TABLE_BLOCK_TYPES = new Set(['table', 'sheet'])

export function OverviewView({
  sections,
  mode,
  revision,
  excludedBlockIds,
  onToggleBlock,
  recordId,
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
      {sections.map((section) => {
        const SectionIcon = SECTION_ICONS[section.id]
        return (
          <section
            key={section.id}
            aria-labelledby={`overview-section-${section.id}`}
            className="space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <h2
                id={`overview-section-${section.id}`}
                className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground"
              >
                {SectionIcon ? (
                  <SectionIcon className="size-3.5" aria-hidden="true" />
                ) : null}
                {section.label}
              </h2>
              <span className="text-xs text-muted-foreground">
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
                  recordId={recordId}
                  frozen={mode === 'historical'}
                />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
export function OverviewBlock({
  block,
  excluded,
  showToggle,
  onToggle,
  recordId,
  frozen = false,
}: {
  block: NotebookBlock
  excluded: boolean
  showToggle: boolean
  onToggle?: (blockId: string, exclude: boolean) => void
  recordId?: string
  /**
   * VIEW-02: true when rendering a pinned revision snapshot. Reconstructions
   * must not run live reads.
   */
  frozen?: boolean
}) {
  const canLinkToNotebook = Boolean(recordId)
  const showOpenFullTable = TABLE_BLOCK_TYPES.has(block.type)
  return (
    <div
      className={cn(
        'group relative rounded-lg border bg-card p-4',
        excluded && 'opacity-50',
      )}
    >
      {/* Read-only hover controls (top-right). The overview is never an
          editor; these only open a larger view or jump to the notebook. */}
      <div className="absolute right-3 top-3 flex items-center gap-1">
        {canLinkToNotebook ? <BlockExpandControl block={block} frozen={frozen} /> : null}
        {canLinkToNotebook ? (
          <Link
            to="/records/$recordId"
            params={{ recordId: recordId! }}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100 focus-visible:opacity-100"
            aria-label="Open in notebook"
            title="Open in notebook"
          >
            <ExternalLink className="size-4" aria-hidden="true" />
          </Link>
        ) : null}
        {showToggle ? (
          <button
            type="button"
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100 focus-visible:opacity-100"
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
      </div>
      <BlockPreview block={block} frozen={frozen} />
      {showOpenFullTable && canLinkToNotebook ? (
        <div className="mt-3 flex justify-end border-t border-border/60 pt-2">
          <Link
            to="/records/$recordId"
            params={{ recordId: recordId! }}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground no-underline underline-offset-2 hover:text-foreground hover:underline"
          >
            Open full table
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Expand control: opens a dialog rendering the block content at full size.
 * Read-only — the dialog never mounts editors or block pickers.
 */
function BlockExpandControl({ block, frozen = false }: { block: NotebookBlock; frozen?: boolean }) {
  const [open, setOpen] = React.useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100 focus-visible:opacity-100"
          aria-label="Expand block"
          title="Expand"
        >
          <Maximize className="size-4" aria-hidden="true" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogTitle className="sr-only">
          {block.type} block preview
        </DialogTitle>
        <div className="max-h-[80vh] overflow-auto">
          <BlockPreview block={block} frozen={frozen} />
        </div>
      </DialogContent>
    </Dialog>
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
