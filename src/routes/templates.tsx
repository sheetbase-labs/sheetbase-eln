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
import { z } from 'zod'

import { useOpenRow } from '#/components/workspace/workspace-navigation'
import { Status } from '#/components/ui/status'
import { EmptyState } from '#/components/ui/empty-state'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from '#/components/ui/dialog'
import { Field, Input } from '#/components/ui/input'
import { toast } from '#/components/ui/sonner'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
  Muted,
} from '#/components/ui/layout'
import {
  ListFooter,
  ListHeader,
  ListToolbar,
  MobileList,
  footerCount,
  Textarea,
  sortByName,
} from '#/components/inventory/list'
import {
  RegistryGrid,
  rightAligned,
  useRowFocus,
} from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { Tabs } from '#/components/ui/tabs'
import {
  templateDataQueryKeys,
  templateLifecycle,
  useTemplateRows,
} from '#/components/templates/templates-data'
import type { TemplateRow } from '#/components/templates/templates-data'
import { useWorkspaceMemberNames } from '#/components/projects/project-data'
import { UseTemplateDialog } from '#/components/templates/use-template-dialog'
import { createNotebookTemplate } from '#/lib/notebook-template-data'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { useListView } from '#/lib/list-views'
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

/** The board's address bar: which tab, search text and row it names. Anything
 * else in the address is dropped, and a value of the wrong kind reads as absent. */
const templateSearchSchema = z.object({
  q: z.string().optional().catch(undefined),
  tab: z.enum(tabs).optional().catch(undefined),
  selected: z.string().optional().catch(undefined),
  template: z.string().optional().catch(undefined),
  protocol: z.string().optional().catch(undefined),
  new: z
    .union([z.literal(true), z.literal('true')])
    .transform((value) => value === true)
    .optional()
    .catch(undefined),
})

/** UI port (roadmap-4/ui-app3): the Templates board on the CORE-06 notebook
 * template catalogue. Templates pin immutable published versions; a new version
 * never changes work already made. */
export const Route = createFileRoute('/templates')({
  validateSearch: (search) => templateSearchSchema.parse(search),
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
  const rows = useMemo(() => query.data ?? [], [query.data])
  const members = useWorkspaceMemberNames()

  const ownerName = useCallback(
    (id: string | null) => (id ? (members.data?.get(id) ?? '—') : '—'),
    [members.data],
  )

  const tab: TemplateTab = search.tab ?? 'all'
  const [selected, setSelected] = useState<string | null>(null)
  const view = useListView('templates')

  const openTemplate = useOpenRow<TemplateRow>(
    navigate,
    (row) => `/templates/${encodeURIComponent(row.id)}`,
    (row) => row.name,
  )

  const counts = useMemo<Record<TemplateTab, number>>(
    () => ({
      all: rows.filter((item) => inTab(item, 'all')).length,
      active: rows.filter((item) => inTab(item, 'active')).length,
      retired: rows.filter((item) => inTab(item, 'retired')).length,
    }),
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
    'Name',
    (item) => item.name,
    (item) => item.displayId ?? item.key,
  )

  const wanted = search.selected ?? search.template ?? search.protocol

  const sel =
    visible.find((item) => item.id === (selected ?? wanted)) ?? visible.at(0)

  const columns = useTemplateColumns({ ownerName, openTemplate })

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
          onSearch={(next) =>
            void navigate({
              to: '/templates',
              search: (s) => ({ ...s, q: next || undefined }),
              replace: true,
            })
          }
        />
        <div className="min-h-0 flex-1 overflow-auto max-md:pb-20">
          {query.isPending || visible.length > 0 ? (
            <RegistryGrid
              className="max-md:hidden"
              label={t('library.templates.list.templates')}
              view={view}
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
            <TemplateEmptyState q={q} queryText={search.q} tab={tab} />
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

      {sel ? <TemplateInspector template={sel} /> : null}
    </div>
  )
}

/** The selected template's facts and versions, beside the board. */
function TemplateInspector({ template }: { template: TemplateRow }) {
  return (
    <Inspector
      aria-label={t('library.templates.list.templateDetails')}
      className="w-[320px] gap-0 p-0"
    >
      <div className="flex flex-col gap-1 border-b border-border px-4 pb-3 pt-3.5">
        <span className="mono text-fg-muted">{template.key}</span>
        <div className="font-heading text-doc font-semibold">
          {template.name}
        </div>
        <div className="text-label">
          <Status tone={templateLifecycle(template.lifecycle).tone}>
            {templateLifecycle(template.lifecycle).label}
          </Status>
        </div>
        {template.description ? (
          <Muted className="mt-1">{template.description}</Muted>
        ) : null}
        <div className="mt-1.5 flex gap-1.5">
          <Button
            size="sm"
            variant="primary"
            nativeButton={false}
            render={
              <Link
                to="/templates/$templateId"
                params={{ templateId: template.id }}
              />
            }
          >
            {t('common.actions.open')}
          </Button>
          <UseTemplateDialog
            size="sm"
            variant="secondary"
            templateName={template.name}
            version={template.published}
          />
        </div>
        {template.published ? null : (
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
              [t('library.templates.list.key'), template.key],
              [
                t('library.templates.list.published'),
                template.published ? `v${template.published.version}` : '—',
              ],
              [
                t('library.templates.list.versions'),
                String(template.versions.length),
              ],
              [
                t('library.templates.list.sections'),
                String(template.sectionCount),
              ],
              [t('library.templates.list.inUse'), String(template.inUse)],
            ]}
          />
        </InspectorSection>
        <InspectorSection title={t('library.templates.list.versions')}>
          <div className="flex flex-col text-label">
            {template.versions.length ? (
              [...template.versions].reverse().map((v, i, list) => (
                <div
                  key={v.id}
                  className={`grid grid-cols-[40px_1fr_auto] gap-2 py-1.5 ${
                    i < list.length - 1 ? 'border-b border-border-subtle' : ''
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
        <InspectorSection title={t('library.templates.list.reuseIsDeliberate')}>
          <Muted>
            {t('library.templates.list.newVersionsNeverChangeNotebooks')}
          </Muted>
        </InspectorSection>
      </div>
    </Inspector>
  )
}

/** What the board says when the tab and the search text match nothing. */
function TemplateEmptyState({
  q,
  queryText,
  tab,
}: {
  q: string
  queryText: string | undefined
  tab: TemplateTab
}) {
  const searching = q.length > 0

  return (
    <div role="status" className="flex justify-center px-6">
      <EmptyState
        icon={searching ? 'search' : 'template'}
        className="items-center py-14 text-center"
        title={
          q
            ? t('library.templates.list.noTemplatesMatch', {
                q: queryText ?? '',
              })
            : tab === 'all'
              ? t('library.templates.list.noTemplatesYet')
              : t('library.templates.list.noTemplatesIn', {
                  tab: tabLabel[tab],
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
              render={<Link to="/templates" search={{ tab: tab }} />}
            >
              {t('library.templates.list.clearSearch')}
            </Button>
          ) : (
            <NewTemplateDialog />
          )
        }
      />
    </div>
  )
}

/** The board's columns, rebuilt only when a name or the row opener changes. */
function useTemplateColumns({
  ownerName,
  openTemplate,
}: {
  ownerName: (id: string | null) => string
  openTemplate: ReturnType<typeof useOpenRow<TemplateRow>>
}): RegistryColumn<TemplateRow>[] {
  return useMemo<RegistryColumn<TemplateRow>[]>(
    () => [
      {
        id: 'identifier',
        header: t('library.templates.list.id'),
        accessorFn: (item) => item.displayId ?? item.key,
        enableHiding: false,
        cell: ({ row }) =>
          row.original.displayId ? (
            <Link
              to="/templates/$templateId"
              params={{ templateId: row.original.id }}
              onClick={(event) => openTemplate(row.original, event)}
              className="mono"
            >
              {row.original.displayId}
            </Link>
          ) : (
            '—'
          ),
      },
      {
        id: 'template',
        header: t('library.templates.list.template'),
        accessorFn: (item) => item.name,
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
        accessorFn: () => t('library.templates.list.notebook'),
        cell: () => (
          <Badge variant="kind">{t('library.templates.list.notebook')}</Badge>
        ),
      },
      {
        id: 'version',
        header: t('library.templates.list.version'),
        accessorFn: (item) =>
          item.published
            ? item.published.version
            : (item.latest?.version ?? undefined),
        meta: {
          ...rightAligned<TemplateRow>().meta,
          exportValue: (item: TemplateRow) =>
            item.published
              ? `v${item.published.version}`
              : item.latest
                ? `v${item.latest.version} draft`
                : '',
        },
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
        accessorFn: (item) => item.inUse,
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
        accessorFn: (item) => templateLifecycle(item.lifecycle).label,
        cell: ({ row }) => {
          const status = templateLifecycle(row.original.lifecycle)

          return <Status tone={status.tone}>{status.label}</Status>
        },
      },
      {
        id: 'owner',
        header: t('library.templates.list.owner'),
        accessorFn: (item) => ownerName(item.createdByUserId),
        meta: { cellClassName: 'text-fg-muted' },
        cell: ({ row }) => ownerName(row.original.createdByUserId),
      },
    ],
    [ownerName, openTemplate],
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
    // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change -- `?new=true` is a one-shot command from the shell's New menu, not a mirrored prop: it opens this dialog once on arrival and the flag is then dropped, so there is no second source of truth to derive from.
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
    onError: (error) => {
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
