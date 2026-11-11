import { useState } from 'react'

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
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { EmptyState } from '#/components/ui/empty-state'
import { Field, Input } from '#/components/ui/input'
import { Notice } from '#/components/ui/alert'
import { Muted, Section } from '#/components/ui/layout'
import { Secret } from '#/components/ui/secret'
import { Status } from '#/components/ui/status'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { SCOPE_GROUPS } from '#/lib/api-credential-scopes'
import type { Scope } from '#/lib/api-credential-scopes'
import { getDisplayTimeZone } from '#/lib/display-time-zone'
import { formatDate } from '#/lib/workspace-admin'
import { rich, t } from '#/copy'
import { dateTimeFormat } from '#/lib/intl-cache'

/** Date-only for the table: the time is available in the cell's title. */
function formatCredentialDate(timestamp: string | null | undefined): string {
  if (!timestamp) return t('settings.credentials.never')
  const date = new Date(timestamp)

  if (!Number.isFinite(date.getTime())) return t('settings.credentials.never')

  return dateTimeFormat('en-GB', {
    timeZone: getDisplayTimeZone(),
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

/** Long scope lists stay scannable: two codes inline, more behind a disclosure. */
function ScopeSummary({ scopes }: { scopes: readonly Scope[] }) {
  if (scopes.length <= 2) {
    return (
      <span className="flex flex-wrap gap-x-2 gap-y-1">
        {scopes.map((scope) => (
          <code key={scope} className="text-label">
            {scope}
          </code>
        ))}
      </span>
    )
  }

  return (
    <details className="group">
      <summary className="cursor-pointer text-label text-fg-muted hover:text-fg">
        {scopes.length} scopes
      </summary>
      <span className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
        {scopes.map((scope) => (
          <code key={scope} className="text-label">
            {scope}
          </code>
        ))}
      </span>
    </details>
  )
}

/**
 * UI port (roadmap-4/ui-app3): the credential panel. Personal API tokens and
 * workspace service credentials are one panel — the same table, create form,
 * reveal-once secret and revoke/rotate confirmation — so it takes the screen's
 * copy and its rows as props. Consolidated from the two identical files
 * `settings-api-tokens.tsx` and `settings-service-credentials.tsx`.
 */

/** The row fields the panel renders; both credential wire shapes satisfy it. */
export interface CredentialRow {
  id: string
  name: string
  displayPrefix: string
  scopes: Scope[]
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
  expiresAt: string | null
}

/** The one-time secret, shown once after a create or a rotate. */
export interface RevealedCredential {
  secret: string
  displayPrefix: string
  name: string
  scopes: Scope[]
}

/** Every word the panel renders; the two screens differ only here. */
export interface CredentialPanelCopy {
  /** Section heading, e.g. "Personal tokens". */
  title: string
  /** Line under the heading: what the credential is and how it behaves. */
  intro: React.ReactNode
  /** Reveal notice, naming the credential being shown. */
  revealNotice: (name: string) => string
  secret: {
    copyLabel: string
    copiedMessage: string
    failedMessage: string
  }
  create: {
    /** The section-level action that opens the create dialog. */
    open: string
    title: string
    namePlaceholder: string
    submit: string
  }
  tableLabel: string
  emptyTitle: string
  emptyLabel: string
  confirm: {
    rotate: {
      title: (name: string) => string
      description: string
      action: string
    }
    revoke: {
      title: (name: string) => string
      description: string
      action: string
    }
  }
}

export function SettingsCredentials({
  copy,
  tokens,
  revealed,
  onCreate,
  onRevoke,
  onRotate,
  onDismissRevealed,
  className,
  scopeGroups = SCOPE_GROUPS,
}: {
  copy: CredentialPanelCopy
  tokens: CredentialRow[]
  revealed: RevealedCredential | null
  onCreate: (name: string, scopes: Scope[], expiresAt: string | null) => void
  onRevoke: (credentialId: string) => void
  onRotate: (credentialId: string) => void
  onDismissRevealed: () => void
  className?: string
  scopeGroups?: ReadonlyArray<(typeof SCOPE_GROUPS)[number]>
}) {
  const [createOpen, setCreateOpen] = useState(false)
  const [showInactive, setShowInactive] = useState(false)

  // Revoking is permanent and rotating invalidates the live secret, so both ask
  // first: the row buttons only pick the action.
  const [confirming, setConfirming] = useState<{
    kind: 'revoke' | 'rotate'
    row: CredentialRow
  } | null>(null)

  function openCreate() {
    setCreateOpen(true)
  }

  const isInactive = (row: CredentialRow) =>
    Boolean(row.revokedAt) ||
    (Boolean(row.expiresAt) && new Date(row.expiresAt!).getTime() <= Date.now())

  const activeRows = tokens.filter((row) => !isInactive(row))
  const inactiveCount = tokens.length - activeRows.length
  const visibleRows = showInactive ? tokens : activeRows

  return (
    <Section
      title={copy.title}
      action={
        tokens.length ? (
          <Button variant="primary" icon="plus" onClick={openCreate}>
            {copy.create.open}
          </Button>
        ) : undefined
      }
      className={className}
    >
      <p className="m-0 max-w-3xl text-body text-fg-muted">{copy.intro}</p>
      {inactiveCount > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Muted>
            {showInactive
              ? t('settings.credentials.showingActiveInactive', {
                  inactiveCount,
                })
              : t('settings.credentials.showingActiveCredentials')}
          </Muted>
          <Button
            variant="quiet"
            size="sm"
            aria-pressed={showInactive}
            onClick={() => setShowInactive((current) => !current)}
          >
            {showInactive
              ? t('settings.credentials.hideInactive')
              : t('settings.credentials.showInactive', { inactiveCount })}
          </Button>
        </div>
      ) : null}
      {revealed ? (
        <CredentialReveal
          copy={copy}
          revealed={revealed}
          onDismiss={onDismissRevealed}
        />
      ) : null}
      <CredentialRows
        copy={copy}
        tokens={tokens}
        visibleRows={visibleRows}
        onConfirm={setConfirming}
        onCreate={openCreate}
        onShowInactive={() => setShowInactive(true)}
      />
      {createOpen ? (
        <CredentialCreateDialog
          copy={copy}
          scopeGroups={scopeGroups}
          onCreate={onCreate}
          onClose={() => setCreateOpen(false)}
        />
      ) : null}
      <CredentialConfirmation
        copy={copy}
        confirming={confirming}
        onClose={() => setConfirming(null)}
        onRotate={onRotate}
        onRevoke={onRevoke}
      />
    </Section>
  )
}

interface CredentialConfirmationRequest {
  kind: 'rotate' | 'revoke'
  row: CredentialRow
}

function CredentialCreateDialog({
  copy,
  scopeGroups,
  onCreate,
  onClose,
}: {
  copy: CredentialPanelCopy
  scopeGroups: ReadonlyArray<(typeof SCOPE_GROUPS)[number]>
  onCreate: (name: string, scopes: Scope[], expiresAt: string | null) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [selected, setSelected] = useState<Set<Scope>>(() => new Set<Scope>())

  function toggle(scope: Scope) {
    setSelected((current) => {
      const next = new Set(current)

      if (next.has(scope)) next.delete(scope)
      else next.add(scope)

      return next
    })
  }

  function toggleGroup(group: (typeof SCOPE_GROUPS)[number]) {
    setSelected((current) => {
      const next = new Set(current)

      if (group.scopes.every((scope) => next.has(scope))) {
        for (const scope of group.scopes) next.delete(scope)
      } else {
        for (const scope of group.scopes) next.add(scope)
      }

      return next
    })
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const scopes = [...selected]

    if (!name.trim() || scopes.length === 0) return
    onCreate(
      name.trim(),
      scopes,
      expiresAt ? new Date(expiresAt).toISOString() : null,
    )
    onClose()
    setName('')
    setExpiresAt('')
    setSelected(new Set<Scope>())
  }

  return (
    <CredentialCreateForm
      copy={copy}
      scopeGroups={scopeGroups}
      name={name}
      onNameChange={setName}
      expiresAt={expiresAt}
      onExpiryChange={setExpiresAt}
      selected={selected}
      onToggle={toggle}
      onToggleGroup={toggleGroup}
      onSubmit={submit}
      onClose={onClose}
    />
  )
}

function stateFor(row: CredentialRow) {
  const isRevoked = Boolean(row.revokedAt)

  const isExpired =
    Boolean(row.expiresAt) && new Date(row.expiresAt!).getTime() <= Date.now()

  return {
    isRevoked,
    isExpired,
    tone: isRevoked ? 'stored' : isExpired ? 'bad' : 'ok',
    label: isRevoked
      ? t('settings.credentials.revoked')
      : isExpired
        ? t('settings.credentials.expired')
        : t('settings.credentials.active'),
  } as const
}

function CredentialReveal({
  copy,
  revealed,
  onDismiss,
}: {
  copy: CredentialPanelCopy
  revealed: RevealedCredential
  onDismiss: () => void
}) {
  return (
    <Notice tone="warn" className="flex-col items-start">
      <div className="flex flex-col gap-3">
        <p className="m-0 font-medium">{copy.revealNotice(revealed.name)}</p>
        <Secret
          value={revealed.secret}
          copyLabel={copy.secret.copyLabel}
          copiedMessage={copy.secret.copiedMessage}
          failedMessage={copy.secret.failedMessage}
        />
        <p className="m-0 text-label">
          {rich('settings.credentials.prefixScopes', {
            prefix: <code>{revealed.displayPrefix}</code>,
            scopes: revealed.scopes.join(', '),
          })}
        </p>
        <div>
          <Button type="button" size="sm" onClick={onDismiss}>
            {t('settings.credentials.iStored')}
          </Button>
        </div>
      </div>
    </Notice>
  )
}

function CredentialRows({
  copy,
  tokens,
  visibleRows,
  onConfirm,
  onCreate,
  onShowInactive,
}: {
  copy: CredentialPanelCopy
  tokens: CredentialRow[]
  visibleRows: CredentialRow[]
  onConfirm: (request: CredentialConfirmationRequest) => void
  onCreate: () => void
  onShowInactive: () => void
}) {
  const columns: RegistryColumn<CredentialRow>[] = [
    {
      id: 'name',
      header: t('settings.credentials.name'),
      accessorFn: (row) => row.name,
      cell: ({ row }) => (
        <span className="flex items-baseline gap-2">
          <span className="truncate font-medium text-fg">
            {row.original.name}
          </span>
          <span className="mono text-label text-fg-muted">
            {row.original.displayPrefix}
          </span>
        </span>
      ),
    },
    {
      id: 'scopes',
      header: t('settings.credentials.scopes'),
      accessorFn: (row) => row.scopes.length,
      cell: ({ row }) => {
        const text = row.original.scopes.join(', ')

        return (
          <code className="block max-w-[8rem] truncate text-label" title={text}>
            {text}
          </code>
        )
      },
    },
    {
      id: 'created',
      header: t('settings.credentials.created'),
      accessorFn: (row) => row.createdAt,
      cell: ({ row }) => (
        <span title={formatDate(row.original.createdAt)}>
          {formatCredentialDate(row.original.createdAt)}
        </span>
      ),
    },
    {
      id: 'lastUsed',
      header: t('settings.credentials.lastUsed'),
      accessorFn: (row) => row.lastUsedAt ?? undefined,
      cell: ({ row }) => (
        <span
          title={
            row.original.lastUsedAt
              ? formatDate(row.original.lastUsedAt)
              : undefined
          }
        >
          {formatCredentialDate(row.original.lastUsedAt)}
        </span>
      ),
    },
    {
      id: 'expires',
      header: t('settings.credentials.expires'),
      accessorFn: (row) => row.expiresAt ?? undefined,
      cell: ({ row }) => (
        <span
          title={
            row.original.expiresAt
              ? formatDate(row.original.expiresAt)
              : undefined
          }
        >
          {formatCredentialDate(row.original.expiresAt)}
        </span>
      ),
    },
    {
      id: 'status',
      header: t('settings.credentials.status'),
      size: 120,
      accessorFn: (row) => stateFor(row).label,
      cell: ({ row }) => {
        const state = stateFor(row.original)

        return <Status tone={state.tone}>{state.label}</Status>
      },
    },
    {
      id: 'actions',
      header: '',
      enableHiding: false,
      size: 180,
      meta: { headerClassName: 'text-right', cellClassName: 'text-right' },
      cell: ({ row }) => {
        const state = stateFor(row.original)

        return (
          <div className="flex flex-nowrap justify-end gap-1">
            <Button
              size="sm"
              className="px-1.5"
              disabled={state.isRevoked || state.isExpired}
              onClick={() => onConfirm({ kind: 'rotate', row: row.original })}
            >
              {t('settings.credentials.rotate')}
            </Button>
            <Button
              size="sm"
              className="px-1.5"
              variant="danger"
              disabled={state.isRevoked}
              onClick={() => onConfirm({ kind: 'revoke', row: row.original })}
            >
              {t('settings.credentials.revoke')}
            </Button>
          </div>
        )
      },
    },
  ]

  return visibleRows.length ? (
    <>
      <TableBox className="max-md:hidden">
        <RegistryGrid
          label={copy.tableLabel}
          rows={visibleRows}
          columns={columns}
          getRowId={(row) => row.id}
          selectable={false}
          className="max-md:hidden"
        />
      </TableBox>
      <div className="grid gap-2 md:hidden">
        {visibleRows.map((row) => {
          const state = stateFor(row)

          return (
            <div
              key={row.id}
              className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="m-0 break-words font-medium">{row.name}</p>
                  <p className="m-0 mono text-label text-fg-muted">
                    {row.displayPrefix}
                  </p>
                </div>
                <Status tone={state.tone}>{state.label}</Status>
              </div>
              <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-label">
                <dt className="text-fg-muted">
                  {t('settings.credentials.scopes')}
                </dt>
                <dd className="m-0">
                  <ScopeSummary scopes={row.scopes} />
                </dd>
                <dt className="text-fg-muted">
                  {t('settings.credentials.created')}
                </dt>
                <dd className="m-0" title={formatDate(row.createdAt)}>
                  {formatCredentialDate(row.createdAt)}
                </dd>
                <dt className="text-fg-muted">
                  {t('settings.credentials.lastUsed')}
                </dt>
                <dd
                  className="m-0"
                  title={
                    row.lastUsedAt ? formatDate(row.lastUsedAt) : undefined
                  }
                >
                  {formatCredentialDate(row.lastUsedAt)}
                </dd>
                <dt className="text-fg-muted">
                  {t('settings.credentials.expires')}
                </dt>
                <dd
                  className="m-0"
                  title={row.expiresAt ? formatDate(row.expiresAt) : undefined}
                >
                  {formatCredentialDate(row.expiresAt)}
                </dd>
              </dl>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  disabled={state.isRevoked || state.isExpired}
                  onClick={() => onConfirm({ kind: 'rotate', row })}
                >
                  {t('settings.credentials.rotate')}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  className="flex-1"
                  disabled={state.isRevoked}
                  onClick={() => onConfirm({ kind: 'revoke', row })}
                >
                  {t('settings.credentials.revoke')}
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </>
  ) : (
    <EmptyState
      icon="key"
      title={
        tokens.length === 0
          ? copy.emptyTitle
          : t('settings.credentials.activeCredentials')
      }
      description={
        tokens.length === 0
          ? copy.emptyLabel
          : t('settings.credentials.allInactive', {
              count: tokens.length,
            })
      }
      action={
        tokens.length === 0 ? (
          <Button variant="primary" icon="plus" onClick={onCreate}>
            {copy.create.open}
          </Button>
        ) : (
          <Button variant="secondary" onClick={onShowInactive}>
            {t('settings.credentials.showInactive2')}
          </Button>
        )
      }
    />
  )
}

function CredentialCreateForm({
  copy,
  scopeGroups,
  name,
  onNameChange,
  expiresAt,
  onExpiryChange,
  selected,
  onToggle,
  onToggleGroup,
  onSubmit,
  onClose,
}: {
  copy: CredentialPanelCopy
  scopeGroups: ReadonlyArray<(typeof SCOPE_GROUPS)[number]>
  name: string
  onNameChange: (value: string) => void
  expiresAt: string
  onExpiryChange: (value: string) => void
  selected: Set<Scope>
  onToggle: (scope: Scope) => void
  onToggleGroup: (group: (typeof SCOPE_GROUPS)[number]) => void
  onSubmit: (event: React.FormEvent) => void
  onClose: () => void
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="top-[4vh] max-h-[92dvh] w-[min(860px,calc(100vw-32px))]">
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader
            title={copy.create.title}
            description={t('settings.credentials.fullSecretShownDescription')}
          />
          <DialogBody className="min-h-0 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border-strong">
            <div className="grid gap-3.5 md:grid-cols-2">
              <Field label={t('settings.credentials.name')} required>
                <Input
                  value={name}
                  onChange={(event) => onNameChange(event.target.value)}
                  placeholder={copy.create.namePlaceholder}
                  required
                  autoFocus
                />
              </Field>
              <Field label={t('settings.credentials.expiresOptional')}>
                <Input
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(event) => onExpiryChange(event.target.value)}
                />
              </Field>
            </div>

            <fieldset className="flex min-w-0 flex-col gap-3 border-0 p-0">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <legend className="text-body font-medium text-fg">
                  {t('settings.credentials.scopes')}
                </legend>
                <Muted aria-live="polite">
                  {selected.size} {selected.size === 1 ? 'scope' : 'scopes'}{' '}
                  selected
                </Muted>
              </div>
              <Muted className="max-w-3xl">
                {t('settings.credentials.someScopesUsable')}
              </Muted>

              <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
                {scopeGroups.map((group) => {
                  const allSelected = group.scopes.every((scope) =>
                    selected.has(scope),
                  )

                  return (
                    <div key={group.title} className="flex flex-col gap-2">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="m-0 text-body font-medium text-fg">
                          {group.title}
                        </p>
                        <Status
                          tone={
                            group.personalOnly
                              ? 'stored'
                              : group.effective
                                ? 'ok'
                                : 'warn'
                          }
                          className="text-label text-fg-muted"
                        >
                          {group.personalOnly
                            ? t('settings.credentials.personalOnly')
                            : group.effective
                              ? t('settings.credentials.enforcedStatus')
                              : t('settings.credentials.mintableOnly')}
                        </Status>
                        <Button
                          type="button"
                          variant="quiet"
                          size="sm"
                          className="ml-auto"
                          onClick={() => onToggleGroup(group)}
                          aria-label={
                            allSelected
                              ? t('settings.credentials.clearScopes', {
                                  title: group.title,
                                })
                              : t('settings.credentials.selectScopes', {
                                  title: group.title,
                                })
                          }
                        >
                          {allSelected
                            ? t('common.actions.clear')
                            : t('settings.credentials.select')}
                        </Button>
                      </div>
                      <p className="m-0 text-label leading-[18px] text-fg-muted">
                        {group.description}
                      </p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                        {group.scopes.map((scope) => (
                          <label
                            key={scope}
                            className="flex items-center gap-2 text-body"
                          >
                            <Checkbox
                              aria-label={scope}
                              checked={selected.has(scope)}
                              onCheckedChange={() => onToggle(scope)}
                            />
                            <code className="text-label">{scope}</code>
                          </label>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </fieldset>
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button type="button" />}>
              {t('common.actions.cancel')}
            </DialogClose>
            <Button
              type="submit"
              variant="primary"
              disabled={!name.trim() || selected.size === 0}
            >
              {copy.create.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CredentialConfirmation({
  copy,
  confirming,
  onClose,
  onRotate,
  onRevoke,
}: {
  copy: CredentialPanelCopy
  confirming: CredentialConfirmationRequest | null
  onClose: () => void
  onRotate: (id: string) => void
  onRevoke: (id: string) => void
}) {
  const confirm =
    confirming?.kind === 'rotate' ? copy.confirm.rotate : copy.confirm.revoke

  return (
    <ConfirmDialog
      open={confirming !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <ConfirmDialogContent>
        <ConfirmDialogHeader>
          <ConfirmDialogTitle>
            {confirm.title(confirming?.row.name ?? '')}
          </ConfirmDialogTitle>
          <ConfirmDialogDescription>
            {confirm.description}
          </ConfirmDialogDescription>
        </ConfirmDialogHeader>
        <ConfirmDialogFooter>
          <ConfirmDialogCancel>
            {t('common.actions.cancel')}
          </ConfirmDialogCancel>
          <ConfirmDialogAction
            variant={confirming?.kind === 'revoke' ? 'danger-fill' : 'primary'}
            onClick={() => {
              if (!confirming) return

              if (confirming.kind === 'rotate') onRotate(confirming.row.id)
              else onRevoke(confirming.row.id)
              onClose()
            }}
          >
            {confirm.action}
          </ConfirmDialogAction>
        </ConfirmDialogFooter>
      </ConfirmDialogContent>
    </ConfirmDialog>
  )
}

export { personalTokensCopy, serviceCredentialsCopy } from './credential-copy'
