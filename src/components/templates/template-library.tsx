/**
 * SCI-006 Template Library presentational components: list, filters, and
 * preview inspector with the use-template action. Extracted from the route
 * so they are independently testable. All data fetching lives in the route;
 * these components are pure functions of their props.
 */
import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Archive, FileWarning, Search } from 'lucide-react'

import { BlockPreview } from '#/components/notebook'
import { Inspector, InspectorSection, EmptyHint } from '#/components/record'
import { StatusBadge } from '#/components/scientific'
import { Badge } from '#/components/ui'
import { cn } from '#/lib/utils'
import {
  isInstantiable,
  isTemplateKind,
  TEMPLATE_KIND_LABEL,
} from '#/lib/templates'
import type { TemplateKind } from '#/lib/templates'
import type { NotebookRecord, NotebookBlock } from '#/lib/notebook-data'

export interface TemplateProject {
  id: string
  key: string
  title: string
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
}: {
  kindFilter: 'all' | TemplateKind
  onKindChange: (value: 'all' | TemplateKind) => void
  statusFilter: string
  onStatusChange: (value: string) => void
  search: string
  onSearchChange: (value: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative flex-1 min-w-[200px]">
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
          placeholder="Search templates"
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
    </div>
  )
}

// ---------------------------------------------------------------------------
// Template list
// ---------------------------------------------------------------------------

export function TemplateList({
  templates,
  isLoading,
  error,
  selectedId,
  onSelect,
  onRetry,
}: {
  templates: NotebookRecord[]
  isLoading: boolean
  error: unknown
  selectedId: string | null
  onSelect: (id: string) => void
  onRetry: () => void
}) {
  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground" aria-busy="true">
        Loading templates…
      </p>
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
    <ul
      className="divide-y divide-border rounded-md border border-border"
      role="list"
    >
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
                'flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-muted/40',
                isSelected && 'bg-muted/60',
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-foreground">
                    {template.title}
                  </p>
                  {template.archivedAt ? (
                    <Badge variant="outline" className="text-[10px]">
                      <Archive className="size-3" aria-hidden="true" />
                      Archived
                    </Badge>
                  ) : null}
                </div>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {template.identifier}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {kind ? (
                  <span className="text-xs text-muted-foreground">
                    {TEMPLATE_KIND_LABEL[kind]}
                  </span>
                ) : null}
                <StatusBadge
                  status={template.status}
                  domain={
                    template.kind === 'notebook_template'
                      ? 'notebook_template'
                      : 'protocol'
                  }
                />
                {instantiable ? (
                  <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
                    Ready
                  </span>
                ) : null}
              </div>
            </button>
          </li>
        )
      })}
    </ul>
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
      <dl className="space-y-1 text-sm">
        <div className="flex gap-2">
          <dt className="w-20 text-muted-foreground">Title</dt>
          <dd className="font-medium">{template.title}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-20 text-muted-foreground">ID</dt>
          <dd className="font-mono text-xs">{template.identifier}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-20 text-muted-foreground">Type</dt>
          <dd>{kind ? TEMPLATE_KIND_LABEL[kind] : template.kind}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-20 text-muted-foreground">Status</dt>
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
        {template.archivedAt ? (
          <div className="flex gap-2">
            <dt className="w-20 text-muted-foreground">Archived</dt>
            <dd className="text-xs text-muted-foreground">
              {new Date(template.archivedAt).toLocaleDateString()}
            </dd>
          </div>
        ) : null}
        <div className="flex gap-2">
          <dt className="w-20 text-muted-foreground">Created</dt>
          <dd className="text-xs text-muted-foreground">
            {new Date(template.createdAt).toLocaleDateString()}
          </dd>
        </div>
      </dl>

      {canInstantiate ? (
        <InspectorSection title="Use this template">
          {instantiationSuccess ? (
            <div className="space-y-2">
              <p className="text-sm text-success">
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
          <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/5 p-3">
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
