import { useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { IconButton } from '#/components/ui/icon-button'
import { Checkbox } from '#/components/ui/checkbox'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/ui/confirm-dialog'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { EmptyState } from '#/components/ui/empty-state'
import { Notice } from '#/components/ui/alert'
import {
  PluginRuntimeDialog,
  environmentTone,
} from '#/components/settings/plugin-runtime-dialog'
import {
  PluginConnectionsDialog,
  connectionNeedsSetup,
} from '#/components/settings/plugin-connections-dialog'
import { Skeleton } from '#/components/ui/skeleton'
import { Status } from '#/components/ui/status'
import { toast } from '#/components/ui/sonner'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import {
  SettingsBody,
  SettingsHeader,
} from '#/components/settings/settings-page'
import { t } from '#/copy'
import { createDataClient } from '#/lib/data-client'
import {
  disableExtension,
  enableExtension,
  extensionQueryKeys,
  listExtensions,
  removeExtension,
  setExtensionPointEnabled,
} from '#/lib/extensions/client'
import type { ExtensionWire } from '#/lib/extensions/client'
import {
  connectionsQueryKey,
  listConnections,
} from '#/lib/extensions/outgoing-client'
import type { ConnectionWire } from '#/lib/extensions/outgoing-client'
import {
  listPluginRuntime,
  pluginRuntimeQueryKey,
} from '#/lib/extensions/runtime-client'
import type { PluginRuntimeInfo } from '#/lib/extensions/runtime-config'
import { describeRunnerAdds } from '#/lib/extensions/runner-points'
import type { ExtensionAddDetail } from '#/lib/extensions/runner-points'
import type { PluginCheckResult } from '#/lib/extensions/install.server'
import type { ExtensionRunnerPoint } from '#/lib/extensions/points'
import { EXTENSION_RUNNER_POINTS } from '#/lib/extensions/points'

/**
 * Settings → Plugins: what each installed plugin adds, with a switch for the
 * plugin and one for each part (operations, analyses). Only owners and
 * administrators add, switch or remove plugins; the database checks the same
 * permission on every change.
 */
export const Route = createFileRoute('/settings/workspace/plugins')({
  component: Plugins,
})

const client = createDataClient()

const formatSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`

function addDetailLabel(detail: string) {
  // SAFETY: Both installed and checked plugins get these keys from describeRunnerAdds' fixed ExtensionAddDetail vocabulary.
  const key = detail as ExtensionAddDetail

  return t(`plugins.admin.access.${key}`)
}

/** The installs table's columns, in the order it shows them. */

function Plugins() {
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''

  // Owners and administrators only; the database checks the same on every change.
  const canManage =
    context.workspace?.role === 'owner' || context.workspace?.role === 'admin'

  const queryClient = useQueryClient()
  const [installOpen, setInstallOpen] = useState(false)
  const [removing, setRemoving] = useState<ExtensionWire | null>(null)
  const [settingsFor, setSettingsFor] = useState<ExtensionWire | null>(null)

  const [connectionsFor, setConnectionsFor] = useState<ExtensionWire | null>(
    null,
  )

  const installs = useQuery({
    queryKey: [...extensionQueryKeys.extensions, 'admin', workspaceId],
    queryFn: () => listExtensions(client),
    enabled: Boolean(workspaceId) && canManage,
  })

  const { runtime, connectionsOf, runtimeOf } = usePluginConfiguration({
    workspaceId,
    canManage,
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: pluginRuntimeQueryKey })

    return queryClient.invalidateQueries({
      queryKey: extensionQueryKeys.extensions,
    })
  }

  const toggle = useMutation({
    mutationFn: (input: { install: ExtensionWire; on: boolean }) =>
      (input.on ? enableExtension : disableExtension)(client, {
        workspaceId,
        extensionId: input.install.id,
      }),
    onSuccess: (_row, input) => {
      toast(
        t(input.on ? 'plugins.admin.enabled' : 'plugins.admin.disabled', {
          name: input.install.name,
        }),
      )
      void refresh()
    },
    onError: () => toast.error(t('plugins.admin.couldNotChange')),
  })

  const togglePoint = useMutation({
    mutationFn: (input: {
      install: ExtensionWire
      point: ExtensionRunnerPoint
      on: boolean
    }) =>
      setExtensionPointEnabled(client, {
        workspaceId,
        extensionId: input.install.id,
        point: input.point,
        enabled: input.on,
      }),
    onSuccess: (_row, input) => {
      toast(
        t(
          input.on
            ? 'plugins.admin.pointSwitchedOn'
            : 'plugins.admin.pointSwitchedOff',
          { point: t(`plugins.admin.points.${input.point}`) },
        ),
      )
      void refresh()
    },
    onError: () => toast.error(t('plugins.admin.couldNotChange')),
  })

  const remove = useMutation({
    mutationFn: (install: ExtensionWire) =>
      removeExtension(client, { workspaceId, extensionId: install.id }),
    onSuccess: (_row, install) => {
      toast(t('plugins.admin.removed', { name: install.name }))
      setRemoving(null)
      void refresh()
    },
    onError: () => toast.error(t('plugins.admin.couldNotChange')),
  })

  if (!canManage) {
    return (
      <>
        <SettingsHeader title={t('plugins.admin.title')} />
        <div className="px-4 md:px-6">
          <EmptyState
            icon="lock"
            title={t('plugins.admin.onlyAdmins')}
            description={t('plugins.admin.onlyAdminsBody')}
          />
        </div>
      </>
    )
  }

  const rows = installs.data ?? []

  const columns = pluginColumns({
    runtimeOf,
    connectionsOf,
    busy: toggle.isPending || togglePoint.isPending,
    onConnections: setConnectionsFor,
    onSettings: setSettingsFor,
    onToggle: (install, on) => toggle.mutate({ install, on }),
    onPoint: (install, point, on) => togglePoint.mutate({ install, point, on }),
    onRemove: setRemoving,
  })

  return (
    <>
      <SettingsHeader
        title={t('plugins.admin.title')}
        count={installs.data ? rows.length : undefined}
        actions={
          <Button type="button" onClick={() => setInstallOpen(true)}>
            {t('plugins.admin.add')}
          </Button>
        }
      >
        {t('plugins.admin.intro')}
      </SettingsHeader>
      <SettingsBody>
        {installs.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : installs.isError ? (
          <Notice tone="bad">{t('plugins.admin.loadError')}</Notice>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="plug"
            title={t('plugins.admin.emptyTitle')}
            description={t('plugins.admin.emptyBody')}
          />
        ) : (
          <TableBox>
            <RegistryGrid
              label={t('plugins.admin.title')}
              rows={rows}
              columns={columns}
              getRowId={(install) => install.id}
              selectable={false}
            />
          </TableBox>
        )}
      </SettingsBody>

      {connectionsFor ? (
        <PluginConnectionsDialog
          name={connectionsFor.name}
          connections={connectionsOf(connectionsFor)}
          onClose={() => setConnectionsFor(null)}
        />
      ) : null}

      {settingsFor ? (
        <PluginRuntimeDialog
          name={settingsFor.name}
          info={runtimeOf(settingsFor)}
          loading={runtime.isLoading}
          onClose={() => setSettingsFor(null)}
        />
      ) : null}

      <InstallDialog
        open={installOpen}
        onOpenChange={setInstallOpen}
        onInstalled={(message) => {
          toast(message)
          setInstallOpen(false)
          void refresh()
        }}
      />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => {
          if (!next) setRemoving(null)
        }}
      >
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              {t('plugins.admin.removeTitle', {
                name: removing?.name ?? '',
              })}
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {t('plugins.admin.removeBody')}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel disabled={remove.isPending}>
              {t('common.actions.cancel')}
            </ConfirmDialogCancel>
            <ConfirmDialogAction
              disabled={remove.isPending}
              onClick={() => removing && remove.mutate(removing)}
            >
              {t('plugins.admin.removeConfirm')}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </>
  )
}

/** The installed plugins' columns: what it is, whether it runs, what it adds, and what to do. */
function pluginColumns({
  runtimeOf,
  connectionsOf,
  busy,
  onConnections,
  onSettings,
  onToggle,
  onPoint,
  onRemove,
}: {
  runtimeOf: (install: ExtensionWire) => PluginRuntimeInfo | undefined
  connectionsOf: (install: ExtensionWire) => ConnectionWire[]
  busy: boolean
  onConnections: (install: ExtensionWire) => void
  onSettings: (install: ExtensionWire) => void
  onToggle: (install: ExtensionWire, on: boolean) => void
  onPoint: (
    install: ExtensionWire,
    point: ExtensionRunnerPoint,
    on: boolean,
  ) => void
  onRemove: (install: ExtensionWire) => void
}): RegistryColumn<ExtensionWire>[] {
  return [
    {
      id: 'plugin',
      header: t('plugins.admin.columns.plugin'),
      accessorFn: (install) => install.name,
      cell: ({ row }) => {
        const install = row.original
        const { description, author } = install.manifest

        return (
          <span
            className="flex max-w-[28rem] items-baseline gap-2"
            title={description || undefined}
          >
            <span className="truncate font-medium text-fg">{install.name}</span>
            <span className="text-caption text-fg-muted">
              {install.version}
              {author ? ` · ${t('plugins.admin.by', { author })}` : ''}
            </span>
          </span>
        )
      },
    },
    {
      id: 'status',
      header: t('plugins.admin.columns.status'),
      accessorFn: (install) => install.status,
      cell: ({ row }) => {
        const install = row.original
        const runtime = runtimeOf(install)

        return (
          <span className="flex items-center gap-2">
            <Status tone={install.status === 'enabled' ? 'ok' : 'draft'}>
              {t(`plugins.admin.status.${install.status}`)}
            </Status>
            {runtime && runtime.requirements.length > 0 ? (
              <Status tone={environmentTone[runtime.environment.state]}>
                {t('plugins.admin.runtime.packages')}:{' '}
                {t(
                  `plugins.admin.runtime.state.${runtime.environment.state}`,
                ).toLowerCase()}
              </Status>
            ) : null}
            {connectionsOf(install).some(connectionNeedsSetup) ? (
              <Status tone="warn">
                {t('plugins.admin.connections.needsSetup')}
              </Status>
            ) : null}
          </span>
        )
      },
    },
    {
      id: 'adds',
      header: t('plugins.admin.columns.adds'),
      enableSorting: false,
      cell: ({ row }) => {
        const install = row.original
        const adds = describeRunnerAdds(install.manifest)
        const disabledPoints = new Set(install.disabled_points)

        if (adds.length === 0) return <span className="text-fg-muted">—</span>

        return (
          <span className="flex items-center gap-4">
            {adds.map((group) => {
              const label = t(`plugins.admin.points.${group.point}`)

              const items = group.items
                .map((item) => `${item.title} · ${addDetailLabel(item.detail)}`)
                .join('\n')

              return (
                <label
                  key={group.point}
                  className="flex items-center gap-2 text-body text-fg"
                  title={`${t(`plugins.admin.pointHint.${group.point}`)}\n${items}`}
                >
                  <Checkbox
                    checked={!disabledPoints.has(group.point)}
                    disabled={busy}
                    aria-label={t('plugins.admin.pointSwitch', {
                      point: label,
                      name: install.name,
                    })}
                    onCheckedChange={(next) =>
                      onPoint(install, group.point, next === true)
                    }
                  />
                  <span className="font-medium">{label}</span>
                </label>
              )
            })}
          </span>
        )
      },
    },
    {
      id: 'actions',
      header: t('plugins.admin.columns.actions'),
      enableHiding: false,
      meta: { headerClassName: 'text-right', cellClassName: 'text-right' },
      cell: ({ row }) => {
        const install = row.original
        const on = install.status === 'enabled'

        return (
          <span className="flex items-center justify-end gap-1 whitespace-nowrap">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => onToggle(install, !on)}
            >
              {on ? t('plugins.admin.turnOff') : t('plugins.admin.turnOn')}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <IconButton
                    icon="more"
                    label={t('plugins.admin.columns.actions')}
                  />
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onSettings(install)}>
                  {t('plugins.admin.runtime.button')}
                </DropdownMenuItem>
                {connectionsOf(install).length > 0 ? (
                  <DropdownMenuItem onClick={() => onConnections(install)}>
                    {t('plugins.admin.connections.button')}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  disabled={busy}
                  onClick={() => onRemove(install)}
                >
                  {t('plugins.admin.remove')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        )
      },
    },
  ]
}

type InstallStep =
  | { kind: 'choose' }
  | { kind: 'reading'; file: string }
  | { kind: 'problems'; problems: string[] }
  | { kind: 'review'; file: File; plugin: PluginCheckResult }

const pluginCheckSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  author: z.string().nullable(),
  permissions: z.array(z.string()),
  adds: z.array(
    z.object({
      point: z.enum(EXTENSION_RUNNER_POINTS),
      items: z.array(
        z.object({ id: z.string(), title: z.string(), detail: z.string() }),
      ),
    }),
  ),
  fileCount: z.number(),
  size: z.number(),
  sha256: z.string(),
  python: z.object({
    requirements: z.array(z.string()),
    network: z.array(z.string()),
  }),
  existing: z
    .object({ key: z.string(), version: z.string(), status: z.string() })
    .nullable(),
  changes: z.object({
    added: z.array(z.string()),
    removed: z.array(z.string()),
  }),
  examples: z.number(),
  hasUi: z.boolean(),
}) satisfies z.ZodType<PluginCheckResult>

async function sendPlugin(
  file: File,
  mode: 'check' | 'install',
): Promise<{ plugin: PluginCheckResult } | { problems: string[] }> {
  // react-doctor-disable-next-line react-doctor/no-fetch-response-used-without-status-check -- The response.ok branch validates success; the other branch deliberately parses the API error envelope into problems.
  const response = await fetch(
    `/api/plugins/install?mode=${mode}${mode === 'install' ? '&acknowledge=1' : ''}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: await file.arrayBuffer(),
    },
  )

  if (response.ok) {
    const body = z
      .object({ plugin: pluginCheckSchema })
      .safeParse(await response.json().catch(() => null))

    return body.success
      ? { plugin: body.data.plugin }
      : { problems: [t('plugins.admin.install.readFailed')] }
  }

  const body = z
    .object({
      error: z
        .object({
          message: z.string().optional(),
          problems: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .safeParse(await response.json().catch(() => null))

  return {
    problems: body.success
      ? (body.data.error?.problems ?? [
          body.data.error?.message ?? t('plugins.admin.install.readFailed'),
        ])
      : [t('plugins.admin.install.readFailed')],
  }
}

function InstallDialog({
  open,
  onOpenChange,
  onInstalled,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onInstalled: (message: string) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<InstallStep>({ kind: 'choose' })
  const [trusted, setTrusted] = useState(false)

  function reset() {
    setStep({ kind: 'choose' })
    setTrusted(false)

    if (input.current) input.current.value = ''
  }

  async function pick(file: File | undefined) {
    if (!file) return
    setStep({ kind: 'reading', file: file.name })
    setTrusted(false)

    const result = await sendPlugin(file, 'check').catch(() => ({
      problems: [t('plugins.admin.install.readFailed')],
    }))

    setStep(
      'plugin' in result
        ? { kind: 'review', file, plugin: result.plugin }
        : { kind: 'problems', problems: result.problems },
    )
  }

  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation -- onInstalled calls the parent's refresh(), invalidating extensionQueryKeys.extensions and pluginRuntimeQueryKey.
  const install = useMutation({
    mutationFn: async (file: File) => {
      const result = await sendPlugin(file, 'install')

      if ('problems' in result) throw new Error(result.problems[0])

      return result.plugin
    },
    onSuccess: (plugin) => {
      reset()
      onInstalled(
        plugin.existing
          ? t('plugins.admin.install.updated', {
              name: plugin.name,
              version: plugin.version,
            })
          : t('plugins.admin.install.added', { name: plugin.name }),
      )
    },
    onError: () => toast.error(t('plugins.admin.install.failed')),
  })

  const review = step.kind === 'review' ? step : null
  const plugin = review?.plugin

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="w-[min(640px,calc(100vw-32px))]">
        <DialogHeader
          title={t('plugins.admin.install.title')}
          description={t('plugins.admin.install.intro')}
        />
        <DialogBody>
          <input
            ref={input}
            type="file"
            accept=".sbplugin,.zip"
            className="sr-only"
            aria-label={t('plugins.admin.install.choose')}
            onChange={(event) => void pick(event.target.files?.[0])}
          />
          {step.kind === 'choose' || step.kind === 'problems' ? (
            <div className="flex flex-col items-start gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => input.current?.click()}
              >
                {t('plugins.admin.install.choose')}
              </Button>
              <p className="text-caption text-fg-muted">
                {t('plugins.admin.install.chooseHint')}
              </p>
            </div>
          ) : null}
          {step.kind === 'reading' ? (
            <p className="text-body text-fg-muted">
              {t('plugins.admin.install.reading', { file: step.file })}
            </p>
          ) : null}
          {step.kind === 'problems' ? (
            <Notice tone="bad" title={t('plugins.admin.install.problems')}>
              <ul className="list-disc pl-4">
                {step.problems.slice(0, 6).map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
          {plugin ? (
            <div className="flex flex-col gap-4">
              <PluginPackageSummary plugin={plugin} />
              <PluginPermissions plugin={plugin} />
              <PluginContributions adds={plugin.adds} />
              <p className="text-caption text-fg-faint">
                {t('plugins.admin.install.files', {
                  count: plugin.fileCount,
                  size: formatSize(plugin.size),
                })}
              </p>
              <label className="flex items-start gap-2 text-body text-fg">
                <Checkbox
                  checked={trusted}
                  onCheckedChange={(next) => setTrusted(next === true)}
                />
                <span>{t('plugins.admin.install.trust')}</span>
              </label>
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          {step.kind === 'review' || step.kind === 'problems' ? (
            <Button type="button" variant="secondary" onClick={reset}>
              {t('plugins.admin.install.chooseAnother')}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
          >
            {t('plugins.admin.install.cancel')}
          </Button>
          {review ? (
            <Button
              type="button"
              disabled={!trusted || install.isPending}
              onClick={() => install.mutate(review.file)}
            >
              {install.isPending
                ? t('plugins.admin.install.adding')
                : plugin?.existing
                  ? t('plugins.admin.install.submitUpdate')
                  : t('plugins.admin.install.submit')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function usePluginConfiguration({
  workspaceId,
  canManage,
}: {
  workspaceId: string
  canManage: boolean
}) {
  // Follow the Python build until it ends, independently of the installed-plugin list.
  const runtime = useQuery({
    queryKey: [...pluginRuntimeQueryKey, workspaceId],
    queryFn: listPluginRuntime,
    enabled: Boolean(workspaceId) && canManage,
    refetchInterval: (query) =>
      query.state.data?.some((info) => info.environment.state === 'building')
        ? 4000
        : false,
  })

  const connections = useQuery({
    queryKey: [...connectionsQueryKey, workspaceId],
    queryFn: listConnections,
    enabled: Boolean(workspaceId) && canManage,
  })

  return {
    runtime,
    connectionsOf: (install: ExtensionWire): ConnectionWire[] =>
      connections.data?.filter((entry) => entry.extensionId === install.id) ??
      [],
    runtimeOf: (install: ExtensionWire): PluginRuntimeInfo | undefined =>
      runtime.data?.find((info) => info.extensionId === install.id),
  }
}

function PluginContributions({ adds }: Pick<PluginCheckResult, 'adds'>) {
  return (
    <section aria-labelledby="plugin-adds">
      <h3 id="plugin-adds" className="text-body font-medium text-fg">
        {t('plugins.admin.install.adds')}
      </h3>
      {adds.length === 0 ? (
        <p className="text-body text-fg-muted">
          {t('plugins.admin.install.addsNothing')}
        </p>
      ) : (
        <ul className="mt-1 flex flex-col gap-1 text-body text-fg-muted">
          {adds.map((group) => (
            <li key={group.point}>
              <span className="font-medium text-fg">
                {t(`plugins.admin.points.${group.point}`)}
              </span>
              <ul className="list-disc pl-5">
                {group.items.map((item) => (
                  <li key={item.id}>
                    {item.title}
                    <span className="text-fg-faint">
                      {' '}
                      · {addDetailLabel(item.detail)}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function PluginPackageSummary({ plugin }: { plugin: PluginCheckResult }) {
  return (
    <>
      <div>
        <div className="text-heading font-medium text-fg">
          {plugin.name}{' '}
          <span className="text-body font-normal text-fg-muted">
            {plugin.version}
            {plugin.author
              ? ` · ${t('plugins.admin.by', { author: plugin.author })}`
              : ''}
          </span>
        </div>
        <p className="mt-1 text-body text-fg-muted">{plugin.description}</p>
      </div>
      {plugin.existing ? (
        <Notice
          tone="info"
          title={t('plugins.admin.install.newVersion', {
            version: plugin.existing.version,
          })}
        >
          <p>{t('plugins.admin.install.newVersionBody')}</p>
          {plugin.changes.added.length > 0 ? (
            <p>
              {t('plugins.admin.install.changesAdded', {
                items: plugin.changes.added
                  .map((item) => item.split(':')[1])
                  .join(', '),
              })}
            </p>
          ) : null}
          {plugin.changes.removed.length > 0 ? (
            <p>
              {t('plugins.admin.install.changesRemoved', {
                items: plugin.changes.removed
                  .map((item) => item.split(':')[1])
                  .join(', '),
              })}
            </p>
          ) : null}
        </Notice>
      ) : null}
    </>
  )
}

function PluginPermissions({ plugin }: { plugin: PluginCheckResult }) {
  return (
    <section aria-labelledby="plugin-asks">
      <h3 id="plugin-asks" className="text-body font-medium text-fg">
        {t('plugins.admin.install.asks')}
      </h3>
      <ul className="mt-1 list-disc pl-5 text-body text-fg-muted">
        <li>{t('plugins.admin.install.asksCode')}</li>
        {plugin.hasUi ? <li>{t('plugins.admin.install.asksUi')}</li> : null}
        <li>
          {plugin.python.requirements.length > 0
            ? t('plugins.admin.install.asksPackages', {
                packages: plugin.python.requirements.join(', '),
              })
            : t('plugins.admin.install.asksNoPackages')}
        </li>
        <li>
          {plugin.python.network.length > 0
            ? t('plugins.admin.install.asksNetwork', {
                hosts: plugin.python.network.join(', '),
              })
            : t('plugins.admin.install.asksNoNetwork')}
        </li>
        <li>
          {plugin.permissions.length > 0 &&
          !(
            plugin.permissions.length === 1 &&
            plugin.permissions[0] === 'projects:read'
          )
            ? t('plugins.admin.install.asksScopes', {
                scopes: plugin.permissions.join(', '),
              })
            : t('plugins.admin.install.asksNothing')}
        </li>
      </ul>
    </section>
  )
}
