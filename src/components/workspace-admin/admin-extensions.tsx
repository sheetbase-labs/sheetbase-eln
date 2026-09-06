import { Fragment, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  Badge,
  Button,
  Checkbox,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '#/components/ui'
import { hasCapability } from '#/lib/capability'
import { createDataClient } from '#/lib/data-client'
import { fetchDiagnosticsFn } from '#/lib/admin-platform'
import {
  checkExtensionCompat,
  describeExtensionCompat,
  isTrustedExtensionSource,
  isUpdateAvailable,
} from '#/lib/extensions/compat'
import type { ExtensionCompatState } from '#/lib/extensions/compat'
import {
  describeExtensionsError,
  disableExtension,
  enableExtension,
  extensionQueryKeys,
  installExtension,
  listExtensions,
  removeExtension,
  updateExtension,
} from '#/lib/extensions/client'
import type { ExtensionWire } from '#/lib/extensions/client'
import {
  describeExtensionHistoryEvent,
  extensionHistoryQueryKeys,
  fetchExtensionHistory,
} from '#/lib/extensions/history'
import { validateExtensionManifest } from '#/lib/extensions/manifest'
import type { ExtensionManifest } from '#/lib/extensions/manifest'

const dataClient = createDataClient()

const statusVariant: Record<string, 'success' | 'warning' | 'outline'> = {
  enabled: 'success',
  installed: 'warning',
  disabled: 'outline',
}

const compatVariant: Record<
  ExtensionCompatState,
  'success' | 'warning' | 'danger'
> = {
  compatible: 'success',
  unknown: 'warning',
  incompatible: 'danger',
}

interface ManifestForm {
  key: string
  name: string
  version: string
  source: string
  compatibleWith: string
  capabilities: string
  scopes: string
  contributions: string
  acknowledgeUntrusted: boolean
  acknowledgeIncompatible: boolean
}

const EMPTY_FORM: ManifestForm = {
  key: '',
  name: '',
  version: '',
  source: '',
  compatibleWith: '',
  capabilities: '',
  scopes: '',
  contributions: '{}',
  acknowledgeUntrusted: false,
  acknowledgeIncompatible: false,
}

function formToManifest(form: ManifestForm): {
  manifest: Record<string, unknown>
  errors: string[]
} {
  let contributions: unknown = {}
  try {
    contributions = form.contributions.trim()
      ? JSON.parse(form.contributions)
      : {}
  } catch {
    return { manifest: {}, errors: ['contributions must be valid JSON'] }
  }
  const manifest: Record<string, unknown> = {
    id: form.key ? `workspace.${form.key}` : '',
    name: form.name,
    version: form.version,
    source: form.source,
    capabilities: form.capabilities
      .split(',')
      .map((capability) => capability.trim())
      .filter(Boolean),
    scopes: form.scopes
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean),
    contributions,
  }
  if (form.compatibleWith.trim()) {
    manifest['compatibleWith'] = form.compatibleWith.trim()
  }
  return { manifest, errors: validateExtensionManifest(manifest) }
}

function formForExtension(extension: ExtensionWire): ManifestForm {
  const manifest = extension.manifest as unknown as Record<string, unknown>
  return {
    key: extension.key,
    name: extension.name,
    version: extension.version,
    source: extension.source,
    compatibleWith:
      typeof manifest['compatibleWith'] === 'string'
        ? manifest['compatibleWith']
        : '',
    capabilities: (
      (manifest['capabilities'] as string[] | undefined) ?? []
    ).join(', '),
    scopes: ((manifest['scopes'] as string[] | undefined) ?? []).join(', '),
    contributions: JSON.stringify(manifest['contributions'] ?? {}, null, 2),
    acknowledgeUntrusted: false,
    acknowledgeIncompatible: false,
  }
}

export function AdminExtensions({
  workspaceId,
  role,
}: {
  workspaceId: string
  role: string
}) {
  const queryClient = useQueryClient()
  const canManage = hasCapability(role, 'extensions.manage')
  const [form, setForm] = useState<ManifestForm>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)

  const extensionsQuery = useQuery({
    queryKey: extensionQueryKeys.extensions,
    queryFn: () => listExtensions(dataClient),
  })

  const diagnosticsQuery = useQuery({
    queryKey: ['admin-diagnostics-version', workspaceId],
    queryFn: () => fetchDiagnosticsFn({ data: { workspaceId } }),
    staleTime: 60_000,
  })

  const appVersion =
    diagnosticsQuery.data?.deployment.artifactVersion &&
    diagnosticsQuery.data.deployment.artifactVersion !== '—'
      ? diagnosticsQuery.data.deployment.artifactVersion
      : null
  const installs = useMemo(
    () =>
      (extensionsQuery.data ?? [])
        .filter((extension) => extension.workspace_id === workspaceId)
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    [extensionsQuery.data, workspaceId],
  )
  const updating = updatingId
    ? (installs.find((extension) => extension.id === updatingId) ?? null)
    : null

  function setPatch(patch: Partial<ManifestForm>) {
    setForm((current) => ({ ...current, ...patch }))
  }

  function invalidate() {
    void queryClient.invalidateQueries({
      queryKey: extensionQueryKeys.extensions,
    })
  }

  function mutation<T, TValue>(fn: (value: TValue) => Promise<T>) {
    return {
      mutationFn: fn,
      onSuccess: () => {
        setFormError(null)
        setForm(EMPTY_FORM)
        setUpdatingId(null)
        setConfirmRemoveId(null)
        invalidate()
      },
      onError: (cause: unknown) => setFormError(describeExtensionsError(cause)),
    }
  }

  const install = useMutation(
    mutation((value: ManifestForm) => {
      const { manifest, errors } = formToManifest(value)
      if (errors.length > 0) throw new Error(errors.join('; '))
      return installExtension(dataClient, {
        workspaceId,
        key: value.key.trim(),
        name: value.name.trim(),
        version: value.version.trim(),
        source: value.source.trim(),
        manifest: manifest as unknown as ExtensionManifest,
        acknowledgeUntrusted: value.acknowledgeUntrusted,
      })
    }),
  )
  const update = useMutation(
    mutation((args: { id: string; value: ManifestForm }) => {
      const { manifest, errors } = formToManifest(args.value)
      if (errors.length > 0) throw new Error(errors.join('; '))
      return updateExtension(dataClient, {
        workspaceId,
        extensionId: args.id,
        name: args.value.name.trim(),
        version: args.value.version.trim(),
        source: args.value.source.trim(),
        manifest: manifest as unknown as ExtensionManifest,
        acknowledgeUntrusted: args.value.acknowledgeUntrusted,
      })
    }),
  )
  const enable = useMutation(
    mutation((extensionId: string) =>
      enableExtension(dataClient, { workspaceId, extensionId }),
    ),
  )
  const disable = useMutation(
    mutation((extensionId: string) =>
      disableExtension(dataClient, { workspaceId, extensionId }),
    ),
  )
  const remove = useMutation(
    mutation((extensionId: string) =>
      removeExtension(dataClient, { workspaceId, extensionId }),
    ),
  )

  const historyQuery = useQuery({
    queryKey: expandedId
      ? extensionHistoryQueryKeys.history(expandedId)
      : ['extensions', 'history', 'none'],
    queryFn: () => fetchExtensionHistory(dataClient, expandedId!),
    enabled: Boolean(expandedId),
  })

  const draft = formToManifest(form)
  const draftSource = form.source.trim()
  const draftUntrusted =
    draftSource !== '' && !isTrustedExtensionSource(draftSource)
  const draftManifestForCompat = {
    compatibleWith: form.compatibleWith.trim() || undefined,
  }
  const draftCompat = checkExtensionCompat(draftManifestForCompat, appVersion)
  const needsTrustAck = draftUntrusted && !form.acknowledgeUntrusted
  const needsCompatAck =
    draftCompat === 'incompatible' && !form.acknowledgeIncompatible
  const updateVerdict =
    updating && form.version.trim()
      ? isUpdateAvailable(updating.version, form.version.trim())
        ? 'newer'
        : form.version.trim() === updating.version
          ? 'same'
          : 'older'
      : null

  function submitInstall() {
    if (draft.errors.length > 0) {
      setFormError(draft.errors.join('; '))
      return
    }
    if (needsTrustAck) {
      setFormError(
        'That source is untrusted. Acknowledge the source explicitly to install from it.',
      )
      return
    }
    if (needsCompatAck) {
      setFormError(
        'That manifest declares incompatibility with this app version. Acknowledge the incompatibility explicitly to proceed.',
      )
      return
    }
    install.mutate(form)
  }

  function submitUpdate() {
    if (!updating) return
    if (draft.errors.length > 0) {
      setFormError(draft.errors.join('; '))
      return
    }
    if (needsTrustAck) {
      setFormError(
        'That source is untrusted. Acknowledge the source explicitly to update from it.',
      )
      return
    }
    if (needsCompatAck) {
      setFormError(
        'That manifest declares incompatibility with this app version. Acknowledge the incompatibility explicitly to proceed.',
      )
      return
    }
    update.mutate({ id: updating.id, value: form })
  }

  const error =
    formError ??
    (extensionsQuery.error instanceof Error
      ? describeExtensionsError(extensionsQuery.error)
      : null)

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Governed distribution for workspace extensions. Installs declare their
        source, authority (capabilities and scopes) and contribution points;
        every lifecycle transition — install, enable, disable, update, remove —
        is audited on the canonical change stream. Updates reset an install to
        pending and revoke its credential, so new code never auto-runs.
        {appVersion
          ? ` Compatibility is evaluated against app version ${appVersion}.`
          : ' The app version is currently unavailable, so compatibility reads unknown.'}
      </p>

      {canManage ? (
        <section className="space-y-3 rounded-md border p-4">
          <h3 className="text-sm font-semibold">
            {updating ? `Update ${updating.key}` : 'Install extension'}
          </h3>
          {updating ? (
            <p className="text-xs text-muted-foreground">
              Updating resets {updating.key} to installed and revokes its
              credential. Re-enable after review and re-issue credentials.
              Installed version: {updating.version}
              {updateVerdict === 'newer'
                ? ' — the typed version is newer: update available.'
                : null}
              {updateVerdict === 'same'
                ? ' — same version: metadata refresh only.'
                : null}
              {updateVerdict === 'older'
                ? ' — older version: downgrade, proceed only if intended.'
                : null}
            </p>
          ) : null}
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="ext-key">Key</Label>
              <Input
                id="ext-key"
                value={form.key}
                disabled={Boolean(updating)}
                onChange={(event) => setPatch({ key: event.target.value })}
                placeholder="retest-tracker"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ext-name">Name</Label>
              <Input
                id="ext-name"
                value={form.name}
                onChange={(event) => setPatch({ name: event.target.value })}
                placeholder="Retest Tracker"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ext-version">Version</Label>
              <Input
                id="ext-version"
                value={form.version}
                onChange={(event) => setPatch({ version: event.target.value })}
                placeholder="1.1.0"
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="ext-source">Source</Label>
              <Input
                id="ext-source"
                value={form.source}
                onChange={(event) => setPatch({ source: event.target.value })}
                placeholder="https://extensions.example.com/acme/retest-tracker-1.1.0.tgz"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ext-compat">Compatible with (optional)</Label>
              <Input
                id="ext-compat"
                value={form.compatibleWith}
                onChange={(event) =>
                  setPatch({ compatibleWith: event.target.value })
                }
                placeholder=">=1.0.0 <2.0.0"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ext-caps">Capabilities (comma separated)</Label>
              <Input
                id="ext-caps"
                value={form.capabilities}
                onChange={(event) =>
                  setPatch({ capabilities: event.target.value })
                }
                placeholder="record.create"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ext-scopes">Scopes (comma separated)</Label>
              <Input
                id="ext-scopes"
                value={form.scopes}
                onChange={(event) => setPatch({ scopes: event.target.value })}
                placeholder="projects:read"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ext-contrib">Contributions (JSON)</Label>
              <Textarea
                id="ext-contrib"
                value={form.contributions}
                onChange={(event) =>
                  setPatch({ contributions: event.target.value })
                }
                rows={3}
              />
            </div>
          </div>
          {draft.errors.length > 0 ? (
            <p role="alert" className="text-xs text-destructive">
              {draft.errors.join('; ')}
            </p>
          ) : null}
          {draftUntrusted ? (
            <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <Checkbox
                checked={form.acknowledgeUntrusted}
                onCheckedChange={(checked) =>
                  setPatch({ acknowledgeUntrusted: checked === true })
                }
              />
              <span>
                This source is untrusted (only https: sources are trusted).
                Acknowledge explicitly to{' '}
                {updating ? 'update from' : 'install from'} it — trust is never
                silent.
              </span>
            </label>
          ) : null}
          {draftCompat === 'incompatible' ? (
            <label className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              <Checkbox
                checked={form.acknowledgeIncompatible}
                onCheckedChange={(checked) =>
                  setPatch({ acknowledgeIncompatible: checked === true })
                }
              />
              <span>
                Incompatible with app version {appVersion ?? 'unknown'}: this
                manifest declares {form.compatibleWith.trim()}. Acknowledge
                explicitly to proceed — the install is recorded, never silently
                broken.
              </span>
            </label>
          ) : null}
          <div className="flex gap-2">
            {updating ? (
              <>
                <Button onClick={submitUpdate} disabled={update.isPending}>
                  Update extension
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setUpdatingId(null)
                    setForm(EMPTY_FORM)
                    setFormError(null)
                  }}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button onClick={submitInstall} disabled={install.isPending}>
                Install extension
              </Button>
            )}
          </div>
        </section>
      ) : null}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">
          Installed extensions ({installs.length})
        </h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Extension</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Compat</TableHead>
              <TableHead>Authority</TableHead>
              <TableHead>Credential</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {installs.map((extension) => {
              const manifest = extension.manifest as unknown as Record<
                string,
                unknown
              >
              const compat = checkExtensionCompat(
                {
                  compatibleWith:
                    typeof manifest['compatibleWith'] === 'string'
                      ? manifest['compatibleWith']
                      : undefined,
                },
                appVersion,
              )
              const trusted = isTrustedExtensionSource(extension.source)
              const capabilities = (
                (manifest['capabilities'] as string[] | undefined) ?? []
              ).join(', ')
              const scopes = (
                (manifest['scopes'] as string[] | undefined) ?? []
              ).join(', ')
              return (
                <Fragment key={extension.id}>
                  <TableRow>
                    <TableCell>
                      <div className="font-medium">{extension.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {extension.key} ·{' '}
                        {(manifest['id'] as string | undefined) ?? '—'}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {extension.version}
                    </TableCell>
                    <TableCell>
                      <div className="max-w-56 truncate font-mono text-xs">
                        {extension.source}
                      </div>
                      {!trusted ? (
                        <Badge variant="warning">untrusted</Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={statusVariant[extension.status] ?? 'outline'}
                      >
                        {extension.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={compatVariant[compat]}
                        title={describeExtensionCompat(compat)}
                      >
                        {compat}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-56 text-xs">
                        {capabilities ? <div>cap: {capabilities}</div> : null}
                        {scopes ? <div>scopes: {scopes}</div> : null}
                        {!capabilities && !scopes ? '—' : null}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {extension.credential_id
                        ? `${extension.credential_id.slice(0, 8)}… bound`
                        : 'unbound'}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setExpandedId(
                              expandedId === extension.id ? null : extension.id,
                            )
                          }
                        >
                          History
                        </Button>
                        {canManage ? (
                          <>
                            {extension.status !== 'enabled' ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => enable.mutate(extension.id)}
                                disabled={enable.isPending}
                              >
                                Enable
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => disable.mutate(extension.id)}
                                disabled={disable.isPending}
                              >
                                Disable
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setUpdatingId(extension.id)
                                setForm(formForExtension(extension))
                                setFormError(null)
                              }}
                            >
                              Update
                            </Button>
                            {confirmRemoveId === extension.id ? (
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => remove.mutate(extension.id)}
                                disabled={remove.isPending}
                              >
                                Confirm remove
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setConfirmRemoveId(extension.id)}
                              >
                                Remove
                              </Button>
                            )}
                          </>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                  {expandedId === extension.id ? (
                    <TableRow key={`${extension.id}-history`}>
                      <TableCell colSpan={8}>
                        <ExtensionHistory extensionId={extension.id} />
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
        {installs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No extensions installed in this workspace.
          </p>
        ) : null}
        {historyQuery.isError ? (
          <p role="alert" className="text-xs text-destructive">
            {describeExtensionsError(historyQuery.error)}
          </p>
        ) : null}
      </section>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function ExtensionHistory({ extensionId }: { extensionId: string }) {
  const historyQuery = useQuery({
    queryKey: extensionHistoryQueryKeys.history(extensionId),
    queryFn: () => fetchExtensionHistory(dataClient, extensionId),
  })
  const events = historyQuery.data ?? []
  if (historyQuery.isPending) {
    return <p className="text-xs text-muted-foreground">Loading history…</p>
  }
  if (events.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No lifecycle or invocation history recorded for this extension.
      </p>
    )
  }
  return (
    <ul className="space-y-1 text-xs">
      {events.map((entry) => (
        <li key={entry.event.id} className="flex flex-wrap gap-2">
          <Badge variant="outline">{entry.kind}</Badge>
          <span>{describeExtensionHistoryEvent(entry)}</span>
          <span className="text-muted-foreground">
            {entry.event.operation} ·{' '}
            {entry.event.actorName ?? entry.event.actorUserId ?? 'system'} ·{' '}
            {entry.event.createdAt}
          </span>
        </li>
      ))}
    </ul>
  )
}
