import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Notice } from '#/components/v3/ui/alert'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Muted, Section } from '#/components/v3/ui/layout'
import { authClient } from '#/lib/auth-client'
import { listMySessionsFn } from './settings-sessions-data'
import type { MySession } from './settings-sessions-data'
import { formatDate } from '#/lib/format-date'
import { t } from '#/copy'

/**
 * SET-03.2 — the caller's own sessions, with sign-out per session. The list is
 * resolved server-side so a deployment without Better Auth sign-in still shows
 * its one session instead of a permanent 401. The current session is marked and
 * cannot be ended from the list (sign out does that from the account menu).
 * UI port: v3 kit.
 */

export const mySessionsQueryKey = ['my-sessions'] as const

export function describeDevice(userAgent: string | null | undefined): string {
  if (!userAgent) return 'Unknown device'
  const browser =
    /(Edg|Chrome|Firefox|Safari)\/[\d.]+/.exec(userAgent)?.[1] ??
    t('settings.sessions.browser')
  const os = /(Macintosh|Windows|Linux|iPhone|iPad|Android)/.exec(
    userAgent,
  )?.[1]
  const osLabel = os === 'Macintosh' ? 'macOS' : os
  return osLabel ? `${browser} · ${osLabel}` : browser
}

function formatWhen(value: string | Date): string {
  return formatDate(value)
}

export function SettingsSessions() {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: mySessionsQueryKey,
    queryFn: (): Promise<MySession[]> => listMySessionsFn(),
  })

  const revoke = useMutation({
    mutationFn: async (token: string) => {
      const { error } = await authClient.revokeSession({ token })
      if (error) {
        throw new Error(error.message ?? t('settings.sessions.couldEndSession'))
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mySessionsQueryKey })
    },
  })

  const sessions = query.data ?? []

  return (
    <Section title={t('settings.sessions.mySessions')}>
      <p className="m-0 text-body text-fg-muted">
        {t('settings.sessions.devicesSignedEnding')}
      </p>

      {revoke.isError ? (
        <Notice tone="bad">
          {revoke.error instanceof Error
            ? revoke.error.message
            : t('settings.sessions.couldEndSession2')}
        </Notice>
      ) : null}

      {query.isLoading ? (
        <Muted>{t('common.states.loading')}</Muted>
      ) : query.isError ? (
        <div className="flex flex-col gap-2">
          <Notice tone="bad">
            {query.error instanceof Error
              ? query.error.message
              : t('settings.sessions.couldLoadSessions')}
          </Notice>
          <Button onClick={() => query.refetch()}>
            {t('common.actions.tryAgain')}
          </Button>
        </div>
      ) : sessions.length === 0 ? (
        <EmptyState
          icon="lock"
          title={t('settings.sessions.otherSessions')}
          description={t('settings.sessions.onlySignedDeviceDescription')}
        />
      ) : (
        <ul className="m-0 list-none divide-y divide-border rounded-lg border border-border p-0">
          {sessions.map((entry) => {
            const current = entry.current
            const token = entry.token
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
                    {entry.ipAddress ?? '—'}
                    {t('settings.sessions.started')}
                    {formatWhen(entry.createdAt)}
                  </p>
                </div>
                {current ? (
                  <span className="shrink-0 text-label text-fg-muted">
                    {t('settings.sessions.current')}
                  </span>
                ) : token ? (
                  <Button
                    size="sm"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(token)}
                  >
                    {t('settings.sessions.signOut')}
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}
