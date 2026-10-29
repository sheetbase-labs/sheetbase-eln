import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { formatDate } from '#/lib/format-date'
import { t } from '#/copy'

const tabs = ['all', 'active', 'retired'] as const
type TemplateTab = (typeof tabs)[number]
const tabLabel: Record<TemplateTab, string> = {
  all: t('library.templates.list.all'),
  active: t('library.templates.list.active'),
  retired: t('library.templates.list.retired'),
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
    new?: true
  } => ({
    new: search.new === true || search.new === 'true' ? true : undefined,
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

function inTab(item: TemplateRow, tab: TemplateTab): boolean {
  if (tab === 'all') return true
  if (tab === 'active') return item.lifecycle === 'active'
  return item.lifecycle === 'retired'
}

function TemplatesList() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const dropNewFlag = useCallback(() => {
    void navigate({
      search: (current) => ({ ...current, new: undefined }),
      replace: true,
    })
  }, [navigate])
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
        tabs.map((item) => [item, rows.filter((r) => inTab(r, item)).length]),
      ) as Record<TemplateTab, number>,
    [rows],
  )
  const queryText = (search.q ?? '').trim()
  const q = queryText.toLowerCase()
  const visible = sortByName(
    rows
      .filter((item) => inTab(item, tab))
      .filter(
        (item) => !q || `${item.key} ${item.name}`.toLowerCase().includes(q),
      ),
    sort,
    (item) => item.name,
    (item) => item.displayId ?? item.key,
  )
  const wanted = search.selected ?? search.template ?? search.protocol
  const sel =
    visible.find((item) => item.id === (selected ?? wanted)) ?? visible.at(0)

  const columns = useMemo<RegistryColumn<TemplateRow>[]>(
    () => [
      {
        id: 'identifier',
        header: t('library.templates.list.id'),
        cell: ({ row }) => (
          <span className="mono">{row.original.displayId ?? '—'}</span>
        ),
      },
      {
        id: 'template',
        header: t('library.templates.list.template'),
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
        header: t('library.templates.list.kind'),
        cell: () => (
          <Badge variant="kind">{t('library.templates.list.notebook')}</Badge>
        ),
      },
      {
        id: 'version',
        header: t('library.templates.list.version'),
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
        header: t('library.templates.list.sections'),
        accessorFn: (item) => item.sectionCount,
        meta: rightAligned<TemplateRow>().meta,
      },
      {
        id: 'inUse',
        header: t('library.templates.list.inUse'),
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
        header: t('library.templates.list.status'),
        cell: ({ row }) => {
          const status = templateLifecycle(row.original.lifecycle)
          return <Status tone={status.tone}>{status.label}</Status>
        },
      },
      {
        id: 'owner',
        header: t('library.templates.list.owner'),
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
          title={t('library.templates.list.templates')}
          total={query.isPending ? undefined : rows.length}
          actions={
            <NewTemplateDialog
              autoOpen={search.new === true}
              onAutoOpened={dropNewFlag}
            />
          }
          tabs={
            <Tabs
              mode="url"
              label={t('library.templates.list.templateLists')}
              value={tab}
              items={tabs.map((item) => ({
                key: item,
                label: tabLabel[item],
                count: query.isPending ? undefined : counts[item],
                link: {
                  to: '/templates',
                  search: {
                    tab: item === 'all' ? undefined : item,
                    q: search.q ?? '',
                  },
                },
              }))}
            />
          }
        />
        <ListToolbar
          q={search.q}
          label={t('library.templates.list.searchTemplates')}
          placeholder={t('library.templates.list.searchTemplates')}
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
          {query.isPending || visible.length > 0 ? (
            <RegistryGrid
              className="max-md:hidden"
              label={t('library.templates.list.templates')}
              rows={visible}
              columns={columns}
              getRowId={(item) => item.id}
              rowSelection={rowSelection}
              onRowSelectionChange={onRowSelectionChange}
              onRowClick={openTemplate}
              isLoading={query.isPending}
            />
          ) : null}
          <MobileList
            label={t('library.templates.list.templates')}
            items={visible.map((item) => {
              const status = templateLifecycle(item.lifecycle)
              return {
                key: item.id,
                id: item.displayId ?? item.key,
                title: item.name,
                sub: `${item.sectionCount} sections · ${item.inUse} in use · ${ownerName(item.createdByUserId)}`,
                status: <Status tone={status.tone}>{status.label}</Status>,
                link: {
                  to: '/templates/$templateId',
                  params: { templateId: item.id },
                },
              }
            })}
          />
          {!query.isPending && visible.length === 0 ? (
            <div role="status" className="flex justify-center px-6">
              <EmptyState
                icon={q ? 'search' : 'template'}
                className="items-center py-14 text-center"
                title={
                  q
                    ? t('library.templates.list.noTemplatesMatch', {
                        q: search.q ?? '',
                      })
                    : t('library.templates.list.noTemplatesIn', {
                        toLowerCase: tabLabel[tab].toLowerCase(),
                      })
                }
                description={
                  q
                    ? t('library.templates.list.searchLooksAtTemplateKeys')
                    : t('library.templates.list.aTemplateHoldsTheSections')
                }
                action={
                  q ? (
                    <Button
                      nativeButton={false}
                      render={
                        <Link to="/templates" search={{ tab: search.tab }} />
                      }
                    >
                      {t('library.templates.list.clearSearch')}
                    </Button>
                  ) : (
                    <NewTemplateDialog />
                  )
                }
              />
            </div>
          ) : null}
        </div>
        <ListFooter
          loading={query.isPending}
          right={sel ? '1 selected' : undefined}
        >
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
          aria-label={t('library.templates.list.templateDetails')}
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
                {t('common.actions.open')}
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
                {t('library.templates.list.noPublishedVersionYetPublish')}
              </Muted>
            )}
          </div>
          <div className="flex flex-col gap-4 px-4 py-3.5">
            <InspectorSection title={t('library.templates.list.details')}>
              <DescriptionList
                labelWidth={80}
                items={[
                  [t('library.templates.list.key'), sel.key],
                  [
                    t('library.templates.list.published'),
                    sel.published ? `v${sel.published.version}` : '—',
                  ],
                  [
                    t('library.templates.list.versions'),
                    String(sel.versions.length),
                  ],
                  [
                    t('library.templates.list.sections'),
                    String(sel.sectionCount),
                  ],
                  [t('library.templates.list.inUse'), String(sel.inUse)],
                ]}
              />
            </InspectorSection>
            <InspectorSection title={t('library.templates.list.versions')}>
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
                        {formatDate(v.publishedAt)}
                      </span>
                    </div>
                  ))
                ) : (
                  <Muted>{t('library.templates.list.noVersionYet')}</Muted>
                )}
              </div>
            </InspectorSection>
            <InspectorSection
              title={t('library.templates.list.reuseIsDeliberate')}
            >
              <Muted>
                {t('library.templates.list.newVersionsNeverChangeNotebooks')}
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
function NewTemplateDialog({
  autoOpen = false,
  onAutoOpened,
}: {
  autoOpen?: boolean
  onAutoOpened?: () => void
}) {
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const navigate = useNavigate({ from: Route.fullPath })
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  // The shell's New menu arrives with `?new=true`: the page that owns the flag
  // asks for the dialog to open once, then drops the flag.
  useEffect(() => {
    if (!autoOpen) return
    setOpen(true)
    onAutoOpened?.()
  }, [autoOpen, onAutoOpened])
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
        description: t('library.templates.list.addItsSectionsAndParameters'),
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
          : t('library.templates.list.couldNotCreateTheTemplate'),
      )
    },
  })

  const trimmedKey = key.trim()
  const trimmedName = name.trim()
  const keyOk = templateKeyPattern.test(trimmedKey)
  const keyError =
    trimmedKey.length > 0 && !keyOk
      ? t('library.templates.list.lowercaseLettersDigitsAndUnderscore')
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
        {t('library.templates.list.newTemplate')}
      </DialogTrigger>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title={t('library.templates.list.newTemplate')}
          description={t('library.templates.list.aTemplateHoldsTheSections2')}
        />
        <DialogBody>
          <Field
            label={t('library.templates.list.key')}
            required
            hint={t(
              'library.templates.list.lowercaseLettersDigitsAndUnderscore2',
            )}
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
          <Field label={t('library.templates.list.name')} required>
            <Input
              value={name}
              placeholder={t(
                'library.templates.list.eGDepthFilterClarification',
              )}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field
            label={t('library.templates.list.description')}
            hint={t('common.states.optional')}
          >
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={create.isPending || !keyOk || trimmedName.length === 0}
            onClick={() => create.mutate()}
          >
            {create.isPending
              ? t('library.templates.list.creating')
              : t('library.templates.list.createTemplate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
