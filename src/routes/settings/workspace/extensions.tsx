import { useMemo, useState } from 'react'
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
import { Field, Input } from '#/components/ui/input'
import { Secret } from '#/components/ui/secret'
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
import { Textarea } from '#/components/inventory/list'
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
  installExtension,
  listExtensions,
  removeExtension,
  setExtensionPointEnabled,
} from '#/lib/extensions/client'
import type { ExtensionWire } from '#/lib/extensions/client'
import { validateExtensionManifest } from '#/lib/extensions/manifest'
import type { ExtensionManifest } from '#/lib/extensions/manifest'
import { describeRunnerAdds } from '#/lib/extensions/runner-points'
import type { ExtensionRunnerPoint } from '#/lib/extensions/points'
import {
  SAMPLE_TOOLS_KEY,
  SAMPLE_TOOLS_MANIFEST,
} from '#/lib/extensions/sample/tools'

/**
 * Settings → Extensions: what each installed extension adds, with a switch for
 * the extension and one for each part (pipeline actions, assistant tools,
 * analyses). Only administrators add, switch or remove extensions; the database
 * checks the same permission on every change.
 */
export const Route = createFileRoute('/settings/workspace/extensions')({
  component: Extensions,
})

const client = createDataClient()

function keyFromManifestId(id: unknown): string {
  if (typeof id !== 'string') return ''
  const last = id.split('.').pop() ?? ''
  return last.replace(/[^a-z0-9-]/g, '-').slice(0, 49)
}

function hasWebhook(manifest: ExtensionManifest): boolean {
  const c = manifest.contributions
  return [
    ...(c['pipeline-actions'] ?? []),
    ...(c['assistant-tools'] ?? []),
  ].some((entry) => entry.runner.kind === 'webhook')
}

function Extensions() {
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  // Administrators only; the database checks the same on every change.
  const open =
    context.workspace?.role === 'owner' || context.workspace?.role === 'admin'
  const canManage = open
  const queryClient = useQueryClient()
  const [installOpen, setInstallOpen] = useState(false)
  const [removing, setRemoving] = useState<ExtensionWire | null>(null)
  const [shownKey, setShownKey] = useState<{
    name: string
    secret: string
  } | null>(null)

  const installs = useQuery({
    queryKey: [...extensionQueryKeys.extensions, 'admin', workspaceId],
    queryFn: () => listExtensions(client),
    enabled: Boolean(workspaceId) && open,
  })
  const keys = useQuery({
    queryKey: [...extensionQueryKeys.extensions, 'keys', workspaceId],
    queryFn: async () => {
      const response = await fetch('/api/extensions/key', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'keys' }),
      })
      if (!response.ok) return new Set<string>()
      const body = (await response.json()) as { extensionIds: string[] }
      return new Set(body.extensionIds)
    },
    enabled: Boolean(workspaceId) && open && canManage,
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
        t(input.on ? 'extensions.admin.enabled' : 'extensions.admin.disabled', {
          name: input.install.name,
        }),
      )
      void refresh()
    },
    onError: () => toast.error(t('extensions.admin.couldNotChange')),
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
            ? 'extensions.admin.pointSwitchedOn'
            : 'extensions.admin.pointSwitchedOff',
          { point: t(`extensions.admin.points.${input.point}`) },
        ),
      )
      void refresh()
    },
    onError: () => toast.error(t('extensions.admin.couldNotChange')),
  })

  const remove = useMutation({
    mutationFn: (install: ExtensionWire) =>
      removeExtension(client, { workspaceId, extensionId: install.id }),
    onSuccess: (_row, install) => {
      toast(t('extensions.admin.removed', { name: install.name }))
      setRemoving(null)
      void refresh()
    },
    onError: () => toast.error(t('extensions.admin.couldNotChange')),
  })

  const makeKey = useMutation({
    mutationFn: async (install: ExtensionWire) => {
      const response = await fetch('/api/extensions/key', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'rotate', extensionId: install.id }),
      })
      if (!response.ok) throw new Error('key')
      const body = (await response.json()) as { secret: string }
      return { name: install.name, secret: body.secret }
    },
    onSuccess: (made) => {
      setShownKey(made)
      void refresh()
    },
    onError: () => toast.error(t('extensions.admin.key.failed')),
  })

  if (!open) {
    return (
      <>
        <SettingsHeader title={t('extensions.admin.title')} />
        <div className="px-4 md:px-6">
          <EmptyState
            icon="lock"
            title={t('extensions.admin.onlyAdmins')}
            description={t('extensions.admin.onlyAdminsBody')}
          />
        </div>
      </>
    )
  }

  const rows = installs.data ?? []

  return (
    <>
      <SettingsHeader
        title={t('extensions.admin.title')}
        count={installs.data ? rows.length : undefined}
        actions={
          canManage ? (
            <Button type="button" onClick={() => setInstallOpen(true)}>
              {t('extensions.admin.add')}
            </Button>
          ) : undefined
        }
      >
        {t('extensions.admin.intro')}
      </SettingsHeader>
      <SettingsBody>
        {installs.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : installs.isError ? (
          <Notice tone="bad">{t('extensions.admin.loadError')}</Notice>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="plug"
            title={t('extensions.admin.emptyTitle')}
            description={t('extensions.admin.emptyBody')}
          />
        ) : (
          <div className="overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">
                    {t('extensions.admin.columns.extension')}
                  </TableHead>
                  <TableHead scope="col">
                    {t('extensions.admin.columns.status')}
                  </TableHead>
                  <TableHead scope="col">
                    {t('extensions.admin.columns.adds')}
                  </TableHead>
                  <TableHead scope="col">
                    {t('extensions.admin.columns.actions')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((install) => (
                  <ExtensionRow
                    key={install.id}
                    install={install}
                    canManage={canManage}
                    hasKey={keys.data?.has(install.id) ?? false}
                    busy={
                      toggle.isPending ||
                      togglePoint.isPending ||
                      makeKey.isPending
                    }
                    onToggle={(on) => toggle.mutate({ install, on })}
                    onPoint={(point, on) =>
                      togglePoint.mutate({ install, point, on })
                    }
                    onRemove={() => setRemoving(install)}
                    onMakeKey={() => makeKey.mutate(install)}
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
        workspaceId={workspaceId}
        onInstalled={(name) => {
          toast(t('extensions.admin.install.added', { name }))
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
              {t('extensions.admin.removeTitle', {
                name: removing?.name ?? '',
              })}
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {t('extensions.admin.removeBody')}
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
              {t('extensions.admin.removeConfirm')}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>

      <Dialog
        open={shownKey !== null}
        onOpenChange={(next) => {
          if (!next) setShownKey(null)
        }}
      >
        <DialogContent>
          <DialogHeader
            title={t('extensions.admin.key.title', {
              name: shownKey?.name ?? '',
            })}
          />
          <DialogBody>
            <p className="text-body text-fg-muted">
              {t('extensions.admin.key.body')}
            </p>
            {shownKey ? (
              <Secret
                value={shownKey.secret}
                copyLabel={t('extensions.admin.key.copy')}
                copiedMessage={t('extensions.admin.key.copied')}
              />
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" onClick={() => setShownKey(null)}>
              {t('extensions.admin.key.done')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ExtensionRow({
  install,
  canManage,
  hasKey,
  busy,
  onToggle,
  onPoint,
  onRemove,
  onMakeKey,
}: {
  install: ExtensionWire
  canManage: boolean
  hasKey: boolean
  busy: boolean
  onToggle: (on: boolean) => void
  onPoint: (point: ExtensionRunnerPoint, on: boolean) => void
  onRemove: () => void
  onMakeKey: () => void
}) {
  const adds = useMemo(() => describeRunnerAdds(install.manifest), [install])
  const on = install.status === 'enabled'
  return (
    <TableRow>
      <TableCell className="align-top">
        <div className="font-medium text-fg">{install.name}</div>
        <div className="text-caption text-fg-muted">
          {install.version} · {install.source}
        </div>
      </TableCell>
      <TableCell className="align-top">
        <Status tone={on ? 'ok' : 'draft'}>
          {t(`extensions.admin.status.${install.status}`)}
        </Status>
      </TableCell>
      <TableCell className="align-top">
        <div className="flex flex-col gap-2">
          {adds.length === 0 ? (
            <span className="text-fg-muted">—</span>
          ) : (
            adds.map((group) => {
              const pointOn = !install.disabled_points.includes(group.point)
              const label = t(`extensions.admin.points.${group.point}`)
              return (
                <div key={group.point} className="flex flex-col gap-0.5">
                  <label className="flex items-center gap-2 text-body text-fg">
                    <Checkbox
                      checked={pointOn}
                      disabled={!canManage || busy}
                      aria-label={t('extensions.admin.pointSwitch', {
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
                          {item.detail
                            .split(', ')
                            .map((part) =>
                              part === 'webhook' || part === 'python'
                                ? t(`extensions.admin.runs.${part}`)
                                : part === 'read' || part === 'write'
                                  ? t(`extensions.admin.access.${part}`)
                                  : part,
                            )
                            .join(', ')}
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
        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => onToggle(!on)}
            >
              {on
                ? t('extensions.admin.turnOff')
                : t('extensions.admin.turnOn')}
            </Button>
            {hasWebhook(install.manifest) ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy}
                title={t('extensions.admin.key.hint')}
                onClick={onMakeKey}
              >
                {hasKey
                  ? t('extensions.admin.key.replace')
                  : t('extensions.admin.key.make')}
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={onRemove}
            >
              {t('extensions.admin.remove')}
            </Button>
          </div>
        ) : null}
      </TableCell>
    </TableRow>
  )
}

function InstallDialog({
  open,
  onOpenChange,
  workspaceId,
  onInstalled,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  onInstalled: (name: string) => void
}) {
  const [text, setText] = useState('')
  const [key, setKey] = useState('')
  const [trusted, setTrusted] = useState(false)

  const parsed = useMemo(() => {
    if (!text.trim()) return { manifest: null, problems: [] as string[] }
    try {
      const manifest = JSON.parse(text) as unknown
      return { manifest, problems: validateExtensionManifest(manifest) }
    } catch {
      return {
        manifest: null,
        problems: [t('extensions.admin.install.invalidJson')],
      }
    }
  }, [text])

  const source =
    parsed.manifest && typeof parsed.manifest === 'object'
      ? (parsed.manifest as { source?: unknown }).source
      : undefined
  const untrusted = typeof source === 'string' && !source.startsWith('https://')
  const keyOk = /^[a-z][a-z0-9-]{0,48}$/.test(key)
  const ready =
    parsed.manifest !== null &&
    parsed.problems.length === 0 &&
    keyOk &&
    (!untrusted || trusted)

  const install = useMutation({
    mutationFn: () => {
      const manifest = parsed.manifest as ExtensionManifest
      return installExtension(createDataClient(), {
        workspaceId,
        key,
        name: manifest.name,
        version: manifest.version,
        source: manifest.source,
        manifest,
        acknowledgeUntrusted: untrusted && trusted,
      })
    },
    onSuccess: (row) => {
      setText('')
      setKey('')
      setTrusted(false)
      onInstalled(row.name)
    },
    onError: () => toast.error(t('extensions.admin.install.failed')),
  })

  function setManifestText(next: string) {
    setText(next)
    try {
      const id = (JSON.parse(next) as { id?: unknown }).id
      if (!key) setKey(keyFromManifestId(id))
    } catch {
      // Still typing.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(760px,calc(100vw-32px))]">
        <DialogHeader
          title={t('extensions.admin.install.title')}
          description={t('extensions.admin.install.intro')}
        />
        <DialogBody>
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                setManifestText(JSON.stringify(SAMPLE_TOOLS_MANIFEST, null, 2))
                setKey(SAMPLE_TOOLS_KEY)
              }}
            >
              {t('extensions.admin.install.useSample')}
            </Button>
          </div>
          <Field label={t('extensions.admin.install.manifestLabel')}>
            <Textarea
              rows={10}
              spellCheck={false}
              className="font-mono text-[12px]"
              value={text}
              onChange={(event) => setManifestText(event.target.value)}
              aria-invalid={parsed.problems.length > 0}
            />
          </Field>
          {parsed.problems.length > 0 ? (
            <Notice tone="bad" title={t('extensions.admin.install.problems')}>
              <ul className="list-disc pl-4">
                {parsed.problems.slice(0, 6).map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
          <Field
            label={t('extensions.admin.install.keyLabel')}
            hint={t('extensions.admin.install.keyHint')}
            error={
              key && !keyOk ? t('extensions.admin.install.keyHint') : undefined
            }
          >
            <Input
              value={key}
              onChange={(event) => setKey(event.target.value)}
              aria-invalid={key !== '' && !keyOk}
            />
          </Field>
          {untrusted ? (
            <label className="flex items-start gap-2 text-body text-fg">
              <Checkbox
                checked={trusted}
                onCheckedChange={(next) => setTrusted(next === true)}
              />
              <span>{t('extensions.admin.install.untrusted')}</span>
            </label>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
          >
            {t('extensions.admin.install.cancel')}
          </Button>
          <Button
            type="button"
            disabled={!ready || install.isPending}
            onClick={() => install.mutate()}
          >
            {install.isPending
              ? t('extensions.admin.install.adding')
              : t('extensions.admin.install.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
