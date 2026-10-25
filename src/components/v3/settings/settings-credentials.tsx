import { useState } from 'react'

import { Button } from '#/components/v3/ui/button'
import { Checkbox } from '#/components/v3/ui/checkbox'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/v3/ui/confirm-dialog'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Field, Input } from '#/components/v3/ui/input'
import { Notice } from '#/components/v3/ui/alert'
import { Muted, Section } from '#/components/v3/ui/layout'
import { Secret } from '#/components/v3/ui/secret'
import { Status } from '#/components/v3/ui/status'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { SCOPE_GROUPS } from '#/lib/api-credential-scopes'
import type { Scope } from '#/lib/api-credential-scopes'
import { getDisplayTimeZone } from '#/lib/display-time-zone'
import { formatDate } from '#/lib/workspace-admin'

/** Date-only for the table: the time is available in the cell's title. */
function formatCredentialDate(timestamp: string | null | undefined): string {
  if (!timestamp) return 'Never'
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return 'Never'
  return new Intl.DateTimeFormat('en-GB', {
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
  const [name, setName] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [selected, setSelected] = useState<Set<Scope>>(() => new Set<Scope>())
  const [showInactive, setShowInactive] = useState(false)
  // Revoking is permanent and rotating invalidates the live secret, so both ask
  // first: the row buttons only pick the action.
  const [confirming, setConfirming] = useState<{
    kind: 'revoke' | 'rotate'
    row: CredentialRow
  } | null>(null)

  function openCreate() {
    setName('')
    setExpiresAt('')
    setSelected(new Set<Scope>())
    setCreateOpen(true)
  }

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
    setCreateOpen(false)
    setName('')
    setExpiresAt('')
    setSelected(new Set<Scope>())
  }

  const isInactive = (row: CredentialRow) =>
    Boolean(row.revokedAt) ||
    (Boolean(row.expiresAt) && new Date(row.expiresAt!).getTime() <= Date.now())
  const activeRows = tokens.filter((row) => !isInactive(row))
  const inactiveCount = tokens.length - activeRows.length
  const visibleRows = showInactive ? tokens : activeRows

  const confirm =
    confirming?.kind === 'rotate' ? copy.confirm.rotate : copy.confirm.revoke

  function stateFor(row: CredentialRow) {
    const isRevoked = Boolean(row.revokedAt)
    const isExpired =
      Boolean(row.expiresAt) && new Date(row.expiresAt!).getTime() <= Date.now()
    return {
      isRevoked,
      isExpired,
      tone: isRevoked ? 'stored' : isExpired ? 'bad' : 'ok',
      label: isRevoked ? 'Revoked' : isExpired ? 'Expired' : 'Active',
    } as const
  }

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
              ? `Showing active and ${inactiveCount} inactive`
              : 'Showing active credentials'}
          </Muted>
          <Button
            variant="quiet"
            size="sm"
            aria-pressed={showInactive}
            onClick={() => setShowInactive((current) => !current)}
          >
            {showInactive
              ? 'Hide inactive'
              : `Show inactive (${inactiveCount})`}
          </Button>
        </div>
      ) : null}

      {revealed ? (
        <Notice tone="warn" className="flex-col items-start">
          <div className="flex flex-col gap-3">
            <p className="m-0 font-medium">
              {copy.revealNotice(revealed.name)}
            </p>
            <Secret
              value={revealed.secret}
              copyLabel={copy.secret.copyLabel}
              copiedMessage={copy.secret.copiedMessage}
              failedMessage={copy.secret.failedMessage}
            />
            <p className="m-0 text-label">
              Prefix <code>{revealed.displayPrefix}</code>. Scopes:{' '}
              {revealed.scopes.join(', ')}
            </p>
            <div>
              <Button type="button" size="sm" onClick={onDismissRevealed}>
                I have stored it
              </Button>
            </div>
          </div>
        </Notice>
      ) : null}

      {visibleRows.length ? (
        <>
          <TableBox className="hidden xl:block">
            <Table
              aria-label={copy.tableLabel}
              className="min-w-[720px] table-fixed"
            >
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[16%]">Name</TableHead>
                  <TableHead className="w-[22%]">Scopes</TableHead>
                  <TableHead className="w-[12%]">Created</TableHead>
                  <TableHead className="w-[12%]">Last used</TableHead>
                  <TableHead className="w-[11%]">Expires</TableHead>
                  <TableHead className="w-[9%]">Status</TableHead>
                  <TableHead className="w-[18%]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.map((row) => {
                  const state = stateFor(row)
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-normal">
                        <div className="break-words">{row.name}</div>
                        <div className="mono text-label text-fg-muted">
                          {row.displayPrefix}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <ScopeSummary scopes={row.scopes} />
                      </TableCell>
                      <TableCell title={formatDate(row.createdAt)}>
                        {formatCredentialDate(row.createdAt)}
                      </TableCell>
                      <TableCell
                        title={
                          row.lastUsedAt
                            ? formatDate(row.lastUsedAt)
                            : undefined
                        }
                      >
                        {formatCredentialDate(row.lastUsedAt)}
                      </TableCell>
                      <TableCell
                        title={
                          row.expiresAt ? formatDate(row.expiresAt) : undefined
                        }
                      >
                        {formatCredentialDate(row.expiresAt)}
                      </TableCell>
                      <TableCell>
                        <Status tone={state.tone}>{state.label}</Status>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-nowrap gap-1">
                          <Button
                            size="sm"
                            className="px-1.5"
                            disabled={state.isRevoked || state.isExpired}
                            onClick={() =>
                              setConfirming({ kind: 'rotate', row })
                            }
                          >
                            Rotate
                          </Button>
                          <Button
                            size="sm"
                            className="px-1.5"
                            variant="danger"
                            disabled={state.isRevoked}
                            onClick={() =>
                              setConfirming({ kind: 'revoke', row })
                            }
                          >
                            Revoke
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableBox>
          <div className="grid gap-2 md:grid-cols-2 xl:hidden">
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
                    <dt className="text-fg-muted">Scopes</dt>
                    <dd className="m-0">
                      <ScopeSummary scopes={row.scopes} />
                    </dd>
                    <dt className="text-fg-muted">Created</dt>
                    <dd className="m-0" title={formatDate(row.createdAt)}>
                      {formatCredentialDate(row.createdAt)}
                    </dd>
                    <dt className="text-fg-muted">Last used</dt>
                    <dd
                      className="m-0"
                      title={
                        row.lastUsedAt ? formatDate(row.lastUsedAt) : undefined
                      }
                    >
                      {formatCredentialDate(row.lastUsedAt)}
                    </dd>
                    <dt className="text-fg-muted">Expires</dt>
                    <dd
                      className="m-0"
                      title={
                        row.expiresAt ? formatDate(row.expiresAt) : undefined
                      }
                    >
                      {formatCredentialDate(row.expiresAt)}
                    </dd>
                  </dl>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={state.isRevoked || state.isExpired}
                      onClick={() => setConfirming({ kind: 'rotate', row })}
                    >
                      Rotate
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      className="flex-1"
                      disabled={state.isRevoked}
                      onClick={() => setConfirming({ kind: 'revoke', row })}
                    >
                      Revoke
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
            tokens.length === 0 ? copy.emptyTitle : 'No active credentials'
          }
          description={
            tokens.length === 0
              ? copy.emptyLabel
              : `All ${tokens.length} ${
                  tokens.length === 1 ? 'credential is' : 'credentials are'
                } revoked or expired. Show inactive to review them.`
          }
          action={
            tokens.length === 0 ? (
              <Button variant="primary" icon="plus" onClick={openCreate}>
                {copy.create.open}
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => setShowInactive(true)}>
                Show inactive
              </Button>
            )
          }
        />
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="top-[4vh] max-h-[92dvh] w-[min(860px,calc(100vw-32px))]">
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <DialogHeader
              title={copy.create.title}
              description="The full secret is shown once. Choose only the scopes this token needs; scroll the list to review every group."
            />
            <DialogBody className="min-h-0 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border-strong">
              <div className="grid gap-3.5 md:grid-cols-2">
                <Field label="Name" required>
                  <Input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={copy.create.namePlaceholder}
                    required
                    autoFocus
                  />
                </Field>
                <Field label="Expires (optional)">
                  <Input
                    type="datetime-local"
                    value={expiresAt}
                    onChange={(event) => setExpiresAt(event.target.value)}
                  />
                </Field>
              </div>

              <fieldset className="flex min-w-0 flex-col gap-3 border-0 p-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <legend className="text-body font-medium text-fg">
                    Scopes
                  </legend>
                  <Muted aria-live="polite">
                    {selected.size} {selected.size === 1 ? 'scope' : 'scopes'}{' '}
                    selected
                  </Muted>
                </div>
                <Muted className="max-w-3xl">
                  Enforced scopes are honoured by the API today. Mintable scopes
                  can be issued but are not yet on the external allowlist.
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
                              ? 'Personal only'
                              : group.effective
                                ? 'Enforced'
                                : 'Mintable only'}
                          </Status>
                          <Button
                            type="button"
                            variant="quiet"
                            size="sm"
                            className="ml-auto"
                            onClick={() => toggleGroup(group)}
                            aria-label={
                              allSelected
                                ? `Clear all ${group.title} scopes`
                                : `Select all ${group.title} scopes`
                            }
                          >
                            {allSelected ? 'Clear' : 'Select all'}
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
                                onCheckedChange={() => toggle(scope)}
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
                Cancel
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

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null)
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
            <ConfirmDialogCancel>Cancel</ConfirmDialogCancel>
            <ConfirmDialogAction
              variant={
                confirming?.kind === 'revoke' ? 'danger-fill' : 'primary'
              }
              onClick={() => {
                if (!confirming) return
                if (confirming.kind === 'rotate') onRotate(confirming.row.id)
                else onRevoke(confirming.row.id)
                setConfirming(null)
              }}
            >
              {confirm.action}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </Section>
  )
}

/** Personal API tokens: the signed-in member's own credentials. */
export const personalTokensCopy: CredentialPanelCopy = {
  title: 'Personal tokens',
  intro: (
    <>
      Acts as you and inherits your workspace role. Exchange it at{' '}
      <code>POST /api/token</code>; the full secret is shown once.
    </>
  ),
  revealNotice: (name) =>
    `Copy the token for ${name} now. It will not be shown again.`,
  secret: {
    copyLabel: 'Copy token',
    copiedMessage: 'Token copied',
    failedMessage: 'Couldn’t copy the token. Select it and copy it by hand.',
  },
  create: {
    open: 'New personal token',
    title: 'Create personal token',
    namePlaceholder: 'Local Jupyter',
    submit: 'Create token',
  },
  tableLabel: 'Personal tokens',
  emptyTitle: 'No personal tokens yet',
  emptyLabel:
    'Create a token for a notebook, script or MCP client that should act as you.',
  confirm: {
    rotate: {
      title: (name) => `Rotate ${name}?`,
      description:
        'The current secret stops working immediately and the new one is shown once. Update whatever uses this token before you rotate it.',
      action: 'Rotate token',
    },
    revoke: {
      title: (name) => `Revoke ${name}?`,
      description:
        'This is immediate and permanent. Every request that uses this token starts failing and the token cannot be restored.',
      action: 'Revoke token',
    },
  },
}

/** Workspace service credentials: owner-gated, shared by every integration. */
export const serviceCredentialsCopy: CredentialPanelCopy = {
  title: 'Workspace service credentials',
  intro: (
    <>
      Authenticates a machine or integration for this workspace. Prefer one
      credential per integration; the full secret is shown once.
    </>
  ),
  revealNotice: (name) =>
    `Copy the credential for ${name} now. It will not be shown again.`,
  secret: {
    copyLabel: 'Copy credential',
    copiedMessage: 'Credential copied',
    failedMessage:
      'Couldn’t copy the credential. Select it and copy it by hand.',
  },
  create: {
    open: 'New service credential',
    title: 'Create service credential',
    namePlaceholder: 'Nightly import',
    submit: 'Create credential',
  },
  tableLabel: 'Workspace service credentials',
  emptyTitle: 'No service credentials yet',
  emptyLabel:
    'Create one credential per machine or integration, not one shared by everything.',
  confirm: {
    rotate: {
      title: (name) => `Rotate ${name}?`,
      description:
        'This credential is shared: the current secret stops working for every integration using it, and the new secret is shown once. Update those integrations before you rotate.',
      action: 'Rotate credential',
    },
    revoke: {
      title: (name) => `Revoke ${name}?`,
      description:
        'This credential is shared: every request using it starts failing at once, and a revoked credential cannot be restored. Create a new one if you need it again.',
      action: 'Revoke credential',
    },
  },
}
