/**
 * TPL-001 unified Template Library: one table listing both catalogues —
 * canonical notebook templates (notebook_templates + versions) and protocol
 * templates (protocol_template records) — matching the V2ALT Template Library
 * anatomy: Identifier / Title / Type / Ver / Status / Blocks / Used / Updated
 * with a favourites star, a shared filter bar, list|grid views and a compact
 * notebook-template inspector to complement the existing protocol inspector.
 *
 * The two catalogues keep their own semantics: notebook rows show the latest
 * version's lifecycle and composition needs; protocol rows show the record's
 * effective lifecycle and block/usage counts. Selection is typed so the
 * route can keep ?template= / ?protocol= deep links.
 */
import * as React from 'react'
import type { ReactNode } from 'react'
import { useTable } from '@tanstack/react-table'
import {
  Archive,
  CheckCircle2,
  CircleDashed,
  Eye,
  LayoutGrid,
  List as ListIcon,
  Search,
  Star,
} from 'lucide-react'

import { StatusBadge } from '#/components/scientific'
import type { StatusVocabulary } from '#/components/scientific/status-badge'
import { Inspector, InspectorSection } from '#/components/record'
import { DataGrid } from '#/components/data-grid/data-grid'
import { appTableFeatures, createAppColumnHelper } from '#/lib/table-features'
import type { AppColumnDef } from '#/lib/table-features'
import { Badge, Button, Input, Select, Skeleton } from '#/components/ui'
import { cn } from '#/lib/utils'
import { formatDate } from '#/lib/notebook-data'
import type { NotebookBlock, NotebookRecord } from '#/lib/notebook-data'
import type {
  NotebookTemplate,
  NotebookTemplateVersion,
} from '#/lib/notebook-template-data'
import {
  notebookTemplateNeedsLine,
  summarizeNotebookTemplateRequirements,
} from '#/lib/reuse-discovery'
import type {
  NotebookTemplateNeedsFilter,
  PurposeFacetOption,
} from '#/lib/reuse-discovery'
import {
  ownerLabel,
  TemplateThumbnail,
} from '#/components/templates/template-library'
import type {
  TemplateOwnershipFilter,
  TemplateView,
} from '#/components/templates/template-library'

export type UnifiedTemplateType = 'notebook' | 'protocol'

/** Effective status shown in the unified Status column, per catalogue. */
export type UnifiedTemplateStatusKey =
  'draft' | 'active' | 'under_review' | 'published' | 'retired' | 'archived'

export type UnifiedTemplateStatusFilter = 'all' | UnifiedTemplateStatusKey
export type UnifiedTemplateTypeFilter = 'all' | UnifiedTemplateType

interface UnifiedRowBase {
  id: string
  identifier: string
  title: string
  subline: string | null
  versionLabel: string
  statusKey: UnifiedTemplateStatusKey
  blocks: number | null
  used: number
  updatedAt: string
  ownerId: string | null
}

export type UnifiedTemplateRow =
  | (UnifiedRowBase & { type: 'protocol'; record: NotebookRecord })
  | (UnifiedRowBase & {
      type: 'notebook'
      template: NotebookTemplate
      latest: NotebookTemplateVersion | null
    })

const unifiedTemplateStatusVocabulary: StatusVocabulary = {
  draft: { label: 'Draft', tone: 'neutral', icon: CircleDashed },
  active: { label: 'Active', tone: 'success', icon: CheckCircle2 },
  under_review: { label: 'Under review', tone: 'violet', icon: Eye },
  published: { label: 'Published', tone: 'success', icon: CheckCircle2 },
  retired: { label: 'Retired', tone: 'warning', icon: Archive },
  archived: { label: 'Archived', tone: 'neutral', icon: Archive },
}

const UNIFIED_STATUS_OPTIONS: {
  value: UnifiedTemplateStatusFilter
  label: string
}[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'under_review', label: 'Under review' },
  { value: 'published', label: 'Published' },
  { value: 'retired', label: 'Retired' },
  { value: 'archived', label: 'Archived' },
]

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

export function UnifiedTemplateFilters({
  search,
  onSearchChange,
  typeFilter,
  onTypeChange,
  statusFilter,
  onStatusChange,
  ownership,
  onOwnershipChange,
  favouritesOnly,
  onFavouritesOnlyChange,
  view,
  onViewChange,
  purposeFilter,
  onPurposeChange,
  purposeOptions,
  needsFilter,
  onNeedsChange,
  count,
}: {
  search: string
  onSearchChange: (value: string) => void
  typeFilter: UnifiedTemplateTypeFilter
  onTypeChange: (value: UnifiedTemplateTypeFilter) => void
  statusFilter: UnifiedTemplateStatusFilter
  onStatusChange: (value: UnifiedTemplateStatusFilter) => void
  ownership: TemplateOwnershipFilter
  onOwnershipChange: (value: TemplateOwnershipFilter) => void
  favouritesOnly: boolean
  onFavouritesOnlyChange: (value: boolean) => void
  view: TemplateView
  onViewChange: (value: TemplateView) => void
  /** Protocol-catalogue facet; hidden rows are notebook templates. */
  purposeFilter: string
  onPurposeChange: (value: string) => void
  purposeOptions: PurposeFacetOption[]
  /** Notebook-catalogue facet; hidden rows are protocol templates. */
  needsFilter: NotebookTemplateNeedsFilter
  onNeedsChange: (value: NotebookTemplateNeedsFilter) => void
  count: number
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative min-w-56 flex-1 sm:max-w-md">
        <span className="sr-only">Search templates</span>
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search by title or identifier"
          className="h-8 pl-8 text-xs"
        />
      </label>
      <label className="sr-only" htmlFor="unified-template-type">
        Filter by type
      </label>
      <Select
        id="unified-template-type"
        value={typeFilter}
        onChange={(event) =>
          onTypeChange(event.target.value as UnifiedTemplateTypeFilter)
        }
        className="h-8 w-auto text-xs"
      >
        <option value="all">All types</option>
        <option value="notebook">Notebook</option>
        <option value="protocol">Protocol</option>
      </Select>
      <label className="sr-only" htmlFor="unified-template-status">
        Filter by status
      </label>
      <Select
        id="unified-template-status"
        value={statusFilter}
        onChange={(event) =>
          onStatusChange(event.target.value as UnifiedTemplateStatusFilter)
        }
        className="h-8 w-auto text-xs"
      >
        {UNIFIED_STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      <label className="sr-only" htmlFor="unified-template-owner">
        Filter by owner
      </label>
      <Select
        id="unified-template-owner"
        value={ownership}
        onChange={(event) =>
          onOwnershipChange(event.target.value as TemplateOwnershipFilter)
        }
        className="h-8 w-auto text-xs"
      >
        <option value="all">All owners</option>
        <option value="mine">Mine</option>
      </Select>
      <Select
        aria-label="Filter by purpose"
        value={purposeFilter}
        onChange={(event) => onPurposeChange(event.target.value)}
        className="h-8 w-auto text-xs"
      >
        <option value="all">All purposes</option>
        {purposeOptions.map((option) => (
          <option key={option.tag} value={option.tag}>
            {option.tag} ({option.count})
          </option>
        ))}
      </Select>
      <Select
        aria-label="Filter by instantiation needs"
        value={needsFilter}
        onChange={(event) =>
          onNeedsChange(event.target.value as NotebookTemplateNeedsFilter)
        }
        className="h-8 w-auto text-xs"
      >
        <option value="all">All needs</option>
        <option value="none">No parameters</option>
        <option value="optional-only">Optional only</option>
        <option value="has-required">Has required</option>
      </Select>
      <Button
        type="button"
        size="sm"
        variant={favouritesOnly ? 'secondary' : 'outline'}
        className="h-8 gap-1.5 text-xs"
        onClick={() => onFavouritesOnlyChange(!favouritesOnly)}
        aria-pressed={favouritesOnly}
      >
        <Star
          className={cn(
            'size-3.5',
            favouritesOnly && 'fill-amber-400 text-warning-foreground',
          )}
          aria-hidden="true"
        />
        Favourites
      </Button>
      <span
        className="inline-flex h-8 items-center rounded-md border border-input"
        role="group"
        aria-label="View"
      >
        <button
          type="button"
          onClick={() => onViewChange('list')}
          aria-pressed={view === 'list'}
          aria-label="List view"
          className={cn(
            'flex h-full w-8 items-center justify-center rounded-l-md transition-colors',
            view === 'list'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <ListIcon className="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onViewChange('grid')}
          aria-pressed={view === 'grid'}
          aria-label="Grid view"
          className={cn(
            'flex h-full w-8 items-center justify-center rounded-r-md transition-colors',
            view === 'grid'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <LayoutGrid className="size-3.5" aria-hidden="true" />
        </button>
      </span>
      <span className="ml-auto text-xs tabular-nums text-muted-foreground">
        {count} {count === 1 ? 'template' : 'templates'}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Unified list + grid
// ---------------------------------------------------------------------------

function UnifiedStar({
  favourited,
  onToggle,
  label,
}: {
  favourited: boolean
  onToggle: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
      aria-label={label}
      aria-pressed={favourited}
      className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Star
        className={cn(
          'size-3.5',
          favourited && 'fill-amber-400 text-warning-foreground',
        )}
        aria-hidden="true"
      />
    </button>
  )
}

function UnifiedGridCard({
  row,
  isSelected,
  onSelect,
  favourited,
  onToggleFavourite,
  previewBlocks,
}: {
  row: UnifiedTemplateRow
  isSelected: boolean
  onSelect: () => void
  favourited: boolean
  onToggleFavourite: () => void
  previewBlocks: NotebookBlock[]
}) {
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onSelect()
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
            <span className="block truncate text-sm font-medium text-foreground">
              {row.title}
            </span>
            <span className="block truncate font-mono text-xs text-muted-foreground">
              {row.identifier}
            </span>
            {row.subline ? (
              <span className="block truncate text-xs text-muted-foreground">
                {row.subline}
              </span>
            ) : null}
          </span>
          <UnifiedStar
            favourited={favourited}
            onToggle={onToggleFavourite}
            label={`Favourite ${row.title}`}
          />
        </div>
        {row.type === 'protocol' ? (
          <TemplateThumbnail blocks={previewBlocks} />
        ) : (
          <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border bg-muted/30 text-xs text-muted-foreground">
            {row.latest
              ? `${row.latest.configuration.placements.length} placements`
              : 'No versions yet'}
          </div>
        )}
        <div className="mt-auto flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <StatusBadge
              status={row.statusKey}
              vocabulary={unifiedTemplateStatusVocabulary}
            />
            <Badge variant="outline" className="text-xs">
              {row.type === 'notebook' ? 'Notebook' : 'Protocol'}
            </Badge>
          </span>
          <span className="tabular-nums">
            {row.versionLabel} · {row.used} {row.used === 1 ? 'use' : 'uses'}
          </span>
        </div>
      </div>
    </li>
  )
}

export function UnifiedTemplateTable({
  rows,
  isLoading,
  error,
  onRetry,
  selectedId,
  onSelect,
  isFavourite,
  onToggleFavourite,
  view,
  blockPreviews = {},
}: {
  rows: UnifiedTemplateRow[]
  isLoading: boolean
  error: unknown
  onRetry: () => void
  selectedId: string | null
  onSelect: (row: UnifiedTemplateRow) => void
  isFavourite: (row: UnifiedTemplateRow) => boolean
  onToggleFavourite: (row: UnifiedTemplateRow) => void
  view: TemplateView
  /** Protocol rows only: record id → blocks for grid thumbnails. */
  blockPreviews?: Record<string, NotebookBlock[]>
}) {
  if (isLoading) {
    return (
      <div>
        <p className="mb-2 text-sm text-muted-foreground" aria-busy="true">
          Loading templates…
        </p>
        <Skeleton className="h-64 w-full" />
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

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No templates match the current filters.
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
        {rows.map((row) => (
          <UnifiedGridCard
            key={`${row.type}:${row.id}`}
            row={row}
            isSelected={row.id === selectedId}
            onSelect={() => onSelect(row)}
            favourited={isFavourite(row)}
            onToggleFavourite={() => onToggleFavourite(row)}
            previewBlocks={
              row.type === 'protocol' ? (blockPreviews[row.id] ?? []) : []
            }
          />
        ))}
      </ul>
    )
  }

  return (
    <UnifiedTemplateDataGrid
      rows={rows}
      selectedId={selectedId}
      onSelect={onSelect}
      isFavourite={isFavourite}
      onToggleFavourite={onToggleFavourite}
    />
  )
}

const unifiedColumnHelper = createAppColumnHelper<UnifiedTemplateRow>()
const unifiedRowKey = (row: UnifiedTemplateRow) => `${row.type}:${row.id}`

function UnifiedTemplateDataGrid({
  rows,
  selectedId,
  onSelect,
  isFavourite,
  onToggleFavourite,
}: {
  rows: UnifiedTemplateRow[]
  selectedId: string | null
  onSelect: (row: UnifiedTemplateRow) => void
  isFavourite: (row: UnifiedTemplateRow) => boolean
  onToggleFavourite: (row: UnifiedTemplateRow) => void
}) {
  const columns = React.useMemo<AppColumnDef<UnifiedTemplateRow>[]>(
    () => [
      unifiedColumnHelper.accessor('identifier', {
        id: 'identifier',
        header: 'Identifier',
        size: 128,
        cell: (info) => (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {info.getValue()}
          </span>
        ),
      }),
      unifiedColumnHelper.accessor('title', {
        id: 'title',
        header: 'Title',
        size: 320,
        minSize: 200,
        cell: (info) => {
          const row = info.row.original
          return (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onSelect(row)
              }}
              aria-pressed={row.id === selectedId}
              className="block max-w-full text-left font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="block truncate text-sm">{row.title}</span>
              {row.subline ? (
                <span className="block truncate text-xs font-normal text-muted-foreground">
                  {row.subline}
                </span>
              ) : null}
            </button>
          )
        },
      }),
      unifiedColumnHelper.accessor('type', {
        id: 'type',
        header: 'Type',
        size: 80,
        cell: (info) => (
          <span className="text-xs text-muted-foreground">
            {info.getValue() === 'notebook' ? 'Notebook' : 'Protocol'}
          </span>
        ),
      }),
      unifiedColumnHelper.accessor('versionLabel', {
        id: 'versionLabel',
        header: 'Ver',
        size: 56,
        cell: (info) => (
          <span className="text-xs tabular-nums text-muted-foreground">
            {info.getValue()}
          </span>
        ),
      }),
      unifiedColumnHelper.accessor('statusKey', {
        id: 'statusKey',
        header: 'Status',
        size: 116,
        cell: (info) => (
          <StatusBadge
            status={info.getValue()}
            vocabulary={unifiedTemplateStatusVocabulary}
          />
        ),
      }),
      unifiedColumnHelper.accessor('blocks', {
        id: 'blocks',
        header: 'Blocks',
        size: 64,
        cell: (info) => (
          <span className="text-xs tabular-nums text-muted-foreground">
            {info.getValue() ?? '—'}
          </span>
        ),
      }),
      unifiedColumnHelper.accessor('used', {
        id: 'used',
        header: 'Used',
        size: 56,
        cell: (info) => (
          <span className="text-xs tabular-nums text-muted-foreground">
            {info.getValue()}
          </span>
        ),
      }),
      unifiedColumnHelper.accessor('updatedAt', {
        id: 'updatedAt',
        header: 'Updated',
        size: 104,
        cell: (info) => (
          <span className="text-xs text-muted-foreground">
            {formatDate(info.getValue())}
          </span>
        ),
      }),
      unifiedColumnHelper.display({
        id: 'favourite',
        size: 40,
        header: () => <span className="sr-only">Favourite</span>,
        cell: (info) => {
          const row = info.row.original
          return (
            <div className="text-right">
              <UnifiedStar
                favourited={isFavourite(row)}
                onToggle={() => onToggleFavourite(row)}
                label={`Favourite ${row.title}`}
              />
            </div>
          )
        },
      }),
    ],
    [isFavourite, onSelect, onToggleFavourite, selectedId],
  )

  const table = useTable({
    features: appTableFeatures,
    data: rows,
    columns,
    getRowId: unifiedRowKey,
  })

  const selectedKey = rows.find((row) => row.id === selectedId)

  return (
    <DataGrid
      table={table}
      title="Templates"
      getRowId={unifiedRowKey}
      selectedId={selectedKey ? unifiedRowKey(selectedKey) : null}
      onRowOpen={(key) => {
        const row = rows.find((r) => unifiedRowKey(r) === key)
        if (row) onSelect(row)
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// Notebook template inspector (compact summary — the full version workspace
// stays inline below the table via VersionedNotebookTemplatePanel detail)
// ---------------------------------------------------------------------------

export function NotebookTemplateInspector({
  template,
  versions,
  usedCount,
  currentUserId = null,
  canEdit,
  onInstantiate,
  headerActions,
}: {
  template: NotebookTemplate
  versions: NotebookTemplateVersion[]
  usedCount: number
  currentUserId?: string | null
  canEdit: boolean
  /** Open the instantiate dialog for a published version. */
  onInstantiate: (versionId: string) => void
  headerActions?: ReactNode
}) {
  const latest = versions.at(0) ?? null
  const published = versions.find((v) => v.lifecycle === 'published') ?? null
  const summary = latest
    ? summarizeNotebookTemplateRequirements(latest.configuration)
    : null

  const detailsContent = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="font-mono text-xs text-muted-foreground">
          {template.key}
          {latest ? ` · v${latest.version}` : ''}
        </p>
        {headerActions}
      </div>
      {template.description ? (
        <p className="text-xs text-muted-foreground">{template.description}</p>
      ) : null}

      <InspectorSection title="Status">
        {latest ? (
          <div className="flex items-center gap-2">
            <StatusBadge
              status={latest.lifecycle}
              vocabulary={unifiedTemplateStatusVocabulary}
            />
            <span className="text-xs text-muted-foreground">
              {latest.publishedAt
                ? `published ${formatDate(latest.publishedAt)}`
                : latest.lifecycle === 'draft'
                  ? 'not yet published'
                  : ''}
            </span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No versions yet — publish a draft to make it instantiable.
          </p>
        )}
      </InspectorSection>

      <InspectorSection title="Blocks">
        {summary ? (
          <ul className="space-y-1 text-xs">
            <li className="flex justify-between">
              <span className="text-muted-foreground">Placements</span>
              <span className="tabular-nums">{summary.placements.total}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-muted-foreground">Sheet</span>
              <span className="tabular-nums">{summary.placements.sheet}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-muted-foreground">Narrative</span>
              <span className="tabular-nums">
                {summary.placements.narrative}
              </span>
            </li>
            <li className="flex justify-between">
              <span className="text-muted-foreground">Parameters</span>
              <span className="tabular-nums">{summary.parameterCount}</span>
            </li>
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">—</p>
        )}
        {summary ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {notebookTemplateNeedsLine(summary)}
          </p>
        ) : null}
      </InspectorSection>

      <InspectorSection title="Usage">
        <ul className="space-y-1 text-xs">
          <li className="flex justify-between">
            <span className="text-muted-foreground">Records created</span>
            <span className="tabular-nums">{usedCount}</span>
          </li>
          <li className="flex justify-between">
            <span className="text-muted-foreground">Versions</span>
            <span className="tabular-nums">{versions.length}</span>
          </li>
          <li className="flex justify-between">
            <span className="text-muted-foreground">Updated</span>
            <span className="tabular-nums">
              {formatDate(template.updatedAt)}
            </span>
          </li>
          {latest?.createdByUserId ? (
            <li className="flex justify-between">
              <span className="text-muted-foreground">Owner</span>
              <span>{ownerLabel(latest.createdByUserId, currentUserId)}</span>
            </li>
          ) : null}
        </ul>
      </InspectorSection>

      <div className="flex gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          className="flex-1"
          disabled={!published}
          onClick={() => published && onInstantiate(published.id)}
        >
          Create notebook
        </Button>
      </div>
      {canEdit ? null : (
        <p className="text-xs text-muted-foreground">
          You have read-only access to this template.
        </p>
      )}
    </>
  )

  return (
    <Inspector
      recordType="Notebook template"
      title={template.name}
      status={
        latest ? (
          <StatusBadge
            status={latest.lifecycle}
            vocabulary={unifiedTemplateStatusVocabulary}
          />
        ) : undefined
      }
      tabs={[{ id: 'details', label: 'Details', content: detailsContent }]}
    />
  )
}
