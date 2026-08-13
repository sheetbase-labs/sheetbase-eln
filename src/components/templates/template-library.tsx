/**
 * TPL-001 Template Library presentational components: a dense, scannable
 * template list with grid/list views, favourites, filters (type, validation
 * status, ownership, favourites-only), a preview inspector with version /
 * author / usage / linked records / approvals / actions, and the
 * use-template action pinned to the selected template version.
 *
 * Extracted from the route so they are independently testable. All data
 * fetching lives in the route; these components are pure functions of their
 * props.
 *
 * Design (PRODUCT.md / DESIGN.md):
 * - "Dense, never cramped" — templates are scannable rows, not sparse cards.
 * - Status is never communicated by colour alone; StatusBadge carries text +
 *   icon, and the Ready/Archived indicators use text labels.
 * - Semantic tokens only (no literal hex); status tints reuse the Badge
 *   variant palette so light/dark themes stay equivalent.
 * - Full-width layout with aligned columns; secondary columns hide on narrow
 *   screens so the title always has room.
 * - Thumbnails are rendered from actual template content (compact block
 *   previews), never from unrelated static images.
 */
import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import {
  Archive,
  CheckCircle2,
  Copy,
  Download,
  FileWarning,
  LayoutGrid,
  List as ListIcon,
  Search,
  Sparkles,
  Star,
} from 'lucide-react'

import { BlockPreview } from '#/components/notebook/block-preview'
import {
  CheckList,
  EmptyHint,
  Inspector,
  InspectorSection,
} from '#/components/record'
import { StatusBadge } from '#/components/scientific'
import { Badge, Button, Skeleton } from '#/components/ui'
import { cn } from '#/lib/utils'
import {
  archiveDependencyWarning,
  canManageTemplate,
  isInstantiable,
  isTemplateKind,
  TEMPLATE_KIND_LABEL,
} from '#/lib/templates'
import type { TemplateKind } from '#/lib/templates'
import type { NotebookBlock, NotebookRecord } from '#/lib/notebook-data'

export interface TemplateProject {
  id: string
  key: string
  title: string
}

/** A usage-linked record (instantiated from the selected template). */
export interface TemplateLinkedRecord {
  id: string
  identifier: string
  title: string
  kind: string
  status: string
  projectId: string | null
}

export type TemplateView = 'list' | 'grid'

export type TemplateOwnershipFilter = 'all' | 'mine'

// ---------------------------------------------------------------------------
// Time + ownership helpers
// ---------------------------------------------------------------------------

/** Compact relative time, e.g. "2d ago". Falls back to a date for >30d. */
function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso
  const diffMs = now - then
  if (diffMs < 0) return new Date(iso).toLocaleDateString()
  const minutes = Math.round(diffMs / 60_000)
  const hours = Math.round(minutes / 60)
  const days = Math.round(hours / 24)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

/**
 * Owner label for the list/inspector. The ELN does not expose other users'
 * names to the browser (internal.user is server-only), so the current user is
 * labelled "You" and everyone else gets a stable, anonymised handle derived
 * from their id suffix. RLS remains the authoritative boundary.
 */
export function ownerLabel(
  createdByUserId: string,
  currentUserId: string | null,
): string {
  if (currentUserId && createdByUserId === currentUserId) return 'You'
  const suffix = createdByUserId.slice(-6)
  return `User ${suffix}`
}

/**
 * Featured heuristic: a template is "Featured" when it is instantiable
 * (published lifecycle — `active` for protocols, `validated` for notebooks)
 * and has a rich body of content (>10 blocks). This is a stand-in until a
 * real editorial featuring flag exists.
 */
export function isFeatured(
  template: NotebookRecord,
  blockCount: number | undefined,
): boolean {
  const kind = isTemplateKind(template.kind) ? template.kind : null
  if (!kind) return false
  if (!isInstantiable(kind, template.status, template.archivedAt)) return false
  return (blockCount ?? 0) > 10
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export function TemplateFilters({
  kindFilter,
  onKindChange,
  statusFilter,
  onStatusChange,
  search,
  onSearchChange,
  count,
  favouritesOnly = false,
  onFavouritesOnlyChange,
  ownership = 'all',
  onOwnershipChange,
  view = 'list',
  onViewChange,
}: {
  kindFilter: 'all' | TemplateKind
  onKindChange: (value: 'all' | TemplateKind) => void
  statusFilter: string
  onStatusChange: (value: string) => void
  search: string
  onSearchChange: (value: string) => void
  /** Optional result count rendered at the right of the bar. */
  count?: number
  /** TPL-001: show only favourited templates. */
  favouritesOnly?: boolean
  onFavouritesOnlyChange?: (value: boolean) => void
  /** TPL-001: ownership filter (all / mine). */
  ownership?: TemplateOwnershipFilter
  onOwnershipChange?: (value: TemplateOwnershipFilter) => void
  /** TPL-001: grid/list view. */
  view?: TemplateView
  onViewChange?: (value: TemplateView) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-[200px] flex-1">
        <Search
          className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <label htmlFor="template-search" className="sr-only">
          Search templates
        </label>
        <input
          id="template-search"
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search by title or identifier"
          className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <label htmlFor="template-kind" className="sr-only">
        Filter by type
      </label>
      <select
        id="template-kind"
        value={kindFilter}
        onChange={(e) => onKindChange(e.target.value as 'all' | TemplateKind)}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value="all">All types</option>
        <option value="protocol_template">Protocol</option>
        <option value="notebook_template">Notebook</option>
      </select>

      <label htmlFor="template-status" className="sr-only">
        Filter by status
      </label>
      <select
        id="template-status"
        value={statusFilter}
        onChange={(e) => onStatusChange(e.target.value)}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value="all">All statuses</option>
        <option value="draft">Draft</option>
        <option value="active">Active</option>
        <option value="validated">Validated</option>
        <option value="under_review">Under review</option>
      </select>

      {onOwnershipChange ? (
        <label htmlFor="template-ownership" className="sr-only">
          Filter by ownership
        </label>
      ) : null}
      {onOwnershipChange ? (
        <select
          id="template-ownership"
          value={ownership}
          onChange={(e) =>
            onOwnershipChange(e.target.value as TemplateOwnershipFilter)
          }
          className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="all">All owners</option>
          <option value="mine">My templates</option>
        </select>
      ) : null}

      {onFavouritesOnlyChange ? (
        <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm">
          <Star
            className={cn(
              'size-4',
              favouritesOnly
                ? 'fill-amber-400 text-warning-foreground'
                : 'text-muted-foreground',
            )}
            aria-hidden="true"
          />
          <input
            type="checkbox"
            className="sr-only"
            checked={favouritesOnly}
            onChange={(e) => onFavouritesOnlyChange(e.target.checked)}
          />
          Favourites
        </label>
      ) : null}

      {onViewChange ? (
        <div
          role="group"
          aria-label="Template view"
          className="inline-flex h-9 items-center rounded-md border border-input bg-background p-0.5"
        >
          <button
            type="button"
            aria-pressed={view === 'list'}
            onClick={() => onViewChange('list')}
            className={cn(
              'inline-flex size-8 items-center justify-center rounded-sm',
              view === 'list'
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground',
            )}
          >
            <ListIcon className="size-4" aria-hidden="true" />
            <span className="sr-only">List view</span>
          </button>
          <button
            type="button"
            aria-pressed={view === 'grid'}
            onClick={() => onViewChange('grid')}
            className={cn(
              'inline-flex size-8 items-center justify-center rounded-sm',
              view === 'grid'
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground',
            )}
          >
            <LayoutGrid className="size-4" aria-hidden="true" />
            <span className="sr-only">Grid view</span>
          </button>
        </div>
      ) : null}

      {count !== undefined ? (
        <span
          className="ml-auto text-xs tabular-nums text-muted-foreground"
          aria-live="polite"
        >
          {count} {count === 1 ? 'template' : 'templates'}
        </span>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Favourite toggle
// ---------------------------------------------------------------------------

function FavouriteToggle({
  favourited,
  onToggle,
  className,
}: {
  favourited: boolean
  onToggle: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      aria-pressed={favourited}
      aria-label={favourited ? 'Remove from favourites' : 'Add to favourites'}
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      <Star
        className={cn(
          'size-4',
          favourited && 'fill-amber-400 text-warning-foreground',
        )}
        aria-hidden="true"
      />
    </button>
  )
}

// ---------------------------------------------------------------------------
// Template thumbnail — rendered from actual template content
// ---------------------------------------------------------------------------

/**
 * Compact thumbnail rendered from the template's own blocks (TPL-001:
 * "preview thumbnails from actual template content rather than unrelated
 * static images"). Shows up to `maxBlocks` block previews in a clipped
 * stack so the grid card previews real content, not a placeholder image.
 */
export function TemplateThumbnail({
  blocks,
  maxBlocks = 2,
  className,
}: {
  blocks: NotebookBlock[]
  maxBlocks?: number
  className?: string
}) {
  const previewBlocks = blocks
    .slice()
    .sort((a, b) => a.order - b.order)
    .slice(0, maxBlocks)
  if (previewBlocks.length === 0) {
    return (
      <div
        className={cn(
          'flex h-full items-center justify-center rounded-md border border-dashed border-border bg-muted/30 text-xs text-muted-foreground',
          className,
        )}
      >
        No content
      </div>
    )
  }
  return (
    <div
      className={cn(
        'pointer-events-none h-full max-h-[160px] overflow-hidden rounded-md border border-border bg-background p-3 text-xs leading-5 text-muted-foreground',
        className,
      )}
      aria-hidden="true"
    >
      <div className="space-y-1.5">
        {previewBlocks.map((block) => (
          <BlockPreview key={block.id} block={block} className="text-xs" />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Template list (row view)
// ---------------------------------------------------------------------------

/**
 * Column header for the dense list. Hidden on narrow screens where the
 * secondary columns collapse. Uses a non-interactive row mirroring the
 * list row grid so labels align with the data below.
 */
function TemplateListHeader() {
  return (
    <div
      className="hidden items-center gap-4 border-b border-border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground sm:flex"
      aria-hidden="true"
    >
      <span className="w-28 shrink-0">Identifier</span>
      <span className="min-w-0 flex-1">Title</span>
      <span className="shrink-0">Type · Status</span>
      <span className="hidden w-24 shrink-0 text-right md:inline">Updated</span>
      <span className="hidden w-20 shrink-0 text-right md:inline">Blocks</span>
      <span className="w-16 shrink-0 text-right">State</span>
    </div>
  )
}

/** Skeleton rows shown while the list loads. */
function TemplateListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div
      className="divide-y divide-border rounded-md border border-border"
      aria-hidden="true"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-3 py-2.5">
          <Skeleton className="h-4 w-28 shrink-0" />
          <Skeleton className="h-4 flex-1" style={{ maxWidth: 220 }} />
          <Skeleton className="h-5 w-24 shrink-0 rounded-full" />
          <Skeleton className="hidden h-4 w-24 shrink-0 md:block" />
          <Skeleton className="hidden h-4 w-20 shrink-0 md:block" />
          <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  )
}

function StateIndicator({
  template,
  instantiable,
}: {
  template: NotebookRecord
  instantiable: boolean
}) {
  if (template.archivedAt) {
    return (
      <Badge variant="outline" className="text-xs">
        <Archive className="size-3" aria-hidden="true" />
        Archived
      </Badge>
    )
  }
  if (instantiable) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-success/20 bg-success/5 px-1.5 py-0.5 text-xs font-medium text-success">
        <CheckCircle2 className="size-3" aria-hidden="true" />
        Ready
      </span>
    )
  }
  return null
}

export function TemplateList({
  templates,
  isLoading,
  error,
  selectedId,
  onSelect,
  onRetry,
  blockCounts = {},
  usageCounts = {},
  view = 'list',
  favourites = new Set<string>(),
  onToggleFavourite,
  currentUserId = null,
  blockPreviews = {},
}: {
  templates: NotebookRecord[]
  isLoading: boolean
  error: unknown
  selectedId: string | null
  onSelect: (id: string) => void
  onRetry: () => void
  /** Map of template id → block count, for the Blocks column. */
  blockCounts?: Record<string, number>
  /** Map of template id → number of records instantiated from it. */
  usageCounts?: Record<string, number>
  /** TPL-001: grid/list view. */
  view?: TemplateView
  /** TPL-001: favourited template ids. */
  favourites?: Set<string>
  onToggleFavourite?: (id: string) => void
  /** TPL-001: current user id for ownership display. */
  currentUserId?: string | null
  /** TPL-001: per-template blocks for grid thumbnails (actual content). */
  blockPreviews?: Record<string, NotebookBlock[]>
}) {
  if (isLoading) {
    return (
      <div>
        <p className="mb-2 text-sm text-muted-foreground" aria-busy="true">
          Loading templates…
        </p>
        <TemplateListSkeleton />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-2">
        <p role="alert" className="text-sm text-destructive">
          Could not load templates.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-8 items-center rounded-md border border-input px-3 text-sm font-medium"
        >
          Try again
        </button>
      </div>
    )
  }

  if (templates.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No templates found. Create a protocol or notebook template, validate
          it, and it will appear here.
        </p>
      </div>
    )
  }

  if (view === 'grid') {
    return (
      <ul
        role="list"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
      >
        {templates.map((template) => (
          <TemplateGridCard
            key={template.id}
            template={template}
            isSelected={template.id === selectedId}
            onSelect={onSelect}
            blockCount={blockCounts[template.id]}
            usageCount={usageCounts[template.id] ?? 0}
            favourited={favourites.has(template.id)}
            onToggleFavourite={onToggleFavourite}
            currentUserId={currentUserId}
            previewBlocks={blockPreviews[template.id] ?? []}
          />
        ))}
      </ul>
    )
  }

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <TemplateListHeader />
      <ul className="divide-y divide-border" role="list">
        {templates.map((template) => {
          const kind = isTemplateKind(template.kind) ? template.kind : null
          const instantiable = kind
            ? isInstantiable(kind, template.status, template.archivedAt)
            : false
          const isSelected = template.id === selectedId
          const blockCount = blockCounts[template.id]
          const usageCount = usageCounts[template.id] ?? 0
          const featured = isFeatured(template, blockCount)
          return (
            <li key={template.id}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => onSelect(template.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(template.id)
                  }
                }}
                aria-pressed={isSelected}
                className={cn(
                  'flex w-full items-center gap-4 px-3 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  isSelected && 'bg-muted/60',
                )}
              >
                <span className="w-28 shrink-0 truncate font-mono text-xs text-muted-foreground">
                  {template.identifier}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-foreground">
                      {template.title}
                    </span>
                    {featured ? (
                      <Badge
                        variant="violet"
                        className="shrink-0 gap-0.5 text-xs"
                      >
                        <Sparkles className="size-3" aria-hidden="true" />
                        Featured
                      </Badge>
                    ) : null}
                    {favourites.has(template.id) ? (
                      <Star
                        className="size-3 shrink-0 fill-amber-400 text-warning-foreground"
                        aria-label="Favourite"
                      />
                    ) : null}
                  </span>
                  <span className="block truncate text-xs tabular-nums text-muted-foreground">
                    {ownerLabel(template.createdByUserId, currentUserId)}
                    {usageCount > 0
                      ? ` · ${usageCount} ${usageCount === 1 ? 'use' : 'uses'}`
                      : ''}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {kind ? (
                    <Badge variant="outline" className="text-xs">
                      {TEMPLATE_KIND_LABEL[kind]}
                    </Badge>
                  ) : null}
                  <StatusBadge
                    status={template.status}
                    domain={
                      template.kind === 'notebook_template'
                        ? 'notebook_template'
                        : 'protocol'
                    }
                  />
                </span>
                <span className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground md:inline">
                  {formatRelativeTime(template.updatedAt)}
                </span>
                <span className="hidden w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground md:inline">
                  {template.id in blockCounts
                    ? `${blockCounts[template.id]} blocks`
                    : '—'}
                </span>
                <span className="flex w-16 shrink-0 items-center justify-end gap-1">
                  <StateIndicator
                    template={template}
                    instantiable={instantiable}
                  />
                  {onToggleFavourite ? (
                    <FavouriteToggle
                      favourited={favourites.has(template.id)}
                      onToggle={() => onToggleFavourite(template.id)}
                    />
                  ) : null}
                </span>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function TemplateGridCard({
  template,
  isSelected,
  onSelect,
  blockCount,
  usageCount,
  favourited,
  onToggleFavourite,
  currentUserId,
  previewBlocks,
}: {
  template: NotebookRecord
  isSelected: boolean
  onSelect: (id: string) => void
  blockCount: number | undefined
  usageCount: number
  favourited: boolean
  onToggleFavourite?: (id: string) => void
  currentUserId: string | null
  previewBlocks: NotebookBlock[]
}) {
  const kind = isTemplateKind(template.kind) ? template.kind : null
  const instantiable = kind
    ? isInstantiable(kind, template.status, template.archivedAt)
    : false
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect(template.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onSelect(template.id)
          }
        }}
        aria-pressed={isSelected}
        className={cn(
          'flex h-full w-full flex-col gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isSelected && 'border-primary ring-1 ring-primary',
        )}
      >
        <div className="flex items-start gap-2">
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium text-foreground">
                {template.title}
              </span>
              {template.archivedAt ? (
                <Badge variant="outline" className="shrink-0 text-xs">
                  <Archive className="size-3" aria-hidden="true" />
                  Archived
                </Badge>
              ) : instantiable ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-success/20 bg-success/5 px-1.5 py-0.5 text-xs font-medium text-success">
                  <CheckCircle2 className="size-3" aria-hidden="true" />
                  Ready
                </span>
              ) : null}
            </span>
            <span className="block truncate font-mono text-xs text-muted-foreground">
              {template.identifier}
            </span>
          </span>
          {onToggleFavourite ? (
            <FavouriteToggle
              favourited={favourited}
              onToggle={() => onToggleFavourite(template.id)}
            />
          ) : null}
        </div>
        <TemplateThumbnail blocks={previewBlocks} />
        <div className="mt-auto flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            {kind ? (
              <Badge variant="outline" className="text-xs">
                {TEMPLATE_KIND_LABEL[kind]}
              </Badge>
            ) : null}
            <StatusBadge
              status={template.status}
              domain={
                template.kind === 'notebook_template'
                  ? 'notebook_template'
                  : 'protocol'
              }
            />
          </span>
          <span className="tabular-nums">
            {ownerLabel(template.createdByUserId, currentUserId)} ·{' '}
            {blockCount ?? 0} blocks · {usageCount}{' '}
            {usageCount === 1 ? 'use' : 'uses'}
          </span>
        </div>
      </div>
    </li>
  )
}

// ---------------------------------------------------------------------------
// Template actions (duplicate / export / archive)
// ---------------------------------------------------------------------------

export interface TemplateActionsProps {
  template: NotebookRecord
  usageCount: number
  canManage: boolean
  isArchiving: boolean
  isDuplicating: boolean
  actionError: string | null
  onArchive: () => void
  onDuplicate: () => void
  onExport: () => void
}

/**
 * Duplicate / export / archive actions with permission and dependency
 * checks (TPL-001). Duplicate and export are available to any workspace
 * member who can read the template; archive requires management rights and
 * is disabled once the template is already archived. Archive shows a
 * dependency warning when the template is in use.
 */
export function TemplateActions({
  template,
  usageCount,
  canManage,
  isArchiving,
  isDuplicating,
  actionError,
  onArchive,
  onDuplicate,
  onExport,
}: TemplateActionsProps) {
  const archived = Boolean(template.archivedAt)
  const warning = archiveDependencyWarning(usageCount)
  return (
    <InspectorSection title="Actions">
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onDuplicate}
            disabled={isDuplicating || archived}
            className="gap-1.5"
          >
            <Copy className="size-3.5" aria-hidden="true" />
            {isDuplicating ? 'Duplicating…' : 'Duplicate'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onExport}
            className="gap-1.5"
          >
            <Download className="size-3.5" aria-hidden="true" />
            Export
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onArchive}
            disabled={!canManage || archived || isArchiving}
            className="gap-1.5"
          >
            <Archive className="size-3.5" aria-hidden="true" />
            {isArchiving ? 'Archiving…' : 'Archive'}
          </Button>
        </div>
        {!canManage ? (
          <p className="text-xs text-muted-foreground">
            Only the template author or a workspace owner/admin can archive it.
          </p>
        ) : null}
        {archived ? (
          <p className="text-xs text-muted-foreground">
            This template is already archived.
          </p>
        ) : null}
        {warning ? (
          <p
            role="note"
            className="rounded-md border border-warning/20 bg-warning/5 p-2 text-xs text-warning-foreground"
          >
            {warning}
          </p>
        ) : null}
        {actionError ? (
          <p role="alert" className="text-xs text-destructive">
            {actionError}
          </p>
        ) : null}
      </div>
    </InspectorSection>
  )
}

// ---------------------------------------------------------------------------
// Template inspector with preview and use-template action
// ---------------------------------------------------------------------------

export function TemplateInspector({
  template,
  blocks,
  blocksLoading,
  projects,
  onInstantiate,
  isInstantiating,
  instantiationError,
  instantiationSuccess,
  usageCount = 0,
  linkedRecords = [],
  currentUserId = null,
  role = null,
  onArchive,
  onDuplicate,
  onExport,
  isArchiving = false,
  isDuplicating = false,
  actionError = null,
}: {
  template: NotebookRecord
  blocks: NotebookBlock[]
  blocksLoading: boolean
  projects: TemplateProject[]
  onInstantiate: (title: string, projectId: string) => void
  isInstantiating: boolean
  instantiationError: string | null
  instantiationSuccess: { recordId: string; projectId: string } | null
  /** TPL-001: number of records instantiated from this template. */
  usageCount?: number
  /** TPL-001: records instantiated from this template. */
  linkedRecords?: TemplateLinkedRecord[]
  /** TPL-001: current user id + workspace role for ownership/permissions. */
  currentUserId?: string | null
  role?: string | null
  onArchive?: () => void
  onDuplicate?: () => void
  onExport?: () => void
  isArchiving?: boolean
  isDuplicating?: boolean
  actionError?: string | null
}) {
  const [title, setTitle] = useState(template.title)
  const [projectId, setProjectId] = useState('')

  const kind = isTemplateKind(template.kind) ? template.kind : null
  const canInstantiate = kind
    ? isInstantiable(kind, template.status, template.archivedAt)
    : false
  const canManage = canManageTemplate(template, currentUserId, role)
  const hasActions = Boolean(onArchive || onDuplicate || onExport)

  // Reset title when template changes.
  useEffect(() => {
    setTitle(template.title)
  }, [template.id, template.title])

  // Set default project when projects load.
  useEffect(() => {
    if (projects.length > 0 && !projectId) {
      setProjectId(projects[0].id)
    }
  }, [projects, projectId])

  const detailsContent = (
    <>
      <dl className="space-y-1.5 text-sm">
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 text-muted-foreground">Title</dt>
          <dd className="min-w-0 font-medium">{template.title}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 text-muted-foreground">ID</dt>
          <dd className="font-mono text-xs">{template.identifier}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 text-muted-foreground">Type</dt>
          <dd>{kind ? TEMPLATE_KIND_LABEL[kind] : template.kind}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 text-muted-foreground">Status</dt>
          <dd>
            <StatusBadge
              status={template.status}
              domain={
                template.kind === 'notebook_template'
                  ? 'notebook_template'
                  : 'protocol'
              }
            />
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 text-muted-foreground">Version</dt>
          <dd className="text-xs tabular-nums text-muted-foreground">
            v{template.metadataVersion} (structure v{template.structureVersion})
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 text-muted-foreground">Author</dt>
          <dd className="text-xs text-muted-foreground">
            {ownerLabel(template.createdByUserId, currentUserId)}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 text-muted-foreground">Usage</dt>
          <dd className="text-xs tabular-nums text-muted-foreground">
            {usageCount} {usageCount === 1 ? 'record' : 'records'}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 text-muted-foreground">Updated</dt>
          <dd className="text-xs text-muted-foreground">
            {formatRelativeTime(template.updatedAt)}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 text-muted-foreground">Created</dt>
          <dd className="text-xs text-muted-foreground">
            {new Date(template.createdAt).toLocaleDateString()}
          </dd>
        </div>
        {template.archivedAt ? (
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-muted-foreground">Archived</dt>
            <dd className="text-xs text-muted-foreground">
              {new Date(template.archivedAt).toLocaleDateString()}
            </dd>
          </div>
        ) : null}
      </dl>

      <InspectorSection title="Linked records">
        {linkedRecords.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No records have been instantiated from this template yet.
          </p>
        ) : (
          <ul className="space-y-1">
            {linkedRecords.map((record) => (
              <li key={record.id}>
                <Link
                  to="/projects/$projectId/experiments/$recordId"
                  params={{
                    projectId: record.projectId ?? '',
                    recordId: record.id,
                  }}
                  className="block truncate text-xs text-primary no-underline hover:underline"
                >
                  <span className="font-mono text-muted-foreground">
                    {record.identifier}
                  </span>{' '}
                  {record.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </InspectorSection>

      <InspectorSection title="Approvals">
        <p className="text-xs text-muted-foreground">
          Review workflow is not yet connected — statuses shown are placeholders
          derived from the template lifecycle.
        </p>
        <CheckList
          items={[
            {
              id: 'scientific-review',
              label: 'Scientific review',
              state:
                template.status === 'validated' || template.status === 'active'
                  ? 'pass'
                  : 'pending',
              detail:
                template.status === 'validated' || template.status === 'active'
                  ? 'Approved'
                  : 'Pending',
            },
            {
              id: 'qa-review',
              label: 'QA review',
              state: 'pending',
              detail: 'Pending',
            },
          ]}
        />
      </InspectorSection>

      {hasActions ? (
        <TemplateActions
          template={template}
          usageCount={usageCount}
          canManage={canManage}
          isArchiving={isArchiving}
          isDuplicating={isDuplicating}
          actionError={actionError}
          onArchive={onArchive ?? (() => {})}
          onDuplicate={onDuplicate ?? (() => {})}
          onExport={onExport ?? (() => {})}
        />
      ) : null}

      {canInstantiate ? (
        <InspectorSection title="Use this template">
          {instantiationSuccess ? (
            <div className="space-y-2">
              <p className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
                <CheckCircle2 className="size-4" aria-hidden="true" />
                Record created successfully.
              </p>
              <Link
                to="/projects/$projectId/experiments/$recordId"
                params={{
                  projectId: instantiationSuccess.projectId,
                  recordId: instantiationSuccess.recordId,
                }}
                className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground no-underline"
              >
                Open new record
              </Link>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                onInstantiate(title.trim() || template.title, projectId)
              }}
              className="space-y-3"
            >
              <p className="text-xs text-muted-foreground">
                Pinned to version v{template.metadataVersion}. A new record is
                created from an immutable snapshot of this template; later
                template edits do not affect it.
              </p>
              <div>
                <label
                  htmlFor="instantiate-title"
                  className="block text-xs font-medium text-muted-foreground"
                >
                  New record title
                </label>
                <input
                  id="instantiate-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={template.title}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  disabled={isInstantiating}
                />
              </div>
              <div>
                <label
                  htmlFor="instantiate-project"
                  className="block text-xs font-medium text-muted-foreground"
                >
                  Target project
                </label>
                <select
                  id="instantiate-project"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  disabled={isInstantiating}
                >
                  <option value="" disabled>
                    Select a project…
                  </option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title} ({p.key})
                    </option>
                  ))}
                </select>
              </div>
              {instantiationError ? (
                <p role="alert" className="text-sm text-destructive">
                  {instantiationError}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={isInstantiating || !projectId}
                className="inline-flex h-9 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {isInstantiating ? 'Creating…' : 'Use template'}
              </button>
            </form>
          )}
        </InspectorSection>
      ) : (
        <InspectorSection title="Use this template">
          <div className="flex items-center gap-2 rounded-md border border-warning/20 bg-warning/5 p-3">
            <FileWarning
              className="size-4 shrink-0 text-warning-foreground"
              aria-hidden="true"
            />
            <p className="text-sm text-muted-foreground">
              {template.archivedAt
                ? 'This template is archived and cannot be instantiated.'
                : `This template must be ${template.kind === 'notebook_template' ? 'validated' : 'active'} before it can be used.`}
            </p>
          </div>
        </InspectorSection>
      )}
    </>
  )

  const previewContent = blocksLoading ? (
    <p className="text-sm text-muted-foreground" aria-busy="true">
      Loading blocks…
    </p>
  ) : blocks.length === 0 ? (
    <EmptyHint>This template has no content blocks.</EmptyHint>
  ) : (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {blocks.length} {blocks.length === 1 ? 'block' : 'blocks'}
      </p>
      {blocks.map((block) => (
        <BlockPreview key={block.id} block={block} />
      ))}
    </div>
  )

  return (
    <Inspector
      recordType={kind ? TEMPLATE_KIND_LABEL[kind] : template.kind}
      title={template.title}
      tabs={[
        { id: 'details', label: 'Details', content: detailsContent },
        { id: 'preview', label: 'Preview', content: previewContent },
      ]}
    />
  )
}
