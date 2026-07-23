/**
 * SCI-006 Template Library presentational components: a dense, scannable
 * template list with column headers, a filter bar with result count, and a
 * preview inspector with Details/Preview tabs and the use-template action.
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
 */
import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Archive, CheckCircle2, FileWarning, Search } from 'lucide-react'

import { BlockPreview } from '#/components/notebook'
import { EmptyHint, Inspector, InspectorSection } from '#/components/record'
import { StatusBadge } from '#/components/scientific'
import { Badge, Skeleton } from '#/components/ui'
import { cn } from '#/lib/utils'
import {
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

// ---------------------------------------------------------------------------
// Time helpers
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
}: {
  kindFilter: 'all' | TemplateKind
  onKindChange: (value: 'all' | TemplateKind) => void
  statusFilter: string
  onStatusChange: (value: string) => void
  search: string
  onSearchChange: (value: string) => void
  /** Optional result count rendered at the right of the bar. */
  count?: number
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
// Template list
// ---------------------------------------------------------------------------

/**
 * Column header for the dense list. Hidden on narrow screens where the
 * secondary columns collapse. Uses a non-interactive row mirroring the
 * list row grid so labels align with the data below.
 */
function TemplateListHeader() {
  return (
    <div
      className="hidden items-center gap-4 border-b border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground sm:flex"
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

export function TemplateList({
  templates,
  isLoading,
  error,
  selectedId,
  onSelect,
  onRetry,
  blockCounts = {},
}: {
  templates: NotebookRecord[]
  isLoading: boolean
  error: unknown
  selectedId: string | null
  onSelect: (id: string) => void
  onRetry: () => void
  /** Map of template id → block count, for the Blocks column. */
  blockCounts?: Record<string, number>
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
          return (
            <li key={template.id}>
              <button
                type="button"
                onClick={() => onSelect(template.id)}
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
                  <span className="block truncate text-sm font-medium text-foreground">
                    {template.title}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {kind ? (
                    <Badge variant="outline" className="text-[10px]">
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
                <span className="flex w-16 shrink-0 justify-end">
                  {template.archivedAt ? (
                    <Badge variant="outline" className="text-[10px]">
                      <Archive className="size-3" aria-hidden="true" />
                      Archived
                    </Badge>
                  ) : instantiable ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
                      <CheckCircle2 className="size-3" aria-hidden="true" />
                      Ready
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
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
}: {
  template: NotebookRecord
  blocks: NotebookBlock[]
  blocksLoading: boolean
  projects: TemplateProject[]
  onInstantiate: (title: string, projectId: string) => void
  isInstantiating: boolean
  instantiationError: string | null
  instantiationSuccess: { recordId: string; projectId: string } | null
}) {
  const [title, setTitle] = useState(template.title)
  const [projectId, setProjectId] = useState('')

  const kind = isTemplateKind(template.kind) ? template.kind : null
  const canInstantiate = kind
    ? isInstantiable(kind, template.status, template.archivedAt)
    : false

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

      {canInstantiate ? (
        <InspectorSection title="Use this template">
          {instantiationSuccess ? (
            <div className="space-y-2">
              <p className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-300">
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
          <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
            <FileWarning
              className="size-4 shrink-0 text-amber-600 dark:text-amber-400"
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
