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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import {
  ListFooter,
  ListHeader,
  ListToolbar,
  MobileList,
  SearchTabs,
  Textarea,
  stickyCell,
  stickyHead,
} from '#/components/v3/inventory/list'
import {
  templateDataQueryKeys,
  templateLifecycle,
  useTemplateRows,
} from '#/components/v3/templates/templates-data'
import type { TemplateRow } from '#/components/v3/templates/templates-data'
import { useWorkspaceMemberNames } from '#/components/v3/projects/project-data'
import { createNotebookTemplate } from '#/lib/notebook-template-data'

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
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
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

  const counts = useMemo(
    () =>
      Object.fromEntries(
        tabs.map((t) => [t, rows.filter((r) => inTab(r, t)).length]),
      ) as Record<TemplateTab, number>,
    [rows],
  )
  const queryText = (search.q ?? '').trim()
  const q = queryText.toLowerCase()
  const tabName = tabLabel[tab].toLowerCase()
  const visible = rows
    .filter((t) => inTab(t, tab))
    .filter((t) => !q || `${t.key} ${t.name}`.toLowerCase().includes(q))
  const wanted = search.selected ?? search.template ?? search.protocol
  const sel =
    visible.find((t) => t.id === (selected ?? wanted)) ?? visible.at(0)

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <ListHeader
          title="Templates"
          total={rows.length}
          actions={<NewTemplateDialog />}
          tabs={
            <SearchTabs
              label="Template lists"
              current={tab}
              items={tabs.map((t) => ({
                key: t,
                label: tabLabel[t],
                count: counts[t],
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
          onSearch={(next) =>
            void navigate({
              to: '/templates',
              search: (s) => ({ ...s, q: next || undefined }),
              replace: true,
            })
          }
        />
        <div className="min-h-0 flex-1 overflow-auto">
          <Table aria-label="Templates" className="max-lg:hidden">
            <TableHeader>
              <TableRow>
                <TableHead className={stickyHead}>ID</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead align="right">Version</TableHead>
                <TableHead align="right">Sections</TableHead>
                <TableHead align="right">In use</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Owner</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((t) => {
                const status = templateLifecycle(t.lifecycle)
                return (
                  <TableRow
                    key={t.id}
                    selected={t.id === sel?.id}
                    className="cursor-pointer"
                    onClick={() => setSelected(t.id)}
                  >
                    <TableCell className={stickyCell}>
                      <span className="mono">{t.displayId ?? '—'}</span>
                    </TableCell>
                    <TableCell className="text-fg-muted">
                      <span className="mono">{t.key}</span>
                    </TableCell>
                    <TableCell
                      className={t.id === sel?.id ? 'font-medium' : undefined}
                    >
                      <Link
                        to="/templates/$templateId"
                        params={{ templateId: t.id }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {t.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="kind">Notebook</Badge>
                    </TableCell>
                    <TableCell align="right">
                      {t.published
                        ? `v${t.published.version}`
                        : t.latest
                          ? `v${t.latest.version} draft`
                          : '—'}
                    </TableCell>
                    <TableCell align="right">{t.sectionCount}</TableCell>
                    <TableCell
                      align="right"
                      className={t.inUse === 0 ? 'text-fg-muted' : undefined}
                    >
                      {t.inUse}
                    </TableCell>
                    <TableCell>
                      <Status tone={status.tone}>{status.label}</Status>
                    </TableCell>
                    <TableCell className="text-fg-muted">
                      {ownerName(t.createdByUserId)}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
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
                body="Search looks at template keys and names."
              />
            </div>
          ) : null}
        </div>
        <ListFooter right={sel ? '1 selected' : undefined}>
          {queryText
            ? `${visible.length} matching “${queryText}” of ${counts[tab]} ${tabName}`
            : `${visible.length} of ${counts[tab]} ${tabName}`}
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
            </div>
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
