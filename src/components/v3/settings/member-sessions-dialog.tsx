import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Notice } from '#/components/v3/ui/alert'
import { Muted } from '#/components/v3/ui/layout'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { describeDevice } from '#/components/v3/settings/settings-sessions'
import { createDataClient } from '#/lib/data-client'
import { formatDate } from '#/lib/format-date'
import {
  adminQueryKeys,
  describeAdminError,
  fetchWorkspaceSessions,
  revokeUserSession,
} from '#/lib/workspace-admin'
import { t } from '#/copy'

const dataClient = createDataClient()

/** A member's open sessions, with sign out per session, for an admin who
 * needs to end one (a lost laptop, a leaver). */
export function MemberSessionsDialog({
  workspaceId,
  userId,
  name,
  onClose,
}: {
  workspaceId: string
  userId: string
  name: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const sessions = useQuery({
    queryKey: adminQueryKeys.sessions(workspaceId),
    queryFn: () => fetchWorkspaceSessions(dataClient, workspaceId),
  })
  const revoke = useMutation({
    mutationFn: (sessionId: string) =>
      revokeUserSession(dataClient, { workspaceId, sessionId }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: adminQueryKeys.sessions(workspaceId),
      }),
  })
  const mine = (sessions.data ?? []).filter((s) => s.userId === userId)
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <DialogHeader
          title={t('settings.memberSessionsDialog.sessions', { name })}
          description={t(
            'settings.memberSessionsDialog.signingSessionOutDescription',
          )}
        />
        <DialogBody>
          {sessions.isError ? (
            <Notice tone="bad">{describeAdminError(sessions.error)}</Notice>
          ) : sessions.isLoading ? (
            <Muted>{t('settings.memberSessionsDialog.loadingSessions')}</Muted>
          ) : mine.length === 0 ? (
            <Muted>
              {t('settings.memberSessionsDialog.openSessions', { name })}
            </Muted>
          ) : (
            <ul className="m-0 flex list-none flex-col divide-y divide-border-subtle p-0">
              {mine.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-3 py-2 text-body"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {describeDevice(s.userAgent)}
                    </span>
                    <span className="block text-label text-fg-muted">
                      {t('settings.memberSessionsDialog.signed')}
                      {formatDate(s.createdAt, { time: true })}
                      {s.ipAddress ? ` · ${s.ipAddress}` : ''}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(s.id)}
                  >
                    {t('settings.memberSessionsDialog.signOut')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {revoke.isError ? (
            <Notice tone="bad">{describeAdminError(revoke.error)}</Notice>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.done')}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
