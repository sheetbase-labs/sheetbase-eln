import { useMemo, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
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
import { Skeleton } from '#/components/ui/skeleton'
import { Status } from '#/components/ui/status'
import { toast } from '#/components/ui/sonner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
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
import { PLUGIN_MAX_ARCHIVE_BYTES } from '#/lib/extensions/package'
import { describeRunnerAdds } from '#/lib/extensions/runner-points'
import type { PluginCheckResult } from '#/lib/extensions/install.server'
import type { ExtensionRunnerPoint } from '#/lib/extensions/points'

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

function Plugins() {
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  // Owners and administrators only; the database checks the same on every change.
  const canManage =
    context.workspace?.role === 'owner' || context.workspace?.role === 'admin'
  const queryClient = useQueryClient()
  const [installOpen, setInstallOpen] = useState(false)
  const [removing, setRemoving] = useState<ExtensionWire | null>(null)

  const installs = useQuery({
    queryKey: [...extensionQueryKeys.extensions, 'admin', workspaceId],
    queryFn: () => listExtensions(client),
    enabled: Boolean(workspaceId) && canManage,
  })

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: extensionQueryKeys.extensions })

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
          <div className="overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">
                    {t('plugins.admin.columns.plugin')}
                  </TableHead>
                  <TableHead scope="col">
                    {t('plugins.admin.columns.status')}
                  </TableHead>
                  <TableHead scope="col">
                    {t('plugins.admin.columns.adds')}
                  </TableHead>
                  <TableHead scope="col">
                    {t('plugins.admin.columns.actions')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((install) => (
                  <PluginRow
                    key={install.id}
                    install={install}
                    busy={toggle.isPending || togglePoint.isPending}
                    onToggle={(on) => toggle.mutate({ install, on })}
                    onPoint={(point, on) =>
                      togglePoint.mutate({ install, point, on })
                    }
                    onRemove={() => setRemoving(install)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SettingsBody>

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

function PluginRow({
  install,
  busy,
  onToggle,
  onPoint,
  onRemove,
}: {
  install: ExtensionWire
  busy: boolean
  onToggle: (on: boolean) => void
  onPoint: (point: ExtensionRunnerPoint, on: boolean) => void
  onRemove: () => void
}) {
  const adds = useMemo(() => describeRunnerAdds(install.manifest), [install])
  const on = install.status === 'enabled'
  const { description, author } = install.manifest
  return (
    <TableRow>
      <TableCell className="max-w-[320px] align-top">
        <div className="font-medium text-fg">{install.name}</div>
        <div className="text-caption text-fg-muted">
          {install.version}
          {author ? ` · ${t('plugins.admin.by', { author })}` : ''}
        </div>
        {description ? (
          <div
            className="mt-1 max-w-[320px] truncate text-caption text-fg-muted"
            title={description}
          >
            {description}
          </div>
        ) : null}
      </TableCell>
      <TableCell className="align-top">
        <Status tone={on ? 'ok' : 'draft'}>
          {t(`plugins.admin.status.${install.status}`)}
        </Status>
      </TableCell>
      <TableCell className="align-top">
        <div className="flex flex-col gap-2">
          {adds.length === 0 ? (
            <span className="text-fg-muted">—</span>
          ) : (
            adds.map((group) => {
              const pointOn = !install.disabled_points.includes(group.point)
              const label = t(`plugins.admin.points.${group.point}`)
              return (
                <div key={group.point} className="flex flex-col gap-0.5">
                  <label
                    className="flex items-center gap-2 text-body text-fg"
                    title={t(`plugins.admin.pointHint.${group.point}`)}
                  >
                    <Checkbox
                      checked={pointOn}
                      disabled={busy}
                      aria-label={t('plugins.admin.pointSwitch', {
                        point: label,
                        name: install.name,
                      })}
                      onCheckedChange={(next) =>
                        onPoint(group.point, next === true)
                      }
                    />
                    <span className="font-medium">{label}</span>
                  </label>
                  <ul className="pl-6 text-caption text-fg-muted">
                    {group.items.map((item) => (
                      <li key={item.id}>
                        {item.title}
                        <span className="text-fg-faint">
                          {' '}
                          ·{' '}
                          {t(
                            `plugins.admin.access.${item.detail as 'read' | 'write' | 'analysis'}`,
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })
          )}
        </div>
      </TableCell>
      <TableCell className="align-top">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => onToggle(!on)}
          >
            {on ? t('plugins.admin.turnOff') : t('plugins.admin.turnOn')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={onRemove}
          >
            {t('plugins.admin.remove')}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

type InstallStep =
  | { kind: 'choose' }
  | { kind: 'reading'; file: string }
  | { kind: 'problems'; problems: string[] }
  | { kind: 'review'; file: File; plugin: PluginCheckResult }

async function sendPlugin(
  file: File,
  mode: 'check' | 'install',
): Promise<{ plugin: PluginCheckResult } | { problems: string[] }> {
  const response = await fetch(
    `/api/plugins/install?mode=${mode}${mode === 'install' ? '&acknowledge=1' : ''}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: await file.arrayBuffer(),
    },
  )
  const body = (await response.json().catch(() => null)) as {
    plugin?: PluginCheckResult
    error?: { message?: string; problems?: string[] }
  } | null
  if (response.ok && body?.plugin) return { plugin: body.plugin }
  return {
    problems: body?.error?.problems ?? [
      body?.error?.message ?? t('plugins.admin.install.readFailed'),
    ],
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
    if (file.size > PLUGIN_MAX_ARCHIVE_BYTES) {
      setStep({
        kind: 'problems',
        problems: [t('plugins.admin.install.chooseHint')],
      })
      return
    }
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
                <p className="mt-1 text-body text-fg-muted">
                  {plugin.description}
                </p>
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
              <section aria-labelledby="plugin-asks">
                <h3 id="plugin-asks" className="text-body font-medium text-fg">
                  {t('plugins.admin.install.asks')}
                </h3>
                <ul className="mt-1 list-disc pl-5 text-body text-fg-muted">
                  <li>{t('plugins.admin.install.asksCode')}</li>
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
              <section aria-labelledby="plugin-adds">
                <h3 id="plugin-adds" className="text-body font-medium text-fg">
                  {t('plugins.admin.install.adds')}
                </h3>
                {plugin.adds.length === 0 ? (
                  <p className="text-body text-fg-muted">
                    {t('plugins.admin.install.addsNothing')}
                  </p>
                ) : (
                  <ul className="mt-1 flex flex-col gap-1 text-body text-fg-muted">
                    {plugin.adds.map((group) => (
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
                                ·{' '}
                                {t(
                                  `plugins.admin.access.${item.detail as 'read' | 'write' | 'analysis'}`,
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
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
