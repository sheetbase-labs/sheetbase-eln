import { useState } from 'react'

import {
  Button,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui'
import { SCOPE_GROUPS } from '#/lib/api-credential-scopes'
import type { Scope } from '#/lib/api-credential-scopes'
import type {
  CreatedCredentialWire,
  CredentialWire,
} from '#/lib/api-credential-admin'
import { formatDate } from '#/lib/workspace-admin'
import { useUserNames } from '#/lib/user-names'

export function AdminApiCredentials({
  credentials,
  isOwner,
  revealed,
  onCreate,
  onRevoke,
  onRotate,
  onDismissRevealed,
}: {
  credentials: CredentialWire[]
  isOwner: boolean
  revealed: CreatedCredentialWire | null
  onCreate: (name: string, scopes: Scope[], expiresAt: string | null) => void
  onRevoke: (credentialId: string) => void
  onRotate: (credentialId: string) => void
  onDismissRevealed: () => void
}) {
  const [name, setName] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [selected, setSelected] = useState<Set<Scope>>(
    () => new Set(['projects:read']),
  )
  const creatorIds = credentials.map((row) => row.createdByUserId)
  const { userLabel } = useUserNames(creatorIds)

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
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-muted-foreground">
        External automation exchanges a credential for a short-lived token at{' '}
        <code>POST /api/token</code>. The full secret is shown once. Canonical
        Core-domain scopes are enforced on Dataset and Sheet Instance operations
        the product already uses. Schema-authoring RPCs, file access, and
        Notebook submit / sign / amend / revision checks stay human-session or
        fail-closed. Retired <code>scientific:*</code> scopes are not part of
        the vocabulary.
      </p>

      {revealed ? (
        <div
          role="status"
          className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
        >
          <p className="font-medium">
            Copy the credential for {revealed.name} now. It will not be shown
            again.
          </p>
          <code className="block break-all rounded-md bg-background px-3 py-2 text-foreground">
            {revealed.secret}
          </code>
          <p className="text-xs">
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
              Copy credential
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onDismissRevealed}
            >
              I have stored it
            </Button>
          </div>
        </div>
      ) : null}

      {isOwner ? (
        <form
          onSubmit={submit}
          className="space-y-4 rounded-lg border bg-background p-4"
        >
          <h3 className="font-semibold">Create credential</h3>
          <div className="max-w-md space-y-2">
            <Label htmlFor="api-credential-name">Name</Label>
            <Input
              id="api-credential-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="CI pipeline"
              required
            />
          </div>
          <div className="max-w-md space-y-2">
            <Label htmlFor="api-credential-expiry">Expires (optional)</Label>
            <Input
              id="api-credential-expiry"
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
          </div>
          <fieldset className="space-y-4">
            <legend className="text-sm font-medium">Scopes</legend>
            {SCOPE_GROUPS.map((group) => (
              <div key={group.title} className="space-y-2">
                <p className="text-sm font-medium">
                  {group.title}
                  {group.effective ? (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      Enforced today
                    </span>
                  ) : (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      Mintable; not on the external allowlist
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {group.description}
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {group.scopes.map((scope) => (
                    <label
                      key={scope}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(scope)}
                        onChange={() => toggle(scope)}
                      />
                      <code>{scope}</code>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </fieldset>
          <Button type="submit" disabled={!name.trim() || selected.size === 0}>
            Create credential
          </Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">
          Only workspace owners can create, rotate or revoke credentials.
        </p>
      )}

      <div className="rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Prefix</TableHead>
              <TableHead>Scopes</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Created by</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {credentials.map((row) => {
              const isRevoked = Boolean(row.revokedAt)
              const isExpired =
                Boolean(row.expiresAt) &&
                new Date(row.expiresAt!).getTime() <= Date.now()
              const status = isRevoked
                ? 'Revoked'
                : isExpired
                  ? 'Expired'
                  : 'Active'
              return (
                <TableRow key={row.id}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>
                    <code>{row.displayPrefix}</code>
                  </TableCell>
                  <TableCell className="max-w-xs text-xs">
                    {row.scopes.join(', ')}
                  </TableCell>
                  <TableCell>{formatDate(row.createdAt)}</TableCell>
                  <TableCell>
                    {row.lastUsedAt ? formatDate(row.lastUsedAt) : 'Never'}
                  </TableCell>
                  <TableCell>
                    {row.expiresAt ? formatDate(row.expiresAt) : 'Never'}
                  </TableCell>
                  <TableCell>{userLabel(row.createdByUserId)}</TableCell>
                  <TableCell>{status}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!isOwner || isRevoked || isExpired}
                        onClick={() => onRotate(row.id)}
                      >
                        Rotate
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!isOwner || isRevoked}
                        onClick={() => onRevoke(row.id)}
                      >
                        Revoke
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
            {!credentials.length && (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="py-8 text-center text-muted-foreground"
                >
                  No API credentials.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
