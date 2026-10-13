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
import type {
  CreatedPersonalTokenWire,
  PersonalTokenWire,
} from '#/lib/personal-api-tokens'
import { formatDate } from '#/lib/workspace-admin'

/** UI port (roadmap-4/ui-app3): personal API tokens, app-3's v3 kit. */
export function SettingsApiTokens({
  tokens,
  revealed,
  onCreate,
  onRevoke,
  onRotate,
  onDismissRevealed,
}: {
  tokens: PersonalTokenWire[]
  revealed: CreatedPersonalTokenWire | null
  onCreate: (name: string, scopes: Scope[], expiresAt: string | null) => void
  onRevoke: (tokenId: string) => void
  onRotate: (tokenId: string) => void
  onDismissRevealed: () => void
}) {
  const [name, setName] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [selected, setSelected] = useState<Set<Scope>>(
    () => new Set(['projects:read']),
  )
  // Revoke is permanent and rotate invalidates the live secret, so both ask
  // first: the row buttons only pick the action.
  const [confirming, setConfirming] = useState<{
    kind: 'revoke' | 'rotate'
    token: PersonalTokenWire
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
    setSelected(new Set(['projects:read']))
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="m-0 max-w-3xl text-body text-fg-muted">
        A personal API token acts as you (the signed-in member), under the same
        canonical Core-domain scopes and fail-closed allowlist as a workspace
        service credential. It inherits your membership role — so a{' '}
        <code>viewer</code> token is read-only. It is exchanged for a
        short-lived token at <code>POST /api/token</code> and never passes
        Notebook submit / sign / amend / revision checks. The full secret is
        shown once.
      </p>

      {revealed ? (
        <Notice tone="warn" className="flex-col items-start">
          <div className="flex flex-col gap-3">
            <p className="m-0 font-medium">
              Copy the token for {revealed.name} now. It will not be shown
              again.
            </p>
            <code className="block break-all rounded-md bg-surface px-3 py-2 text-fg">
              {revealed.secret}
            </code>
            <p className="m-0 text-label">
              Prefix <code>{revealed.displayPrefix}</code>. Scopes:{' '}
              {revealed.scopes.join(', ')}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() =>
                  void navigator.clipboard.writeText(revealed.secret)
                }
              >
                Copy token
              </Button>
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
          Create personal token
        </h3>
        <div className="max-w-md">
          <Field label="Name" required>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Local Jupyter"
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
            Create token
          </Button>
        </div>
      </form>

      <TableBox>
        <Table aria-label="Personal tokens">
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
                        onClick={() =>
                          setConfirming({ kind: 'rotate', token: row })
                        }
                      >
                        Rotate
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={isRevoked}
                        onClick={() =>
                          setConfirming({ kind: 'revoke', token: row })
                        }
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
                  You have no personal tokens.
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
              {confirming?.kind === 'rotate'
                ? `Rotate ${confirming.token.name}?`
                : `Revoke ${confirming?.token.name}?`}
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {confirming?.kind === 'rotate'
                ? 'The current secret stops working immediately and the new one is shown once. Update whatever uses this token before you rotate it.'
                : 'This is immediate and permanent. Every request that uses this token starts failing and the token cannot be restored.'}
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
                if (confirming.kind === 'rotate') onRotate(confirming.token.id)
                else onRevoke(confirming.token.id)
                setConfirming(null)
              }}
            >
              {confirming?.kind === 'rotate' ? 'Rotate token' : 'Revoke token'}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </div>
  )
}
