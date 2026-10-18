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
import { Field, Input } from '#/components/v3/ui/input'
import { Notice } from '#/components/v3/ui/alert'
import { Section } from '#/components/v3/ui/layout'
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
import { formatDate } from '#/lib/workspace-admin'

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
    title: string
    namePlaceholder: string
    submit: string
  }
  tableLabel: string
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
}: {
  copy: CredentialPanelCopy
  tokens: CredentialRow[]
  revealed: RevealedCredential | null
  onCreate: (name: string, scopes: Scope[], expiresAt: string | null) => void
  onRevoke: (credentialId: string) => void
  onRotate: (credentialId: string) => void
  onDismissRevealed: () => void
  className?: string
}) {
  const [name, setName] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [selected, setSelected] = useState<Set<Scope>>(() => new Set<Scope>())
  // Revoking is permanent and rotating invalidates the live secret, so both ask
  // first: the row buttons only pick the action.
  const [confirming, setConfirming] = useState<{
    kind: 'revoke' | 'rotate'
    row: CredentialRow
  } | null>(null)

  function toggle(scope: Scope) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(scope)) next.delete(scope)
      else next.add(scope)
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
    setName('')
    setExpiresAt('')
    setSelected(new Set<Scope>())
  }

  const confirm =
    confirming?.kind === 'rotate' ? copy.confirm.rotate : copy.confirm.revoke

  return (
    <Section title={copy.title} className={className}>
      <p className="m-0 max-w-3xl text-body text-fg-muted">{copy.intro}</p>

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

      <form
        onSubmit={submit}
        className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
      >
        <h3 className="m-0 font-heading text-doc font-semibold">
          {copy.create.title}
        </h3>
        <div className="max-w-md">
          <Field label="Name" required>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={copy.create.namePlaceholder}
              required
            />
          </Field>
        </div>
        <div className="max-w-md">
          <Field label="Expires (optional)">
            <Input
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
          </Field>
        </div>
        <fieldset className="flex flex-col gap-4 border-0 p-0">
          <legend className="text-body font-medium text-fg">Scopes</legend>
          {SCOPE_GROUPS.map((group) => (
            <div key={group.title} className="flex flex-col gap-2">
              <p className="m-0 text-body font-medium">
                {group.title}
                <span className="ml-2 text-label font-normal text-fg-muted">
                  {group.effective
                    ? 'Enforced today'
                    : 'Mintable; not on the external allowlist'}
                </span>
              </p>
              <p className="m-0 text-label text-fg-muted">
                {group.description}
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
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
                    <code>{scope}</code>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </fieldset>
        <div>
          <Button
            type="submit"
            variant="primary"
            disabled={!name.trim() || selected.size === 0}
          >
            {copy.create.submit}
          </Button>
        </div>
      </form>

      <TableBox>
        <Table aria-label={copy.tableLabel}>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Prefix</TableHead>
              <TableHead>Scopes</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tokens.map((row) => {
              const isRevoked = Boolean(row.revokedAt)
              const isExpired =
                Boolean(row.expiresAt) &&
                new Date(row.expiresAt!).getTime() <= Date.now()
              return (
                <TableRow key={row.id}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell className="mono">{row.displayPrefix}</TableCell>
                  <TableCell className="max-w-xs text-label">
                    {row.scopes.join(', ')}
                  </TableCell>
                  <TableCell>{formatDate(row.createdAt)}</TableCell>
                  <TableCell>
                    {row.lastUsedAt ? formatDate(row.lastUsedAt) : 'Never'}
                  </TableCell>
                  <TableCell>
                    {row.expiresAt ? formatDate(row.expiresAt) : 'Never'}
                  </TableCell>
                  <TableCell>
                    <Status
                      tone={isRevoked ? 'stored' : isExpired ? 'bad' : 'ok'}
                    >
                      {isRevoked ? 'Revoked' : isExpired ? 'Expired' : 'Active'}
                    </Status>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={isRevoked || isExpired}
                        onClick={() => setConfirming({ kind: 'rotate', row })}
                      >
                        Rotate
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={isRevoked}
                        onClick={() => setConfirming({ kind: 'revoke', row })}
                      >
                        Revoke
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
            {!tokens.length && (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="py-8 text-center text-fg-muted"
                >
                  {copy.emptyLabel}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableBox>

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
      A personal API token acts as you (the signed-in member), under the same
      canonical Core-domain scopes and fail-closed allowlist as a workspace
      service credential. It inherits your membership role — so a{' '}
      <code>viewer</code> token is read-only. It is exchanged for a short-lived
      token at <code>POST /api/token</code> and never passes Notebook submit /
      sign / amend / revision checks. The full secret is shown once.
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
    title: 'Create personal token',
    namePlaceholder: 'Local Jupyter',
    submit: 'Create token',
  },
  tableLabel: 'Personal tokens',
  emptyLabel: 'You have no personal tokens.',
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
      A service credential authenticates a machine (a script, pipeline or
      integration) for this workspace, under the canonical Core-domain scopes
      and the fail-closed allowlist. The full secret is shown once.
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
    title: 'Create service credential',
    namePlaceholder: 'Nightly import',
    submit: 'Create credential',
  },
  tableLabel: 'Workspace service credentials',
  emptyLabel: 'No service credentials.',
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
