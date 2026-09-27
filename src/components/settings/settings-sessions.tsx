import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button, Empty, EmptyDescription, EmptyTitle } from '#/components/ui'
import { authClient } from '#/lib/auth-client'

/**
 * SET-03.2 — the caller's own sessions, with sign-out per session. Uses the
 * Better Auth session API; the current session is marked and cannot be ended
 * from the list (sign out does that from the account menu).
 */
interface MySession {
  id: string
  token: string
  ipAddress?: string | null
  userAgent?: string | null
  createdAt: string | Date
  expiresAt: string | Date
}

export const mySessionsQueryKey = ['my-sessions'] as const

function describeDevice(userAgent: string | null | undefined): string {
  if (!userAgent) return 'Unknown device'
  const browser =
    /(Edg|Chrome|Firefox|Safari)\/[\d.]+/.exec(userAgent)?.[1] ?? 'Browser'
  const os = /(Macintosh|Windows|Linux|iPhone|iPad|Android)/.exec(
    userAgent,
  )?.[1]
  const osLabel = os === 'Macintosh' ? 'macOS' : os
  return osLabel ? `${browser} · ${osLabel}` : browser
}

function formatWhen(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function SettingsSessions() {
  const queryClient = useQueryClient()
  const session = authClient.useSession()
  const currentSessionId =
    (session.data as { session?: { id?: string } } | null)?.session?.id ?? null

  const query = useQuery({
    queryKey: mySessionsQueryKey,
    queryFn: async (): Promise<MySession[]> => {
      const { data, error } = await authClient.listSessions()
      if (error) {
        throw new Error(error.message ?? 'Could not load your sessions')
      }
      return data
    },
  })

  const revoke = useMutation({
    mutationFn: async (token: string) => {
      const { error } = await authClient.revokeSession({ token })
      if (error) {
        throw new Error(error.message ?? 'Could not end the session')
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mySessionsQueryKey })
    },
  })

  const sessions = query.data ?? []

  return (
    <section aria-label="My sessions" className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-section text-foreground">My sessions</h3>
        <p className="text-caption text-muted-foreground">
          Devices signed in as you. Ending a session signs that device out.
        </p>
      </div>

      {revoke.isError ? (
        <p role="alert" className="text-caption text-danger-text">
          {revoke.error instanceof Error
            ? revoke.error.message
            : 'Could not end the session.'}
        </p>
      ) : null}

      {query.isLoading ? (
        <p className="text-body text-muted-foreground">Loading…</p>
      ) : query.isError ? (
        <div className="space-y-2">
          <p role="alert" className="text-caption text-danger-text">
            {query.error instanceof Error
              ? query.error.message
              : 'Could not load your sessions.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>
            Try again
          </Button>
        </div>
      ) : sessions.length === 0 ? (
        <Empty>
          <EmptyTitle>No other sessions</EmptyTitle>
          <EmptyDescription>
            You are only signed in on this device.
          </EmptyDescription>
        </Empty>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {sessions.map((entry) => {
            const current = entry.id === currentSessionId
            return (
              <li
                key={entry.id}
                className="flex items-center gap-3 px-3 py-2 text-body"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-foreground">
                    {describeDevice(entry.userAgent)}
                    {current ? ' · this device' : ''}
                  </p>
                  <p className="truncate text-caption text-muted-foreground">
                    {entry.ipAddress ?? '—'} · started{' '}
                    {formatWhen(entry.createdAt)}
                  </p>
                </div>
                {current ? (
                  <span className="shrink-0 text-caption text-muted-foreground">
                    Current
                  </span>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(entry.token)}
                  >
                    Sign out
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
