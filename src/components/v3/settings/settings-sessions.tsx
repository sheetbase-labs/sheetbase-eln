import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Notice } from '#/components/v3/ui/alert'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Muted, Section } from '#/components/v3/ui/layout'
import { authClient } from '#/lib/auth-client'

/**
 * SET-03.2 — the caller's own sessions, with sign-out per session. Uses the
 * Better Auth session API; the current session is marked and cannot be ended
 * from the list (sign out does that from the account menu). UI port: v3 kit.
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
    <Section title="My sessions">
      <p className="m-0 text-body text-fg-muted">
        Devices signed in as you. Ending a session signs that device out.
      </p>

      {revoke.isError ? (
        <Notice tone="bad">
          {revoke.error instanceof Error
            ? revoke.error.message
            : 'Could not end the session.'}
        </Notice>
      ) : null}

      {query.isLoading ? (
        <Muted>Loading…</Muted>
      ) : query.isError ? (
        <div className="flex flex-col gap-2">
          <Notice tone="bad">
            {query.error instanceof Error
              ? query.error.message
              : 'Could not load your sessions.'}
          </Notice>
          <Button onClick={() => query.refetch()}>Try again</Button>
        </div>
      ) : sessions.length === 0 ? (
        <EmptyState
          icon="lock"
          title="No other sessions"
          body="You are only signed in on this device."
        />
      ) : (
        <ul className="m-0 max-w-2xl list-none divide-y divide-border rounded-lg border border-border p-0">
          {sessions.map((entry) => {
            const current = entry.id === currentSessionId
            return (
              <li
                key={entry.id}
                className="flex items-center gap-3 px-3 py-2 text-body"
              >
                <div className="min-w-0 flex-1">
                  <p className="m-0 truncate text-fg">
                    {describeDevice(entry.userAgent)}
                    {current ? ' · this device' : ''}
                  </p>
                  <p className="m-0 truncate text-label text-fg-muted">
                    {entry.ipAddress ?? '—'} · started{' '}
                    {formatWhen(entry.createdAt)}
                  </p>
                </div>
                {current ? (
                  <span className="shrink-0 text-label text-fg-muted">
                    Current
                  </span>
                ) : (
                  <Button
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
    </Section>
  )
}
