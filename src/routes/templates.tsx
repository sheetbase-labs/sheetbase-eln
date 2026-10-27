import { useMemo, useState } from 'react'
import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useOpenRow } from '#/components/workspace/workspace-navigation'
import { Status } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Badge } from '#/components/v3/ui/badge'
import { Button } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from '#/components/v3/ui/dialog'
import { Field, Input } from '#/components/v3/ui/input'
import { toast } from '#/components/v3/ui/sonner'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
  Muted,
} from '#/components/v3/ui/layout'
import {
  ListFooter,
  ListHeader,
  ListToolbar,
  MobileList,
  footerCount,
  Textarea,
  nameSorts,
  sortByName,
} from '#/components/v3/inventory/list'
import type { NameSort } from '#/components/v3/inventory/list'
import {
  RegistryGrid,
  rightAligned,
  useRowFocus,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { Tabs } from '#/components/v3/ui/tabs'
import {
  templateDataQueryKeys,
  templateLifecycle,
  useTemplateRows,
} from '#/components/v3/templates/templates-data'
import type { TemplateRow } from '#/components/v3/templates/templates-data'
import { useWorkspaceMemberNames } from '#/components/v3/projects/project-data'
import { UseTemplateDialog } from '#/components/v3/templates/use-template-dialog'
import { createNotebookTemplate } from '#/lib/notebook-template-data'
import { signInRedirect } from '#/lib/sign-in-redirect'

const tabs = ['all', 'active', 'retired'] as const
type TemplateTab = (typeof tabs)[number]
const tabLabel: Record<TemplateTab, string> = {
  all: 'All',
  active: 'Active',
  retired: 'Retired',
}

/** The key format the catalogue and the create RPC both accept. */
const templateKeyPattern = /^[a-z][a-z0-9_]{0,59}$/

/** UI port (roadmap-4/ui-app3): the Templates board on the CORE-06 notebook
 * template catalogue. Templates pin immutable published versions; a new version
 * never changes work already made. */
export const Route = createFileRoute('/templates')({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    q?: string
    tab?: TemplateTab
    selected?: string
    template?: string
    protocol?: string
  } => ({
    q: typeof search.q === 'string' ? search.q : undefined,
    selected: typeof search.selected === 'string' ? search.selected : undefined,
    template: typeof search.template === 'string' ? search.template : undefined,
    protocol: typeof search.protocol === 'string' ? search.protocol : undefined,
    tab:
      search.tab === 'active' ||
      search.tab === 'retired' ||
      search.tab === 'all'
        ? search.tab
        : undefined,
  }),
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
    }
    return { context }
  },
  component: TemplatesRoute,
})

function TemplatesRoute() {
  const isIndex = useRouterState({
    select: (state) => state.location.pathname === '/templates',
  })
  return isIndex ? <TemplatesList /> : <Outlet />
}

function inTab(t: TemplateRow, tab: TemplateTab): boolean {
  if (tab === 'all') return true
  if (tab === 'active') return t.lifecycle === 'active'
  return t.lifecycle === 'retired'
}

function TemplatesList() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const query = useTemplateRows()
  const rows = query.data ?? []
  const members = useWorkspaceMemberNames()
  const ownerName = (id: string | null) =>
    id ? (members.data?.get(id) ?? '—') : '—'
  const tab: TemplateTab = search.tab ?? 'all'
  const [selected, setSelected] = useState<string | null>(null)
  const [sort, setSort] = useState<NameSort>('Name')
  const openTemplate = useOpenRow<TemplateRow>(
    navigate,
    (row) => `/templates/${encodeURIComponent(row.id)}`,
    (row) => row.name,
  )

  const counts = useMemo(
    () =>
      Object.fromEntries(
        tabs.map((t) => [t, rows.filter((r) => inTab(r, t)).length]),
      ) as Record<TemplateTab, number>,
    [rows],
  )
  const queryText = (search.q ?? '').trim()
  const q = queryText.toLowerCase()
  const visible = sortByName(
    rows
      .filter((t) => inTab(t, tab))
      .filter((t) => !q || `${t.key} ${t.name}`.toLowerCase().includes(q)),
    sort,
    (t) => t.name,
    (t) => t.displayId ?? t.key,
  )
  const wanted = search.selected ?? search.template ?? search.protocol
  const sel =
    visible.find((t) => t.id === (selected ?? wanted)) ?? visible.at(0)

  const columns = useMemo<RegistryColumn<TemplateRow>[]>(
    () => [
      {
        id: 'identifier',
        header: 'ID',
        cell: ({ row }) => (
          <span className="mono">{row.original.displayId ?? '—'}</span>
        ),
      },
      {
        id: 'template',
        header: 'Template',
        cell: ({ row }) => (
          <Link
            to="/templates/$templateId"
            params={{ templateId: row.original.id }}
            onClick={(event) => openTemplate(row.original, event)}
            className={row.getIsSelected() ? 'font-medium' : undefined}
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: 'kind',
        header: 'Kind',
        cell: () => <Badge variant="kind">Notebook</Badge>,
      },
      {
        id: 'version',
        header: 'Version',
        meta: rightAligned<TemplateRow>().meta,
        cell: ({ row }) =>
          row.original.published
            ? `v${row.original.published.version}`
            : row.original.latest
              ? `v${row.original.latest.version} draft`
              : '—',
      },
      {
        id: 'sections',
        header: 'Sections',
        accessorFn: (t) => t.sectionCount,
        meta: rightAligned<TemplateRow>().meta,
      },
      {
        id: 'inUse',
        header: 'In use',
        meta: rightAligned<TemplateRow>().meta,
        cell: ({ row }) => (
          <span
            className={row.original.inUse === 0 ? 'text-fg-muted' : undefined}
          >
            {row.original.inUse}
          </span>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row }) => {
          const status = templateLifecycle(row.original.lifecycle)
          return <Status tone={status.tone}>{status.label}</Status>
        },
      },
      {
        id: 'owner',
        header: 'Owner',
        meta: { cellClassName: 'text-fg-muted' },
        cell: ({ row }) => ownerName(row.original.createdByUserId),
      },
    ],
    [members.data, openTemplate],
  )

  const { rowSelection, onRowSelectionChange } = useRowFocus(
    sel?.id ?? null,
    setSelected,
  )

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <ListHeader
          title="Templates"
          total={rows.length}
          actions={<NewTemplateDialog />}
          tabs={
            <Tabs
              mode="url"
              label="Template lists"
              value={tab}
              items={tabs.map((t) => ({
                key: t,
                label: tabLabel[t],
                count: query.isLoading ? undefined : counts[t],
                link: {
                  to: '/templates',
                  search: { tab: t === 'all' ? undefined : t, q: search.q },
                },
              }))}
            />
          }
        />
        <ListToolbar
          q={search.q}
          label="Search templates"
          placeholder="Search templates"
          views={{
            sorts: [...nameSorts],
            sort,
            onSort: (s) => setSort(s as NameSort),
          }}
          onSearch={(next) =>
            void navigate({
              to: '/templates',
              search: (s) => ({ ...s, q: next || undefined }),
              replace: true,
            })
          }
        />
        <div className="min-h-0 flex-1 overflow-auto">
          {query.isLoading || visible.length > 0 ? (
            <RegistryGrid
              className="max-md:hidden"
              label="Templates"
              rows={visible}
              columns={columns}
              getRowId={(t) => t.id}
              rowSelection={rowSelection}
              onRowSelectionChange={onRowSelectionChange}
              onRowClick={openTemplate}
              isLoading={query.isLoading}
            />
          ) : null}
          <MobileList
            label="Templates"
            items={visible.map((t) => {
              const status = templateLifecycle(t.lifecycle)
              return {
                key: t.id,
                id: t.displayId ?? t.key,
                title: t.name,
                sub: `${t.sectionCount} sections · ${t.inUse} in use · ${ownerName(t.createdByUserId)}`,
                status: <Status tone={status.tone}>{status.label}</Status>,
                link: {
                  to: '/templates/$templateId',
                  params: { templateId: t.id },
                },
              }
            })}
          />
          {!query.isLoading && visible.length === 0 ? (
            <div role="status" className="flex justify-center px-6">
              <EmptyState
                icon={q ? 'search' : 'template'}
                className="items-center py-14 text-center"
                title={
                  q
                    ? `No templates match “${search.q}”`
                    : `No templates in ${tabLabel[tab].toLowerCase()}`
                }
                description={
                  q
                    ? 'Search looks at template keys and names.'
                    : 'A template holds the sections and parameters a notebook is made from.'
                }
                action={
                  q ? (
                    <Button
                      nativeButton={false}
                      render={
                        <Link to="/templates" search={{ tab: search.tab }} />
                      }
                    >
                      Clear search
                    </Button>
                  ) : (
                    <NewTemplateDialog />
                  )
                }
              />
            </div>
          ) : null}
        </div>
        <ListFooter right={sel ? '1 selected' : undefined}>
          {footerCount({
            shown: visible.length,
            total: counts[tab],
            one: 'template',
            tab: tabLabel[tab],
            query: queryText,
          })}
        </ListFooter>
      </div>

      {sel ? (
        <Inspector
          aria-label="Template details"
          className="w-[320px] gap-0 p-0"
        >
          <div className="flex flex-col gap-1 border-b border-border px-4 pb-3 pt-3.5">
            <span className="mono text-fg-muted">{sel.key}</span>
            <div className="font-heading text-doc font-semibold">
              {sel.name}
            </div>
            <div className="text-label">
              <Status tone={templateLifecycle(sel.lifecycle).tone}>
                {templateLifecycle(sel.lifecycle).label}
              </Status>
            </div>
            {sel.description ? (
              <Muted className="mt-1">{sel.description}</Muted>
            ) : null}
            <div className="mt-1.5 flex gap-1.5">
              <Button
                size="sm"
                variant="primary"
                nativeButton={false}
                render={
                  <Link
                    to="/templates/$templateId"
                    params={{ templateId: sel.id }}
                  />
                }
              >
                Open
              </Button>
              <UseTemplateDialog
                size="sm"
                variant="secondary"
                templateName={sel.name}
                version={sel.published}
              />
            </div>
            {sel.published ? null : (
              <Muted className="mt-1">
                No published version yet. Publish one from Versions, then you
                can start a notebook from it.
              </Muted>
            )}
          </div>
          <div className="flex flex-col gap-4 px-4 py-3.5">
            <InspectorSection title="Details">
              <DescriptionList
                labelWidth={80}
                items={[
                  ['Key', sel.key],
                  [
                    'Published',
                    sel.published ? `v${sel.published.version}` : '—',
                  ],
                  ['Versions', String(sel.versions.length)],
                  ['Sections', String(sel.sectionCount)],
                  ['In use', String(sel.inUse)],
                ]}
              />
            </InspectorSection>
            <InspectorSection title="Versions">
              <div className="flex flex-col text-label">
                {sel.versions.length ? (
                  [...sel.versions].reverse().map((v, i, list) => (
                    <div
                      key={v.id}
                      className={`grid grid-cols-[40px_1fr_auto] gap-2 py-1.5 ${
                        i < list.length - 1
                          ? 'border-b border-border-subtle'
                          : ''
                      }`}
                    >
                      <b className="font-medium">v{v.version}</b>
                      <span>{templateLifecycle(v.lifecycle).label}</span>
                      <span className="text-fg-muted">
                        {v.publishedAt ? v.publishedAt.slice(0, 10) : '—'}
                      </span>
                    </div>
                  ))
                ) : (
                  <Muted>No version yet.</Muted>
                )}
              </div>
            </InspectorSection>
            <InspectorSection title="Reuse is deliberate">
              <Muted>
                New versions never change notebooks already made from an old
                one; each owner chooses whether to take a new version.
              </Muted>
            </InspectorSection>
          </div>
        </Inspector>
      ) : null}
    </div>
  )
}

/** Creating a template opens an empty draft version, so the new catalogue
 * entry has somewhere to hang its sections and parameters. */
function NewTemplateDialog() {
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const navigate = useNavigate({ from: Route.fullPath })
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const create = useMutation({
    mutationFn: () =>
      createNotebookTemplate({
        workspaceId,
        key: key.trim(),
        name: name.trim(),
        description: description.trim() || null,
        configuration: { formatVersion: 1, parameters: [], placements: [] },
      }),
    onSuccess: ({ template }) => {
      void queryClient.invalidateQueries({
        queryKey: templateDataQueryKeys.list,
      })
      setOpen(false)
      toast(`${template.name} created`, {
        description: 'Add its sections and parameters, then save a version.',
      })
      void navigate({
        to: '/templates/$templateId',
        params: { templateId: template.id },
      })
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not create the template.',
      )
    },
  })

  const trimmedKey = key.trim()
  const trimmedName = name.trim()
  const keyOk = templateKeyPattern.test(trimmedKey)
  const keyError =
    trimmedKey.length > 0 && !keyOk
      ? 'Lowercase letters, digits and underscore, starting with a letter.'
      : null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setKey('')
          setName('')
          setDescription('')
        }
      }}
    >
      <DialogTrigger render={<Button variant="primary" icon="plus" />}>
        New template
      </DialogTrigger>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title="New template"
          description="A template holds the sections and parameters a notebook is made from. Saving later makes a new version; notebooks already made keep the one they started on."
        />
        <DialogBody>
          <Field
            label="Key"
            required
            hint="Lowercase letters, digits and underscore, e.g. depth_filter."
            error={keyError}
          >
            <Input
              autoFocus
              className="mono"
              value={key}
              aria-invalid={keyError ? true : undefined}
              placeholder="depth_filter"
              onChange={(e) => setKey(e.target.value)}
            />
          </Field>
          <Field label="Name" required>
            <Input
              value={name}
              placeholder="e.g. Depth-filter clarification screen"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Description" hint="Optional">
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={create.isPending || !keyOk || trimmedName.length === 0}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Creating…' : 'Create template'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
